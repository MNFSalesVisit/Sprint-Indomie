import { adminSupabase, requireSuperAdmin } from '../../../../../lib/adminAuth';

export default async function handler(req, res) {
  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });

    const { id: userId } = req.query;

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { avatar_data } = req.body || {};
    if (!avatar_data || typeof avatar_data !== 'string') {
      return res.status(400).json({ error: 'avatar_data (base64 data URL) is required' });
    }

    // Parse "data:<mime>;base64,<data>"
    const match = avatar_data.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid image data format' });

    const [, mimeType, base64Data] = match;
    const ext = mimeType.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const buffer = Buffer.from(base64Data, 'base64');

    // Enforce 5 MB limit server-side
    if (buffer.byteLength > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image must be under 5 MB' });
    }

    // Create bucket if it doesn't exist (idempotent)
    await adminSupabase.storage.createBucket('avatars', { public: true }).catch(() => {});

    const filePath = `${userId}.${ext}`;
    const { error: uploadErr } = await adminSupabase.storage
      .from('avatars')
      .upload(filePath, buffer, { contentType: mimeType, upsert: true });

    if (uploadErr) return res.status(500).json({ error: uploadErr.message });

    const { data: { publicUrl } } = adminSupabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    // Append cache-buster so the browser doesn't show a stale image
    const avatarUrl = `${publicUrl}?t=${Date.now()}`;

    const { error: dbErr } = await adminSupabase
      .from('app_users')
      .update({ avatar_url: avatarUrl })
      .eq('id', userId);

    if (dbErr) return res.status(500).json({ error: dbErr.message });

    return res.json({ avatar_url: avatarUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
