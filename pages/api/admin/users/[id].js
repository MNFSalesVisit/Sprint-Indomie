import { adminSupabase, requireSuperAdmin } from '../../../../lib/adminAuth';

export default async function handler(req, res) {
  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });

    const { id } = req.query;

    // ── PUT /api/admin/users/[id] ───────────────────────────────────────────
    if (req.method === 'PUT') {
      const { full_name, role_id, vehicle, is_active, region_ids, vehicle_type, fuel_rate_km_per_litre, fuel_type, username, position } = req.body || {};

      if (!role_id) return res.status(400).json({ error: 'role_id is required' });

      const normalizedUsername = username?.trim().toLowerCase() || null;

      // Check username uniqueness (excluding current user)
      if (normalizedUsername) {
        const { data: existingUsername } = await adminSupabase
          .from('app_users')
          .select('id')
          .ilike('username', normalizedUsername)
          .neq('id', id)
          .single();
        if (existingUsername) return res.status(409).json({ error: 'This username is already taken' });
      }

      // Prepare update payload — include optional fuel fields when provided
      const updatePayload = {
        full_name: full_name?.trim() || null,
        role_id: parseInt(role_id, 10),
        vehicle: vehicle_type || vehicle || null,
        is_active: Boolean(is_active),
        username: normalizedUsername,
        position: position?.trim() || null,
      };
      if (typeof fuel_type !== 'undefined') updatePayload.fuel_type = fuel_type || null;
      if (typeof fuel_rate_km_per_litre !== 'undefined') {
        const parsed = parseFloat(fuel_rate_km_per_litre);
        updatePayload.fuel_rate_km_per_litre = isFinite(parsed) ? parsed : null;
      }

      const { data, error } = await adminSupabase
        .from('app_users')
        .update(updatePayload)
        .eq('id', id)
        .select('id, email, full_name, username, position, is_active, created_at, vehicle, fuel_rate_km_per_litre, fuel_type, role_id, roles(id, name)')
        .single();

      if (error) return res.status(500).json({ error: error.message });

      // Sync region assignments when region_ids is explicitly provided
      if (Array.isArray(region_ids)) {
        await adminSupabase.from('user_regions').delete().eq('user_id', id);
        if (region_ids.length > 0) {
          const assignments = region_ids.map(rid => ({ user_id: id, region_id: parseInt(rid, 10) }));
          await adminSupabase.from('user_regions').insert(assignments);
        }
      }

      return res.json(data);
    }

    // ── DELETE /api/admin/users/[id] ────────────────────────────────────────
    if (req.method === 'DELETE') {
      // Look up the auth UID by email first
      const { data: appUser, error: lookupErr } = await adminSupabase
        .from('app_users')
        .select('email')
        .eq('id', id)
        .single();

      if (lookupErr || !appUser)
        return res.status(404).json({ error: 'User not found' });

      // Remove from app_users (cascades region assignments via FK)
      const { error: dbErr } = await adminSupabase
        .from('app_users')
        .delete()
        .eq('id', id);

      if (dbErr) return res.status(500).json({ error: dbErr.message });

      // Also remove from Supabase Auth if the account exists there
      const { data: { users: authUsers } } = await adminSupabase.auth.admin.listUsers();
      const authUser = authUsers?.find(u => u.email === appUser.email);
      if (authUser) {
        await adminSupabase.auth.admin.deleteUser(authUser.id);
      }

      return res.json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
