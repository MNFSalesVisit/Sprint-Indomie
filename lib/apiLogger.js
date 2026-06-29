/**
 * lib/apiLogger.js
 *
 * Lightweight, fire-and-forget edge-request counter.
 * Uses an atomic upsert-increment on `edge_usage` (one row per date+module).
 * Table stays tiny: max ~3 rows/day regardless of request volume.
 * NEVER awaited — zero impact on response latency.
 *
 * Usage (inside any API route handler, after auth succeeds):
 *   import { logApiCall } from '../../../lib/apiLogger';
 *   logApiCall('/api/admin/performance', 'admin');
 */

import { adminSupabase } from './adminAuth';

const _today = () => new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

/**
 * @param {string} endpoint  Kept for call-site compatibility (not stored)
 * @param {string} module    One of: 'admin' | 'salesperson' | 'super-admin'
 */
export function logApiCall(endpoint, module) {
  // Atomic upsert-increment — one index lookup + counter bump, never duplicates
  adminSupabase
    .rpc('increment_edge_usage', { p_date: _today(), p_module: module })
    .then(() => {})
    .catch(() => {}); // silently swallow errors — never break the API response
}
