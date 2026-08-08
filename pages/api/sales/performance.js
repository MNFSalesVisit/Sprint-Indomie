import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: appUser, error: userErr } = await adminSupabase
    .from('app_users')
    .select('id, roles(name)')
    .eq('email', user.email)
    .single();
  if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });
  if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');

  const userId = appUser.id;
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);

  // month is 1-based; use local month boundaries to match the admin performance period semantics
  const start = new Date(year, month - 1, 1, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0);
  const isoStart = start.toISOString();
  const isoEnd = end.toISOString();

  try {
    // fetch target row (admin UI stores `cartons_target`)
    const { data: targetRow } = await adminSupabase
      .from('targets')
      .select('cartons_target')
      .eq('user_id', userId)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    const monthlyTarget = targetRow?.cartons_target ?? null;
    console.log('Performance targets loaded for user', userId, { monthlyTarget });

    // visits in the month (paginate to avoid Supabase row limits)
    const VISIT_PAGE_SIZE = 1000;
    const visits = [];
    let visitPage = 0;

    while (true) {
      const { data: visitBatch, error: visitErr } = await adminSupabase
        .from('visits')
        .select('id, created_at')
        .eq('user_id', userId)
        .eq('visit_type', 'sales')
        .gte('created_at', isoStart)
        .lt('created_at', isoEnd)
        .range(visitPage * VISIT_PAGE_SIZE, (visitPage + 1) * VISIT_PAGE_SIZE - 1);

      if (visitErr) throw visitErr;
      if (!visitBatch || visitBatch.length === 0) break;

      visits.push(...visitBatch);
      if (visitBatch.length < VISIT_PAGE_SIZE) break;
      visitPage += 1;
    }

    const visitIds = (visits || []).map(v => v.id);

    // visit items aggregated (paginate item rows and chunk visit IDs)
    let items = [];
    if (visitIds.length > 0) {
      const VISIT_ITEM_CHUNK = 1000;
      for (let i = 0; i < visitIds.length; i += VISIT_ITEM_CHUNK) {
        const chunk = visitIds.slice(i, i + VISIT_ITEM_CHUNK);
        let itemOffset = 0;

        while (true) {
          const { data: itemBatch, error: itemErr } = await adminSupabase
            .from('visit_items')
            .select('visit_id, sold')
            .in('visit_id', chunk)
            .order('visit_id', { ascending: true })
            .range(itemOffset, itemOffset + VISIT_PAGE_SIZE - 1);

          if (itemErr) throw itemErr;
          if (!itemBatch || itemBatch.length === 0) break;

          items.push(...itemBatch);
          if (itemBatch.length < VISIT_PAGE_SIZE) break;
          itemOffset += VISIT_PAGE_SIZE;
        }
      }
    }

    // prepare daily buckets (use local date formatting to avoid UTC shifts)
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyMap = {};
    function fmtLocalDate(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dt = new Date(year, month - 1, d);
      const key = fmtLocalDate(dt);
      dailyMap[key] = 0;
    }

    // map visit_id -> created_at date (local)
    const visitDate = {};
    (visits || []).forEach(v => { visitDate[v.id] = fmtLocalDate(new Date(v.created_at)); });

    items.forEach(it => {
      const date = visitDate[it.visit_id];
      if (!date) return;
      dailyMap[date] = (dailyMap[date] || 0) + (it.sold || 0);
    });

    const dailyTarget = monthlyTarget ? Math.round(monthlyTarget / daysInMonth) : null;
    const daily = Object.keys(dailyMap).sort().map(date => ({ date, cartons: dailyMap[date], target: dailyTarget }));

    const totalCartons = Object.values(dailyMap).reduce((s, v) => s + v, 0);

    return res.status(200).json({
      year, month, daysInMonth,
      targets: { daily_target: dailyTarget, monthly_target: monthlyTarget },
      daily, monthly: { cartons: totalCartons, target: monthlyTarget }
    });
  } catch (err) {
    console.error('Performance API error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load performance' });
  }
}
