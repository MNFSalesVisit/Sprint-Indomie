import { createClient } from '@supabase/supabase-js';

const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function verifyAdmin(token) {
  const { data: { user }, error } = await adminSupabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: appUser } = await adminSupabase
    .from('app_users')
    .select('id, roles(name)')
    .eq('email', user.email)
    .single();
  if (!appUser) return null;
  const role = appUser.roles?.name;
  if (!['Admin', 'Super Admin', 'Manager'].includes(role)) return null;
  return appUser;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });

  const { path, download } = req.query;
  if (!path) return res.status(400).json({ error: 'path is required' });

  // Security: only allow paths inside the receipts/ folder
  if (!path.startsWith('receipts/')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const forDownload = download === '1' || download === 'true';

  const { data, error } = await adminSupabase.storage
    .from('visit-media')
    .createSignedUrl(path, 3600, forDownload ? { download: true } : {});

  if (error) return res.status(500).json({ error: error.message });
  if (!data?.signedUrl) return res.status(404).json({ error: 'File not found' });

  const filename = path.split('/').pop();
  return res.status(200).json({ url: data.signedUrl, filename });
}
