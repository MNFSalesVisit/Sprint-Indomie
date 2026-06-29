/**
 * GET /api/sales/no-sale-reasons
 * Returns the list of active no-sale reasons ordered by sort_order.
 * Used by the Sales page so reasons are never hardcoded in the frontend.
 * No auth required — reasons are not sensitive data.
 */
import { adminSupabase } from '../../../lib/adminAuth';

const FALLBACK = [
  { id: 1, label: 'Financial constraints' },
  { id: 2, label: 'Stock available' },
  { id: 3, label: 'Other (enter manually)' },
];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Cache-Control', 'private, no-store');

  const { data, error } = await adminSupabase
    .from('no_sale_reasons')
    .select('id, label')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('id',         { ascending: true });

  if (error) {
    console.error('[no-sale-reasons] DB error:', error.message);
    return res.json(FALLBACK);
  }

  return res.json(data && data.length > 0 ? data : FALLBACK);
}
