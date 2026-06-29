import { createClient } from '@supabase/supabase-js';

export const adminSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Validates the Bearer token in the request and returns the
 * authenticated user only if their role is "Super Admin".
 * Returns null if unauthorized.
 */
export async function requireSuperAdmin(req) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return null;

    // Safe destructure — getUser can return { data: null } on network errors
    const result = await adminSupabase.auth.getUser(token);
    const user = result?.data?.user;
    if (result?.error || !user) return null;

    // Look up by email so app_users.id does not need to match auth.uid
    const { data: appUser } = await adminSupabase
      .from('app_users')
      .select('role_id, roles(name)')
      .eq('email', user.email)
      .single();

    if (appUser?.roles?.name !== 'Super Admin') return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * Validates the Bearer token and returns the user if their role is
 * Admin, Super Admin, or Manager. Returns null if unauthorized.
 *
 * For Manager: allowedRegionIds is always [] so they see all regions.
 *   Pass ?region_id=X in the API request to apply a specific region filter.
 * For Admin: allowedRegionIds comes from their user_regions assignments.
 * For Super Admin: allowedRegionIds is [] (all regions).
 *
 * Returns: { id, role, allowedRegionIds } or null
 */
export async function verifyAdminOrManager(req) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return null;

    const result = await adminSupabase.auth.getUser(token);
    const user = result?.data?.user;
    if (result?.error || !user) return null;

    const { data: appUser } = await adminSupabase
      .from('app_users')
      .select('id, roles(name), user_regions(region_id)')
      .eq('email', user.email)
      .single();

    if (!appUser) return null;
    const role = appUser.roles?.name;
    if (!['Admin', 'Super Admin', 'Manager'].includes(role)) return null;

    let allowedRegionIds = (appUser.user_regions || []).map(r => r.region_id);

    // Manager sees all regions by default; respect an explicit ?region_id filter
    if (role === 'Manager') {
      const rid = req.query?.region_id ? parseInt(req.query.region_id) : null;
      allowedRegionIds = rid ? [rid] : [];
    }
    // Super Admin: no region restriction
    if (role === 'Super Admin') allowedRegionIds = [];

    return { id: appUser.id, role, allowedRegionIds };
  } catch {
    return null;
  }
}
