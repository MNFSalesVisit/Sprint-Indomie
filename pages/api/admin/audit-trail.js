import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function verifySuperAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: appUser } = await supabase
    .from('app_users').select('id, full_name, role_id')
    .eq('email', data.user.email).single();
  if (!appUser) return null;
  const { data: role } = await supabase
    .from('roles').select('name').eq('id', appUser.role_id).single();
  if (role?.name !== 'Super Admin') return null;
  return { id: appUser.id, full_name: appUser.full_name };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const actor = await verifySuperAdmin(req);
  if (!actor) return res.status(403).json({ error: 'Forbidden' });
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');

  const {
    action      = 'logs',
    page        = '1',
    limit       = '50',
    search      = '',
    entity      = '',
    action_type = '',
    actor_id    = '',
    date_from   = '',
    date_to     = '',
  } = req.query;

  // ── Summary stats ──────────────────────────────────────────────────────
  if (action === 'stats') {
    const { count: total } = await supabase
      .from('audit_logs').select('*', { count: 'exact', head: true });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: today } = await supabase
      .from('audit_logs').select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString());

    const { data: actorRows } = await supabase
      .from('audit_logs').select('actor_id');
    const distinctActors = new Set(
      (actorRows || []).map(r => r.actor_id).filter(Boolean)
    ).size;

    const { data: latest } = await supabase
      .from('audit_logs').select('created_at')
      .order('created_at', { ascending: false }).limit(1);

    const { data: byEntityRows } = await supabase
      .from('audit_logs').select('entity');
    const entityMap = {};
    (byEntityRows || []).forEach(r => {
      const k = r.entity || 'unknown';
      entityMap[k] = (entityMap[k] || 0) + 1;
    });
    const byEntity = Object.entries(entityMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ent, count]) => ({ entity: ent, count }));

    return res.status(200).json({
      total: total || 0,
      today: today || 0,
      distinctActors,
      latestAt: latest?.[0]?.created_at || null,
      byEntity,
    });
  }

  // ── Actors filter list ─────────────────────────────────────────────────
  if (action === 'actors') {
    const { data } = await supabase
      .from('audit_logs')
      .select('actor_id, app_users!audit_logs_actor_id_fkey(id, full_name)')
      .not('actor_id', 'is', null);
    const seen = new Map();
    (data || []).forEach(r => {
      if (r.actor_id && !seen.has(r.actor_id)) {
        seen.set(r.actor_id, r.app_users?.full_name || r.actor_id);
      }
    });
    return res.status(200).json(
      Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
    );
  }

  // ── Distinct entity types ──────────────────────────────────────────────
  if (action === 'entities') {
    const { data } = await supabase.from('audit_logs').select('entity');
    const distinct = [
      ...new Set((data || []).map(r => r.entity).filter(Boolean)),
    ].sort();
    return res.status(200).json(distinct);
  }

  // ── Distinct action types ──────────────────────────────────────────────
  if (action === 'action_types') {
    const { data } = await supabase.from('audit_logs').select('action');
    const distinct = [
      ...new Set((data || []).map(r => r.action).filter(Boolean)),
    ].sort();
    return res.status(200).json(distinct);
  }

  // ── Main log query (paginated + filtered) ──────────────────────────────
  if (action === 'logs') {
    const pageNum  = Math.max(1, parseInt(page));
    const pageSize = Math.min(200, Math.max(1, parseInt(limit)));

    let q = supabase
      .from('audit_logs')
      .select(
        'id, action, entity, entity_id, details, created_at, app_users!audit_logs_actor_id_fkey(id, full_name)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range((pageNum - 1) * pageSize, pageNum * pageSize - 1);

    if (entity)      q = q.eq('entity', entity);
    if (action_type) q = q.eq('action', action_type);
    if (actor_id)    q = q.eq('actor_id', actor_id);
    if (date_from)   q = q.gte('created_at', new Date(date_from).toISOString());
    if (date_to)     q = q.lte('created_at', new Date(new Date(date_to).getTime() + 86399999).toISOString());
    if (search) {
      q = q.or(
        `action.ilike.%${search}%,entity.ilike.%${search}%,entity_id.ilike.%${search}%`,
      );
    }

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({
      items:    data || [],
      total:    count || 0,
      page:     pageNum,
      pageSize,
    });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
