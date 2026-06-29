import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function verifyAdmin(token) {
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: appUser } = await supabase
    .from('app_users')
    .select('id, roles(name)')
    .eq('email', user.email)
    .single();
  if (!appUser) return null;
  const role = appUser.roles?.name;
  if (!['Admin', 'Super Admin', 'Manager'].includes(role)) return null;
  return { id: appUser.id, role };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const admin = await verifyAdmin(token);
  if (!admin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { path } = req.query;
  if (!path) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Generate signed URL valid for 1 hour
  const { data, error } = await supabase.storage
    .from('visit-media')   // ← verify this matches your bucket name exactly
    .createSignedUrl(path, 3600);

  if (error) {
    console.error('[signed-url] Error:', error);
    return res.status(500).json({ error: 'Could not generate signed URL' });
  }

  return res.status(200).json({ url: data.signedUrl });
}