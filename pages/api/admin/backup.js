import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
};

// Ordered to respect FK dependencies on dump/restore
const ALL_TABLES = [
  'roles', 'regions', 'subregions', 'products', 'app_users',
  'user_regions', 'shops', 'stock_balances', 'visits', 'visit_items',
  'uplifts', 'uplift_items', 'targets', 'audit_logs',
];

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

async function getConfigValue(key) {
  const { data } = await supabase.from('system_config').select('value').eq('key', key).maybeSingle();
  return data?.value || null;
}

async function setConfigValue(key, value) {
  await supabase.from('system_config').upsert(
    { key, value, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}

export default async function handler(req, res) {
  const actor = await verifySuperAdmin(req);
  if (!actor) return res.status(403).json({ error: 'Forbidden' });

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { action, page = '1', limit = '25', entity, date_from, date_to } = req.query;

    // ── Audit log (paginated, filtered) ───────────────────────────────────
    if (action === 'audit') {
      const pageNum  = Math.max(1, parseInt(page));
      const pageSize = Math.min(100, Math.max(1, parseInt(limit)));
      let q = supabase
        .from('audit_logs')
        .select(
          'id, action, entity, entity_id, details, created_at, app_users!audit_logs_actor_id_fkey(id, full_name)',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range((pageNum - 1) * pageSize, pageNum * pageSize - 1);
      if (entity)     q = q.eq('entity', entity);
      if (date_from)  q = q.gte('created_at', new Date(date_from).toISOString());
      if (date_to)    q = q.lte('created_at', new Date(new Date(date_to).getTime() + 86399999).toISOString());
      const { data, error, count } = await q;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ items: data || [], total: count || 0, page: pageNum, pageSize });
    }

    // ── Backup history ─────────────────────────────────────────────────────
    if (action === 'history') {
      const raw = await getConfigValue('backup_history');
      return res.status(200).json(raw ? JSON.parse(raw) : []);
    }

    // ── Schedule config ────────────────────────────────────────────────────
    if (action === 'schedule') {
      const raw = await getConfigValue('backup_schedule');
      const defaults = { enabled: false, frequency: 'daily', hour: 2, format: 'json' };
      return res.status(200).json(raw ? { ...defaults, ...JSON.parse(raw) } : defaults);
    }

    // ── Table row-count stats ──────────────────────────────────────────────
    if (action === 'stats') {
      const counts = {};
      for (const tbl of ALL_TABLES) {
        const { count } = await supabase.from(tbl).select('*', { count: 'exact', head: true });
        counts[tbl] = count || 0;
      }
      const total = Object.values(counts).reduce((s, v) => s + v, 0);
      return res.status(200).json({ counts, total });
    }

    // ── Data dump (manual backup or per-table export) ──────────────────────
    if (action === 'dump') {
      const requested = req.query.tables ? req.query.tables.split(',') : ALL_TABLES;
      const tables = requested.filter(t => ALL_TABLES.includes(t));
      const result = {};
      const PAGE_SIZE = 1000;
      for (const tbl of tables) {
        const rows = [];
        let from = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data, error } = await supabase
            .from(tbl).select('*')
            .range(from, from + PAGE_SIZE - 1);
          if (error || !data || data.length === 0) break;
          rows.push(...data);
          if (data.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
        result[tbl] = rows;
      }

      // Record to backup history only when dumping all tables
      if (tables.length === ALL_TABLES.length) {
        const raw = await getConfigValue('backup_history');
        const hist = raw ? JSON.parse(raw) : [];
        const rowCounts = {};
        for (const t of tables) rowCounts[t] = result[t].length;
        const entry = {
          id: randomUUID(),
          created_at: new Date().toISOString(),
          tables,
          row_counts: rowCounts,
          total_rows: Object.values(rowCounts).reduce((s, v) => s + v, 0),
          created_by: actor.full_name || 'Super Admin',
          note: 'Manual backup',
        };
        hist.unshift(entry);
        if (hist.length > 50) hist.length = 50;
        await setConfigValue('backup_history', JSON.stringify(hist));
        return res.status(200).json({ tables: result, meta: entry });
      }

      return res.status(200).json({ tables: result });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body;

    // ── Save schedule ──────────────────────────────────────────────────────
    if (action === 'save_schedule') {
      const { schedule } = req.body;
      if (!schedule) return res.status(400).json({ error: 'Missing schedule' });
      await setConfigValue('backup_schedule', JSON.stringify(schedule));
      return res.status(200).json({ ok: true });
    }

    // ── Restore from backup ────────────────────────────────────────────────
    if (action === 'restore') {
      const { tables } = req.body;
      if (!tables || typeof tables !== 'object') {
        return res.status(400).json({ error: 'Invalid backup data: expected { tables: { ... } }' });
      }
      const results = {};
      const errors = [];

      // Tables with non-id primary keys need a different conflict target
      const CONFLICT_COL = {
        user_regions: 'user_id,region_id',
      };

      // Restore in FK-safe order
      for (const tbl of ALL_TABLES) {
        const rows = tables[tbl];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const onConflict = CONFLICT_COL[tbl] || 'id';
        const { error } = await supabase.from(tbl).upsert(rows, {
          onConflict,
          ignoreDuplicates: false,
        });
        if (error) {
          errors.push({ table: tbl, error: error.message });
        } else {
          results[tbl] = rows.length;
        }
      }

      // Audit the restore event
      await supabase.from('audit_logs').insert({
        actor_id: actor.id,
        action: 'restore_backup',
        entity: 'system',
        entity_id: null,
        details: { restored_tables: Object.keys(results), row_counts: results, errors },
      });

      return res.status(200).json({ ok: true, results, errors });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
