import { adminSupabase, requireSuperAdmin } from '../../../../lib/adminAuth';

export default async function handler(req, res) {
  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.query;

    // ── PUT /api/admin/products/[id] ────────────────────────────────────────
    if (req.method === 'PUT') {
      const { sku, name, is_active, sort_order } = req.body || {};
      const trimSku  = (sku  || '').trim().toUpperCase();
      const trimName = (name || '').trim();
      if (!trimSku)  return res.status(400).json({ error: 'SKU is required' });
      if (!trimName) return res.status(400).json({ error: 'Product name is required' });

      const payload = { sku: trimSku, name: trimName, is_active: Boolean(is_active) };
      if (sort_order !== undefined) payload.sort_order = Number(sort_order);

      const { data, error } = await adminSupabase
        .from('products')
        .update(payload)
        .eq('id', id)
        .select('id, sku, name, is_active, sort_order')
        .single();

      if (error) {
        if (error.code === '23505') {
          const field = error.message.includes('sku') ? 'SKU' : 'product name';
          return res.status(409).json({ error: `A product with this ${field} already exists` });
        }
        return res.status(500).json({ error: error.message });
      }
      return res.json(data);
    }

    // ── DELETE /api/admin/products/[id] ─────────────────────────────────────
    if (req.method === 'DELETE') {
      const { error } = await adminSupabase.from('products').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
