import { adminSupabase, requireSuperAdmin } from '../../../../lib/adminAuth';

export default async function handler(req, res) {
  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });

    // ── GET /api/admin/products ─────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await adminSupabase
        .from('products')
        .select('id, sku, name, is_active, sort_order')
        .order('sort_order')
        .order('id');
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // ── POST /api/admin/products ────────────────────────────────────────────
    if (req.method === 'POST') {
      const { sku, name } = req.body || {};
      const trimSku  = (sku  || '').trim().toUpperCase();
      const trimName = (name || '').trim();
      if (!trimSku)  return res.status(400).json({ error: 'SKU is required' });
      if (!trimName) return res.status(400).json({ error: 'Product name is required' });

      // Auto-assign sort_order = (max existing) + 10
      const { data: existing } = await adminSupabase.from('products').select('sort_order').order('sort_order', { ascending: false }).limit(1);
      const nextOrder = existing && existing.length > 0 ? (existing[0].sort_order || 0) + 10 : 10;

      const { data, error } = await adminSupabase
        .from('products')
        .insert({ sku: trimSku, name: trimName, sort_order: nextOrder })
        .select('id, sku, name, is_active, sort_order')
        .single();

      if (error) {
        if (error.code === '23505') {
          const field = error.message.includes('sku') ? 'SKU' : 'product name';
          return res.status(409).json({ error: `A product with this ${field} already exists` });
        }
        return res.status(500).json({ error: error.message });
      }
      return res.status(201).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
