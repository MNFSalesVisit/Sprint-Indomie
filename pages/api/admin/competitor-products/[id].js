import { adminSupabase, requireSuperAdmin } from '../../../../lib/adminAuth';

export default async function handler(req, res) {
  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.query || {};
    if (!id) return res.status(400).json({ error: 'Missing id' });

    if (req.method === 'PUT') {
      const { name, note, region_id, is_active, sort_order } = req.body || {};
      if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
      const payload = {};
      if (name !== undefined) payload.name = name.trim();
      if (note !== undefined) payload.note = note || null;
      if (region_id !== undefined) payload.region_id = Number(region_id);
      if (is_active !== undefined) payload.is_active = Boolean(is_active);
      if (sort_order !== undefined) payload.sort_order = Number(sort_order);

      const { data, error } = await adminSupabase.from('competitor_products').update(payload).eq('id', Number(id)).select('id, region_id, name, note, is_active, sort_order, created_at').single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Duplicate competitor product for region' });
        return res.status(500).json({ error: error.message });
      }
      return res.json(data);
    }

    if (req.method === 'DELETE') {
      const { error } = await adminSupabase.from('competitor_products').delete().eq('id', Number(id));
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
