/**
 * GET /api/super-admin/throttle-status
 * Returns current system load level and usage numbers.
 * Super Admin only. Cached 45 s server-side.
 */
import { adminSupabase } from '../../../lib/adminAuth';
import { getLoadState, isThrottlingEnabled } from '../../../lib/throttle';

async function verifySuperAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return false;
  const { data, error } = await adminSupabase.auth.getUser(token);
  if (error || !data?.user) return false;
  const { data: appUser } = await adminSupabase
    .from('app_users').select('role_id').eq('email', data.user.email).single();
  if (!appUser) return false;
  const { data: role } = await adminSupabase
    .from('roles').select('name').eq('id', appUser.role_id).single();
  return role?.name === 'Super Admin';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const ok = await verifySuperAdmin(req);
  if (!ok) return res.status(403).json({ error: 'Forbidden' });

  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');

  const [state, enabled] = await Promise.all([getLoadState(), isThrottlingEnabled()]);
  return res.status(200).json({ ...state, throttlingEnabled: enabled });
}
