import { adminSupabase, requireSuperAdmin } from '../../../../lib/adminAuth';

export default async function handler(req, res) {
  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });

    if (req.method === 'GET') {
      const { region_id } = req.query || {};
      let q = adminSupabase.from('competitor_products').select('id, region_id, name, note, is_active, sort_order, created_at');
      if (region_id) q = q.eq('region_id', Number(region_id));
      const { data, error } = await q.order('sort_order').order('id');
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    if (req.method === 'POST') {
      const { region_id, name, note } = req.body || {};
      if (!region_id) return res.status(400).json({ error: 'region_id is required' });
      if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

      // Assign sort_order = (max existing for that region) + 10
      const { data: existing } = await adminSupabase.from('competitor_products').select('sort_order').eq('region_id', Number(region_id)).order('sort_order', { ascending: false }).limit(1);
      const nextOrder = existing && existing.length > 0 ? (existing[0].sort_order || 0) + 10 : 10;
      const payload = { region_id: Number(region_id), name: name.trim(), note: note || null, created_by: actor.id, sort_order: nextOrder };
      const { data, error } = await adminSupabase.from('competitor_products').insert(payload).select('id, region_id, name, note, is_active, sort_order, created_at').single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Duplicate competitor product for region' });
        return res.status(500).json({ error: error.message });
      }
      return res.status(201).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
