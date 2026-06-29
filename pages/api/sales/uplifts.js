import { createClient } from '@supabase/supabase-js';
import { logApiCall } from '../../../lib/apiLogger';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const { data: { user }, error: authErr } = await adminSupabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: appUser, error: userErr } = await adminSupabase
    .from('app_users')
    .select('id, roles(name)')
    .eq('email', user.email)
    .single();
  if (userErr || !appUser) return res.status(403).json({ error: 'User not found' });
  if (appUser.roles?.name !== 'Salesperson') return res.status(403).json({ error: 'Forbidden' });
  logApiCall('/api/sales/uplifts', 'salesperson');

  const userId = appUser.id;

  /* ── GET — return this salesperson's pending uplifts ── */
  if (req.method === 'GET') {
    const { data: uplifts, error: fetchErr } = await adminSupabase
      .from('uplifts')
      .select(`
        id, cartons, status, created_at, receipt_path,
        shops ( id, name, location ),
        uplift_items ( cartons, products ( id, sku, name ) )
      `)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    return res.status(200).json(uplifts ?? []);
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const {
    shop_id,          // int | null
    subregion_id,     // int
    region_id,        // int
    latitude,         // float | null
    longitude,        // float | null
    uplift_qty,       // { [product_id]: number }  cartons taken back from shop
    stock_after,      // { [product_id]: number }  remaining stock at shop after uplift
    stock_after_unit, // { [product_id]: 'cartons'|'pcs' }
    receipt_base64,   // data-URL string
    products,         // [{ id, sku, name }]
  } = req.body;

  if (!subregion_id || !region_id) {
    return res.status(400).json({ error: 'subregion_id and region_id are required' });
  }
  if (!receipt_base64) {
    return res.status(400).json({ error: 'receipt_base64 is required' });
  }
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'products are required' });
  }

  const totalCartons = products.reduce(
    (s, p) => s + (uplift_qty?.[String(p.id)] || 0),
    0,
  );

  if (totalCartons === 0) {
    return res.status(400).json({ error: 'Enter the number of cartons for at least one SKU before submitting.' });
  }

  // ── Upload receipt to Supabase Storage ──────────────────────────────────────
  // ── Ensure the visit-media bucket exists (creates it if missing) ─────────────
  await adminSupabase.storage.createBucket('visit-media', {
    public: false,
    fileSizeLimit: 10485760,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  });
  // createBucket returns an error if the bucket already exists — that's fine, ignore it.

  // ── Upload receipt to Supabase Storage ──────────────────────────────────────
  let receipt_path = null;
  const matches = receipt_base64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
  if (!matches) {
    return res.status(400).json({ error: 'Invalid receipt format. Please re-select the file.' });
  }

  const mimeType = matches[1];
  const b64Data  = matches[2];
  const buffer   = Buffer.from(b64Data, 'base64');

  // ── Validate file size against storage settings ───────────────────────────
  const { data: storageSetting } = await adminSupabase
    .from('storage_settings')
    .select('max_size_bytes')
    .eq('file_type', 'receipt')
    .single();
  const maxBytes = storageSetting?.max_size_bytes ?? 5242880; // 5 MB default
  if (buffer.length > maxBytes) {
    const maxMB = (maxBytes / 1048576).toFixed(1);
    return res.status(400).json({ error: `Receipt is too large. Maximum allowed size is ${maxMB} MB. Please use a smaller file.` });
  }

  let ext = 'bin';
  if (mimeType.includes('pdf'))                                      ext = 'pdf';
  else if (mimeType.includes('png'))                                 ext = 'png';
  else if (mimeType.includes('jpeg') || mimeType.includes('jpg'))   ext = 'jpg';
  else if (mimeType.includes('webp'))                                ext = 'webp';

  const fileName = `receipts/${userId}/${Date.now()}.${ext}`;

  const { error: uploadErr } = await adminSupabase.storage
    .from('visit-media')
    .upload(fileName, buffer, { contentType: mimeType, upsert: false });

  if (uploadErr) {
    console.error('Receipt upload failed:', uploadErr.message);
    return res.status(500).json({
      error: `Receipt upload failed: ${uploadErr.message}. Please try again.`,
    });
  }

  receipt_path = fileName;
  const receipt_size_bytes = buffer.length;

  // ── Insert uplift record ─────────────────────────────────────────────────────
  // Try inserting with region_id/subregion_id (available if schema has those columns)
  let { data: uplift, error: upliftErr } = await adminSupabase
    .from('uplifts')
    .insert({
      user_id:      userId,
      shop_id:      shop_id || null,
      region_id:    region_id     ? parseInt(region_id)     : null,
      subregion_id: subregion_id  ? parseInt(subregion_id)  : null,
      cartons:      totalCartons,
      status:       'pending',
      receipt_path,
      receipt_size_bytes,
    })
    .select('id')
    .single();
  // Fallback: region_id / subregion_id columns may not exist yet — retry without them
  if (upliftErr && (upliftErr.code === '42703' || upliftErr.message?.includes('region_id') || upliftErr.message?.includes('subregion_id'))) {
    ({ data: uplift, error: upliftErr } = await adminSupabase
      .from('uplifts')
      .insert({
        user_id:  userId,
        shop_id:  shop_id || null,
        cartons:  totalCartons,
        status:   'pending',
        receipt_path,
        receipt_size_bytes,
      })
      .select('id')
      .single());
  }

  if (upliftErr || !uplift) {
    console.error('Uplift insert error:', upliftErr);
    return res.status(500).json({ error: upliftErr?.message || 'Failed to save uplift' });
  }

  // ── Insert uplift_items (one row per product) ────────────────────────────────
  const items = products.map(p => ({
    uplift_id:        uplift.id,
    product_id:       p.id,
    cartons:          uplift_qty?.[String(p.id)] || 0,
    stock_after:      stock_after?.[String(p.id)] ?? 0,
    stock_after_unit: stock_after_unit?.[String(p.id)] || 'cartons',
  }));

  let { error: itemsErr } = await adminSupabase.from('uplift_items').insert(items);
  if (itemsErr) {
    // Fallback: retry without stock_after columns in case migration 004 hasn't been applied yet
    const itemsFallback = items.map(({ stock_after: _sa, stock_after_unit: _sau, ...rest }) => rest);
    const { error: fallbackErr } = await adminSupabase.from('uplift_items').insert(itemsFallback);
    if (fallbackErr) console.warn('uplift_items insert error:', fallbackErr.message);
    else console.warn('uplift_items inserted without stock_after — run migration 004 to enable stock tracking.');
  }

  return res.status(200).json({ success: true, uplift_id: uplift.id });
}
