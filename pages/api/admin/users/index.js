import { adminSupabase, requireSuperAdmin } from '../../../../lib/adminAuth';

export default async function handler(req, res) {
  try {
    const actor = await requireSuperAdmin(req);
    if (!actor) return res.status(403).json({ error: 'Forbidden' });

    // ── GET /api/admin/users ────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { data, error } = await adminSupabase
        .from('app_users')
        .select('id, email, full_name, avatar_url, username, position, is_active, created_at, vehicle, fuel_rate_km_per_litre, fuel_type, role_id, roles(id, name), user_regions(region_id)')
        .order('created_at', { ascending: false });

      // Fallback layer 1: drop optional columns if they don't exist yet
      if (error && error.code === '42703') {
        const { data: fb1, error: err1 } = await adminSupabase
          .from('app_users')
          .select('id, email, full_name, avatar_url, is_active, created_at, vehicle, role_id, roles(id, name), user_regions(region_id)')
          .order('created_at', { ascending: false });
        if (!err1) return res.json(fb1);

        // Fallback layer 2: drop avatar_url as well
        const { data: fb2, error: err2 } = await adminSupabase
          .from('app_users')
          .select('id, email, full_name, is_active, created_at, vehicle, role_id, roles(id, name), user_regions(region_id)')
          .order('created_at', { ascending: false });
        if (err2) return res.status(500).json({ error: err2.message });
        return res.json(fb2);
      }

      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    // ── POST /api/admin/users ───────────────────────────────────────────────
    if (req.method === 'POST') {
      const { email, full_name, role_id, vehicle, vehicle_type, fuel_rate_km_per_litre, fuel_type, region_ids, username, position } = req.body || {};

      if (!email || !role_id)
        return res.status(400).json({ error: 'email and role_id are required' });

      const normalizedEmail = email.toLowerCase().trim();
      const normalizedUsername = username?.trim().toLowerCase() || null;

      const { data: existing } = await adminSupabase
        .from('app_users')
        .select('id')
        .eq('email', normalizedEmail)
        .single();

      if (existing) return res.status(409).json({ error: 'A user with this email already exists' });

      // Check username uniqueness if provided
      if (normalizedUsername) {
        const { data: existingUsername } = await adminSupabase
          .from('app_users')
          .select('id')
          .ilike('username', normalizedUsername)
          .single();
        if (existingUsername) return res.status(409).json({ error: 'This username is already taken' });
      }

      const insertPayload = {
        email: normalizedEmail,
        full_name: full_name?.trim() || null,
        role_id: parseInt(role_id, 10),
        vehicle: vehicle_type || vehicle || null,
        username: normalizedUsername,
        position: position?.trim() || null,
      };
      if (fuel_type) insertPayload.fuel_type = fuel_type;
      if (fuel_rate_km_per_litre !== undefined && fuel_rate_km_per_litre !== '') {
        const parsed = parseFloat(fuel_rate_km_per_litre);
        if (isFinite(parsed)) insertPayload.fuel_rate_km_per_litre = parsed;
      }

      const { data: newUser, error: dbErr } = await adminSupabase
        .from('app_users')
        .insert(insertPayload)
        .select('id, email, full_name, username, position, is_active, created_at, vehicle, fuel_rate_km_per_litre, fuel_type, role_id, roles(id, name)')
        .single();

      if (dbErr) return res.status(500).json({ error: dbErr.message });

      // Assign regions if provided
      if (Array.isArray(region_ids) && region_ids.length > 0) {
        const assignments = region_ids.map(rid => ({ user_id: newUser.id, region_id: parseInt(rid, 10) }));
        await adminSupabase.from('user_regions').insert(assignments);
      }

      // Silently create the Supabase Auth account — no email is sent.
      // The admin uses the "Generate Invite Link" dialog to share a link via WhatsApp/chat.
      const { error: authErr } = await adminSupabase.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true, // mark as confirmed so recovery links work immediately
      });

      if (authErr && !authErr.message?.toLowerCase().includes('already been registered')) {
        return res.status(201).json({ ...newUser, invite_warning: authErr.message });
      }

      return res.status(201).json(newUser);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

