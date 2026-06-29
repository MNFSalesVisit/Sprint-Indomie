/**
 * lib/throttle.js — Intelligent Request Throttling (visible to Super Admin only)
 *
 * Determines system load level from edge_usage data and applies silent
 * delays to LOW-priority endpoints at HIGH/CRITICAL levels.
 *
 * Priority classes:
 *   HIGH   — never throttled (submissions, auth, shop ops)
 *   MEDIUM — debounce only (handled client-side; no server delay)
 *   LOW    — full throttle eligible (dashboards, reports, maps, analytics)
 *
 * Load levels (based on monthly Vercel edge request quota):
 *   NORMAL   < 60%   No action
 *   WARNING  60–80%  Minor delay on LOW (500 ms)
 *   HIGH     80–95%  Stronger delay on LOW (1 500 ms)
 *   CRITICAL > 95%   Maximum delay on LOW (3 000 ms)
 *
 * Secondary: if today's usage exceeds expected daily rate by 50%+, treat as HIGH.
 *
 * All behaviour is invisible to end users — no error messages, no blocks.
 * Only the Super Admin UI reads throttle state.
 */

import { adminSupabase } from './adminAuth';
import { getCache, setCache } from './serverCache';

// ── Constants ────────────────────────────────────────────────────────────────
const EDGE_LIMIT_DEFAULT = 1_000_000; // fallback if no DB config exists
const STATE_CACHE_KEY    = 'throttle:state';
const STATE_CACHE_TTL    = 45_000;    // refresh load level every 45 seconds
const ENABLED_CACHE_KEY  = 'throttle:enabled';
const ENABLED_CACHE_TTL  = 5 * 60_000;
const LIMIT_CACHE_KEY    = 'throttle:edge_limit';
const LIMIT_CACHE_TTL    = 5 * 60_000;
const MONTH_START        = '2026-04-01'; // update when Vercel billing cycle resets

/**
 * Read the configured edge request limit from system_config.
 * Falls back to EDGE_LIMIT_DEFAULT (1 M) if not set.
 */
export async function getEdgeLimit() {
  const cached = getCache(LIMIT_CACHE_KEY);
  if (cached !== undefined && cached !== null) return cached;
  try {
    const { data } = await adminSupabase
      .from('system_config')
      .select('value')
      .eq('key', 'edge_limit')
      .single();
    const limit = (data?.value && parseInt(data.value, 10) > 0)
      ? parseInt(data.value, 10)
      : EDGE_LIMIT_DEFAULT;
    setCache(LIMIT_CACHE_KEY, limit, LIMIT_CACHE_TTL);
    return limit;
  } catch {
    return EDGE_LIMIT_DEFAULT;
  }
}

// ── Delays (ms) applied per level for LOW-priority endpoints ────────────────
const LEVEL_DELAYS = {
  NORMAL:   0,
  WARNING:  500,
  HIGH:     1500,
  CRITICAL: 3000,
};

// ── Determine load level from usage numbers ──────────────────────────────────
function computeLevel(thisMonth, todayCount, daysElapsed, edgeLimit) {
  const monthlyPct = thisMonth / edgeLimit;

  // Primary: monthly percentage
  let level;
  if      (monthlyPct >= 0.95) level = 'CRITICAL';
  else if (monthlyPct >= 0.80) level = 'HIGH';
  else if (monthlyPct >= 0.60) level = 'WARNING';
  else                         level = 'NORMAL';

  // Secondary: daily spike — if today > 1.5× expected daily rate, escalate by one level
  const daysInMonth      = 30;
  const expectedDaily    = thisMonth / Math.max(1, daysElapsed);
  const dailySpikeDetected = todayCount > expectedDaily * 1.5 && todayCount > 500; // ignore tiny volumes

  if (dailySpikeDetected && level === 'NORMAL')   level = 'WARNING';
  else if (dailySpikeDetected && level === 'WARNING') level = 'HIGH';

  return level;
}

/**
 * Read current load state. Returns cached value if fresh.
 * @returns {{ level: string, thisMonth: number, todayCount: number, expectedDaily: number, daysElapsed: number, spikeDetected: boolean }}
 */
export async function getLoadState() {
  const cached = getCache(STATE_CACHE_KEY);
  if (cached) return cached;

  try {
    const todayStr  = new Date().toISOString().slice(0, 10);
    const edgeLimit = await getEdgeLimit();

    const { data: rows } = await adminSupabase
      .from('edge_usage')
      .select('date, request_count')
      .gte('date', MONTH_START)
      .order('date', { ascending: false });

    const safeRows = rows || [];
    const thisMonth    = safeRows.reduce((s, r) => s + r.request_count, 0);
    const todayCount   = safeRows.filter(r => r.date === todayStr).reduce((s, r) => s + r.request_count, 0);
    const msElapsed    = Date.now() - new Date(MONTH_START + 'T00:00:00Z').getTime();
    const daysElapsed  = Math.max(1, msElapsed / (24 * 60 * 60 * 1000));
    const expectedDaily = thisMonth / daysElapsed;
    const level        = computeLevel(thisMonth, todayCount, daysElapsed, edgeLimit);
    const spikeDetected = todayCount > expectedDaily * 1.5 && todayCount > 500;

    const state = { level, thisMonth, todayCount, expectedDaily: Math.round(expectedDaily), daysElapsed: Math.round(daysElapsed), spikeDetected, edgeLimit };
    setCache(STATE_CACHE_KEY, state, STATE_CACHE_TTL);
    return state;
  } catch {
    // Fail open — never block requests due to monitoring errors
    return { level: 'NORMAL', thisMonth: 0, todayCount: 0, expectedDaily: 0, daysElapsed: 0, spikeDetected: false, edgeLimit: EDGE_LIMIT_DEFAULT };
  }
}

/**
 * Check whether intelligent throttling is enabled (default: true).
 * Reads from system_config table key 'throttling_enabled'.
 */
export async function isThrottlingEnabled() {
  const cached = getCache(ENABLED_CACHE_KEY);
  if (cached !== null) return cached;

  try {
    const { data } = await adminSupabase
      .from('system_config')
      .select('value')
      .eq('key', 'throttling_enabled')
      .single();

    const enabled = data ? data.value !== 'false' : true;
    setCache(ENABLED_CACHE_KEY, enabled, ENABLED_CACHE_TTL);
    return enabled;
  } catch {
    return true; // default on
  }
}

/**
 * Force-clear the cached enabled state after a toggle.
 */
export function invalidateThrottleCache() {
  const { deleteCache } = require('./serverCache');
  deleteCache(ENABLED_CACHE_KEY);
  deleteCache(STATE_CACHE_KEY);
  deleteCache(LIMIT_CACHE_KEY);
}

/**
 * Apply throttling to a LOW-priority request.
 * Call at the top of the handler, after auth, before the DB work.
 *
 * Does nothing for HIGH-priority endpoints — those should NOT call this.
 *
 * Returns silently; the only effect is an async delay when warranted.
 *
 * @example
 *   import { applyLowPriorityThrottle } from '../../../lib/throttle';
 *   // inside handler, after auth:
 *   await applyLowPriorityThrottle();
 */
export async function applyLowPriorityThrottle() {
  try {
    const enabled = await isThrottlingEnabled();
    if (!enabled) return;

    const state = await getLoadState();
    const delay = LEVEL_DELAYS[state.level] ?? 0;
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  } catch {
    // Never block — fail open
  }
}
