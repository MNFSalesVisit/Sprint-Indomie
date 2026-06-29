import { adminSupabase, requireSuperAdmin } from '../../../../lib/adminAuth';

export default async function handler(req, res) {
  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.query;

    if (req.method === 'PUT') {
      const { name } = req.body || {};
      const trimmed = (name || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'Subregion name is required' });

      const { data, error } = await adminSupabase
        .from('subregions')
        .update({ name: trimmed })
        .eq('id', id)
        .select('id, name, region_id')
        .single();

      if (error) {
        if (error.code === '23505')
          return res.status(409).json({ error: `A subregion named "${trimmed}" already exists in this region` });
        return res.status(500).json({ error: error.message });
      }

      return res.json(data);
    }

    if (req.method === 'DELETE') {
      const { error } = await adminSupabase.from('subregions').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
