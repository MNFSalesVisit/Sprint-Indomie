import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const MAX_REUPLOADS = 3;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  const userId = appUser.id;
  const { uplift_id, receipt_base64, note } = req.body;

  if (!uplift_id || !receipt_base64) {
    return res.status(400).json({ error: 'uplift_id and receipt_base64 are required' });
  }

  // ── Validate the uplift ───────────────────────────────────────────────────
  const { data: uplift, error: upliftErr } = await adminSupabase
    .from('uplifts')
    .select('id, user_id, status, reupload_count')
    .eq('id', uplift_id)
    .single();

  if (upliftErr || !uplift) return res.status(404).json({ error: 'Uplift not found' });
  if (uplift.user_id !== userId) return res.status(403).json({ error: 'Not your uplift' });
  if (uplift.status !== 'rejected') {
    return res.status(400).json({ error: `Cannot reupload — uplift is ${uplift.status}` });
  }

  const currentCount = uplift.reupload_count || 0;
  if (currentCount >= MAX_REUPLOADS) {
    return res.status(400).json({
      error: 'Maximum reupload attempts reached. Please contact your admin.',
    });
  }

  // ── Upload new receipt ────────────────────────────────────────────────────
  // Ensure the bucket exists (safe to call even if it already exists)
  await adminSupabase.storage.createBucket('visit-media', {
    public: false,
    fileSizeLimit: 10485760,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  });

  const matches = receipt_base64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: 'Invalid receipt format. Please re-select the file.' });

  const mimeType = matches[1];
  const buffer   = Buffer.from(matches[2], 'base64');

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

  const fileName = `receipts/${userId}/${Date.now()}_reupload.${ext}`;

  const { error: uploadErr } = await adminSupabase.storage
    .from('visit-media')
    .upload(fileName, buffer, { contentType: mimeType, upsert: false });

  if (uploadErr) {
    return res.status(500).json({ error: `Receipt upload failed: ${uploadErr.message}` });
  }

  // ── Reset uplift to pending with new receipt ──────────────────────────────
  const { error: updateErr } = await adminSupabase
    .from('uplifts')
    .update({
      status:              'pending',
      receipt_path:        fileName,
      receipt_size_bytes:  buffer.length,
      rejected_reason:     null,
      approved_by:         null,
      approved_at:         null,
      is_reuploaded:       true,
      reupload_count:      currentCount + 1,
      reupload_note:       note?.trim() || null,
    })
    .eq('id', uplift_id);

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  // ── Audit log ─────────────────────────────────────────────────────────────
  await adminSupabase.from('audit_logs').insert({
    actor_id:  userId,
    action:    'uplift_receipt_reuploaded',
    entity:    'uplifts',
    entity_id: String(uplift_id),
    details:   { uplift_id, attempt: currentCount + 1, note: note?.trim() || null },
  });

  return res.status(200).json({ success: true, attempt: currentCount + 1 });
}
