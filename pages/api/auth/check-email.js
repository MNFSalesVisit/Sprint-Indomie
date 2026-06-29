import { adminSupabase } from '../../../lib/adminAuth';

/**
 * POST /api/auth/check-email
 * Checks whether an email is whitelisted in app_users.
 * Used by the sign-up form to enforce admin-controlled access.
 *
 * Body: { email: string }
 * Returns: { allowed: boolean, reason?: string }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });

  const { data, error } = await adminSupabase
    .from('app_users')
    .select('id, is_active')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !data)
    return res.json({ allowed: false, reason: 'Email not registered. Contact your administrator.' });

  if (!data.is_active)
    return res.json({ allowed: false, reason: 'Your account is disabled. Contact your administrator.' });

  return res.json({ allowed: true });
}
