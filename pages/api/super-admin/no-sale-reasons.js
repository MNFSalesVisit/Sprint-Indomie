/**
 * /api/super-admin/no-sale-reasons
 *
 * GET    — list all reasons (active + inactive)
 * POST   — create a new reason  { label, sort_order? }
 * PUT    — update a reason       { id, label?, is_active?, sort_order? }
 * DELETE — delete a reason       { id }
 *
 * Super Admin only.
 */
import { adminSupabase, requireSuperAdmin } from '../../../lib/adminAuth';

export default async function handler(req, res) {
  const actor = await requireSuperAdmin(req);
  if (!actor) return res.status(403).json({ error: 'Forbidden' });

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await adminSupabase
      .from('no_sale_reasons')
      .select('id, label, is_active, sort_order, created_at')
      .order('sort_order', { ascending: true })
      .order('id',         { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ── POST (create) ────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { label, sort_order } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: 'label is required' });

    const { data, error } = await adminSupabase
      .from('no_sale_reasons')
      .insert({
        label:      label.trim(),
        is_active:  true,
        sort_order: sort_order !== undefined ? parseInt(sort_order, 10) : 0,
      })
      .select('id, label, is_active, sort_order, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  // ── PUT (update) ─────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const { id, label, is_active, sort_order } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const patch = {};
    if (label     !== undefined) patch.label      = label.trim();
    if (is_active !== undefined) patch.is_active  = Boolean(is_active);
    if (sort_order !== undefined) patch.sort_order = parseInt(sort_order, 10);

    if (Object.keys(patch).length === 0)
      return res.status(400).json({ error: 'Nothing to update' });

    const { data, error } = await adminSupabase
      .from('no_sale_reasons')
      .update(patch)
      .eq('id', id)
      .select('id, label, is_active, sort_order, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { error } = await adminSupabase
      .from('no_sale_reasons')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
