import { adminSupabase } from '../../../lib/adminAuth';

/**
 * POST /api/auth/lookup-username
 * Resolves a username to the user's email address.
 * Used by the login page when the user types a username instead of an email.
 *
 * Body: { username: string }
 * Returns: { email: string } or 404
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username is required' });

  const { data, error } = await adminSupabase
    .from('app_users')
    .select('email, is_active')
    .ilike('username', username.trim())
    .single();

  if (error || !data) return res.status(404).json({ error: 'User not found' });
  if (!data.is_active) return res.status(403).json({ error: 'Your account is disabled. Contact your administrator.' });

  return res.json({ email: data.email });
}
