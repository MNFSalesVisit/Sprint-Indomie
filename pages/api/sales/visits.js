import { createClient } from '@supabase/supabase-js';
import { logApiCall } from '../../../lib/apiLogger';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // Verify Salesperson role
  const { data: appUser, error: userErr } = await adminSupabase
    .from('app_users')
    .select('id, roles(name)')
    .eq('email', user.email)
    .single();
  if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });
  if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Forbidden' });
  logApiCall('/api/sales/visits', 'salesperson');

  const userId = appUser.id;
  const {
    shop_id,
    subregion_id,
    region_id,
    latitude,
    longitude,
    selfie_base64,
    visit_sold,
    visit_reason,
    sold_qty,
    stock_pos,
    products,
  } = req.body;

  // competitor_presence may be sent as a string or array from the client
  const rawCompetitor = req.body.competitor_presence;
  let competitor_presence = null;
  if (Array.isArray(rawCompetitor)) competitor_presence = rawCompetitor.filter(Boolean);
  else if (typeof rawCompetitor === 'string' && rawCompetitor.trim() !== '') competitor_presence = [rawCompetitor.trim()];

  if (!subregion_id || !region_id) return res.status(400).json({ error: 'subregion_id and region_id are required' });
  if (!visit_sold) return res.status(400).json({ error: 'visit_sold is required' });
  if (!selfie_base64) return res.status(400).json({ error: 'selfie_base64 is required' });

  // Validate at least one SKU sold when visit_sold === 'yes'
  if (visit_sold === 'yes' && Array.isArray(products)) {
    const totalSold = products.reduce((s, p) => s + (sold_qty?.[String(p.id)] || 0), 0);
    if (totalSold === 0) {
      return res.status(400).json({ error: 'Enter the number of cartons sold for at least one SKU.' });
    }
  }

  // Validate not-sold reason when visit_sold === 'no'
  if (visit_sold === 'no') {
    if (!visit_reason || !String(visit_reason).trim()) {
      return res.status(400).json({ error: 'Please select a reason why nothing was sold.' });
    }
    if (/^other/i.test(String(visit_reason).trim()) && !String(req.body.visit_other_reason || '').trim()) {
      return res.status(400).json({ error: 'Please describe the reason under "Other".' });
    }
  }

  //  Validate sold quantities against current stock balances 
  if (visit_sold === 'yes' && sold_qty && Array.isArray(products)) {
    const productIds = products.map(p => p.id);
    const { data: currentBalances } = await adminSupabase
      .from('stock_balances')
      .select('product_id, quantity')
      .eq('user_id', userId)
      .in('product_id', productIds);

    const balanceMap = {};
    (currentBalances || []).forEach(b => { balanceMap[String(b.product_id)] = b.quantity ?? 0; });

    for (const p of products) {
      const k       = String(p.id);
      const selling = sold_qty[k] || 0;
      const balance = balanceMap[k] ?? 0;
      if (selling > 0 && balance === 0) {
        return res.status(400).json({ error: `Cannot sell ${p.name}  your stock balance is 0.` });
      }
      if (selling > balance) {
        return res.status(400).json({ error: `Cannot sell ${selling} cartons of ${p.name}  only ${balance} available.` });
      }
    }
  }

  //  Upload selfie to Supabase Storage 
  let selfie_path = null;
  let selfie_size_bytes = null;
  try {
    const matches = selfie_base64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Invalid selfie data' });

    const mimeType = matches[1];
    const b64Data  = matches[2];
    const buffer   = Buffer.from(b64Data, 'base64');

    // ── Validate file size against storage settings ─────────────────────────
    const { data: storageSetting } = await adminSupabase
      .from('storage_settings')
      .select('max_size_bytes')
      .eq('file_type', 'selfie')
      .single();
    const maxBytes = storageSetting?.max_size_bytes ?? 2097152; // 2 MB default
    if (buffer.length > maxBytes) {
      const maxMB = (maxBytes / 1048576).toFixed(1);
      return res.status(400).json({ error: `Selfie is too large. Maximum size is ${maxMB} MB. Please retake the photo.` });
    }

    const ext      = mimeType.includes('png') ? 'png' : 'jpg';
    const fileName = `selfies/${userId}/${Date.now()}.${ext}`;

    const { error: uploadErr } = await adminSupabase.storage
      .from('visit-media')
      .upload(fileName, buffer, { contentType: mimeType, upsert: false });

    if (uploadErr) {
      console.warn('Selfie upload failed:', uploadErr.message);
    } else {
      selfie_path       = fileName;
      selfie_size_bytes = buffer.length;
    }
  } catch (e) {
    console.warn('Selfie processing error:', e.message);
  }

  //  Insert visit record 
  const { data: visit, error: visitErr } = await adminSupabase
    .from('visits')
    .insert({
      user_id:      userId,
      shop_id:      shop_id || null,
      region_id:    region_id,
      subregion_id: subregion_id,
      visit_type:   'sales',
      competitor_presence,
      latitude:     latitude || null,
      longitude:    longitude || null,
      selfie_path,
      selfie_size_bytes: selfie_size_bytes || null,
    })
    .select('id')
    .single();

  if (visitErr || !visit) {
    console.error('Visit insert error:', visitErr);
    return res.status(500).json({ error: 'Failed to save visit' });
  }

  //  Insert visit_items & deduct from stock balances 
  if (Array.isArray(products) && products.length > 0) {
    const items = products.map(p => ({
      visit_id:        visit.id,
      product_id:      p.id,
      stock_position:  stock_pos?.[String(p.id)] ?? 0,
      sold:            visit_sold === 'yes' ? (sold_qty?.[String(p.id)] || 0) : 0,
      not_sold_reason: visit_sold === 'no'
        ? (/^other/i.test((visit_reason || '').trim()) ? (req.body.visit_other_reason?.trim() || 'Other (no details provided)') : visit_reason)
        : null,
    }));

    const { error: itemsErr } = await adminSupabase.from('visit_items').insert(items);
    if (itemsErr) console.warn('visit_items insert error:', itemsErr.message);

    // Deduct sold quantities  clamp to 0, never go negative
    if (visit_sold === 'yes' && sold_qty) {
      const productIds = products.map(p => p.id);

      const { data: currentBalances } = await adminSupabase
        .from('stock_balances')
        .select('product_id, quantity')
        .eq('user_id', userId)
        .in('product_id', productIds);

      const balanceMap = {};
      (currentBalances || []).forEach(b => { balanceMap[String(b.product_id)] = b.quantity ?? 0; });

      const updatedBalances = products
        .filter(p => (sold_qty[String(p.id)] || 0) > 0)
        .map(p => ({
          user_id:      userId,
          product_id:   p.id,
          quantity:     Math.max(0, (balanceMap[String(p.id)] ?? 0) - (sold_qty[String(p.id)] || 0)),
          last_updated: new Date().toISOString(),
        }));

      if (updatedBalances.length > 0) {
        const { error: balErr } = await adminSupabase
          .from('stock_balances')
          .upsert(updatedBalances, { onConflict: 'user_id,product_id' });
        if (balErr) console.warn('stock_balances deduct error:', balErr.message);
      }
    }
  }

  return res.status(200).json({ success: true, visit_id: visit.id });
}