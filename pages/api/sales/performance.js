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

  // month is 1-based
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
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

    // visits in the month
    const { data: visits } = await adminSupabase
      .from('visits')
      .select('id, created_at')
      .eq('user_id', userId)
      .eq('visit_type', 'sales')
      .gte('created_at', isoStart)
      .lt('created_at', isoEnd);

    const visitIds = (visits || []).map(v => v.id);

    // visit items aggregated
    let items = [];
    if (visitIds.length > 0) {
      const { data: it } = await adminSupabase
        .from('visit_items')
        .select('visit_id, sold')
        .in('visit_id', visitIds);
      items = it || [];
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

    // weekly: simple 7-day buckets starting day 1
    const weekly = [];
    for (let startDay = 1; startDay <= daysInMonth; startDay += 7) {
      const endDay = Math.min(startDay + 6, daysInMonth);
      const label = `${startDay}-${endDay}`;
      let sum = 0;
      for (let d = startDay; d <= endDay; d++) {
        const key = new Date(Date.UTC(year, month - 1, d)).toISOString().slice(0, 10);
        sum += dailyMap[key] || 0;
      }
      const weekTarget = monthlyTarget ? Math.round((monthlyTarget / daysInMonth) * (endDay - startDay + 1)) : null;
      weekly.push({ label, cartons: sum, target: weekTarget });
    }

    const totalCartons = Object.values(dailyMap).reduce((s, v) => s + v, 0);

    const weeklyTargetApprox = weekly.length > 0 ? weekly[0].target : null;

    return res.status(200).json({
      year, month, daysInMonth,
      targets: { daily_target: dailyTarget, weekly_target: weeklyTargetApprox, monthly_target: monthlyTarget },
      daily, weekly, monthly: { cartons: totalCartons, target: monthlyTarget }
    });
  } catch (err) {
    console.error('Performance API error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load performance' });
  }
}
