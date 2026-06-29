import { adminSupabase, requireSuperAdmin } from '../../../../lib/adminAuth';

export default async function handler(req, res) {
  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });

    if (req.method === 'GET') {
      const { data, error } = await adminSupabase
        .from('regions')
        .select('id, name, subregions(id)')
        .order('name');

      if (error) return res.status(500).json({ error: error.message });

      const result = data.map(r => ({
        id: r.id,
        name: r.name,
        subregion_count: r.subregions ? r.subregions.length : 0,
      }));

      return res.json(result);
    }

    if (req.method === 'POST') {
      const { name } = req.body || {};
      const trimmed = (name || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'Region name is required' });

      const { data, error } = await adminSupabase
        .from('regions')
        .insert({ name: trimmed })
        .select('id, name')
        .single();

      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: `Region "${trimmed}" already exists` });
        return res.status(500).json({ error: error.message });
      }

      return res.status(201).json({ ...data, subregion_count: 0 });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
