import { adminSupabase, requireSuperAdmin } from '../../../lib/adminAuth';

// Vercel billing cycle start — update when a new cycle begins
const MONTH_START = '2026-04-01';

async function verifySuperAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return false;
  const { data, error } = await adminSupabase.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: appUser } = await adminSupabase
    .from('app_users').select('role_id').eq('email', data.user.email).single();
  if (!appUser) return false;
  const { data: role } = await adminSupabase
    .from('roles').select('name').eq('id', appUser.role_id).single();
  return role?.name === 'Super Admin';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ok = await verifySuperAdmin(req);
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');

  try {
    const now      = Date.now();
    const todayStr = new Date(now).toISOString().slice(0, 10);
    const day7Str  = new Date(now -  7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const day30Str = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Use the earlier of MONTH_START / 30-days-ago so we always capture billing data
    const queryFrom = MONTH_START < day30Str ? MONTH_START : day30Str;

    // Single query — at most ~3 modules × days → tiny result set (≤90 rows/month)
    const [usageRes, dbSizeRes, fileStorageRes] = await Promise.all([
      adminSupabase
        .from('edge_usage')
        .select('date, module, request_count')
        .gte('date', queryFrom)
        .order('date', { ascending: true }),
      adminSupabase.rpc('get_db_size'),
      adminSupabase.rpc('get_file_storage_size'),
    ]);

    const rows = usageRes.data || [];

    // ── Aggregate totals (pure JS — no extra DB round-trips) ─────────────────
    const total24h  = rows.filter(r => r.date === todayStr).reduce((s, r) => s + r.request_count, 0);
    const total7d   = rows.filter(r => r.date >= day7Str).reduce((s, r)   => s + r.request_count, 0);
    const total30d  = rows.filter(r => r.date >= day30Str).reduce((s, r)  => s + r.request_count, 0);
    const thisMonth = rows.filter(r => r.date >= MONTH_START).reduce((s, r) => s + r.request_count, 0);

    // Linear projection to end-of-month
    const msElapsed       = now - new Date(MONTH_START + 'T00:00:00Z').getTime();
    const daysElapsed     = Math.max(1, msElapsed / (24 * 60 * 60 * 1000));
    const estimatedMonthly = Math.round((thisMonth / daysElapsed) * 30);

    // ── Per-module breakdown (last 30 days) ───────────────────────────────────
    const moduleCounts = {};
    rows.filter(r => r.date >= day30Str).forEach(({ module, request_count }) => {
      moduleCounts[module] = (moduleCounts[module] || 0) + request_count;
    });

    // ── Last 7 days daily trend ───────────────────────────────────────────────
    const dailyMap = {};
    rows.filter(r => r.date >= day7Str).forEach(({ date, request_count }) => {
      dailyMap[date] = (dailyMap[date] || 0) + request_count;
    });
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now - (6 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return { date: d, count: dailyMap[d] || 0 };
    });

    return res.status(200).json({
      totals: {
        last24h: total24h,
        last7d:  total7d,
        last30d: total30d,
        thisMonth,
        monthStart: MONTH_START,
        estimatedMonthly,
        daysElapsed: Math.round(daysElapsed),
      },
      moduleCounts,
      last7Days,
      dbSizeBytes:      dbSizeRes.data?.[0]?.size_bytes      ?? null,
      fileStorageBytes: fileStorageRes.data?.[0]?.size_bytes ?? null,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[usage-metrics]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
