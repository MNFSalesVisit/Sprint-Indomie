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
    .select('id, roles(name), user_regions(region_id)')
    .eq('email', user.email)
    .single();
  if (!appUser) return null;
  const role = appUser.roles?.name;
  if (!['Admin', 'Super Admin', 'Manager'].includes(role)) return null;
  const allowedRegionIds = (appUser.user_regions || []).map(r => r.region_id);
  return { id: appUser.id, role, allowedRegionIds };
}

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const admin = await verifyAdmin(token);
  if (!admin) return res.status(403).json({ error: 'Forbidden' });
  const { allowedRegionIds } = admin;

  // ── GET — list uplifts (default: pending) ────────────────────────────────────
  if (req.method === 'GET') {
    const status = req.query.status || 'pending';
    let upliftsQ = adminSupabase
      .from('uplifts')
      .select(`
        id, cartons, status, receipt_path, created_at,
        is_reuploaded, reupload_count, reupload_note,
        app_users!uplifts_user_id_fkey(id, full_name, email),
        shops(id, name, location),
        uplift_items(cartons, products(id, sku, name))
      `)
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (allowedRegionIds.length > 0) {
      // Shops in allowed regions — uplifts with a known shop_id
      const { data: shopRows } = await adminSupabase
        .from('shops').select('id').in('region_id', allowedRegionIds);
      const allowedShopIds = (shopRows || []).map(s => s.id);

      // Users in allowed regions — needed to match null-shop uplifts
      // (SQL IN never matches NULL so we must handle shop_id IS NULL separately)
      const { data: userRows } = await adminSupabase
        .from('user_regions').select('user_id').in('region_id', allowedRegionIds);
      const allowedUserIds = [...new Set((userRows || []).map(r => r.user_id))];

      if (allowedShopIds.length === 0 && allowedUserIds.length === 0) {
        return res.status(200).json([]);
      }

      // Build OR filter:
      //   shop_id IN (allowedShops)   - uplifts whose shop is in an allowed region
      //   OR user_id IN (allowedUsers) - any uplift from a salesperson in an allowed region
      //                                  (covers shop_id IS NULL AND shops with no region set)
      const orParts = [];
      if (allowedShopIds.length > 0) orParts.push(`shop_id.in.(${allowedShopIds.join(',')})`);
      if (allowedUserIds.length > 0)  orParts.push(`user_id.in.(${allowedUserIds.join(',')})`);
      upliftsQ = upliftsQ.or(orParts.join(','));
    }

    // Paginate so we are never silently capped at Supabase's 1 000-row default
    const _PAGE_SIZE = 1000;
    let _uplPage = 0;
    const allUplifts = [];
    let fetchError = null;
    while (true) {
      const { data: _rows, error: _err } = await upliftsQ
        .range(_uplPage * _PAGE_SIZE, (_uplPage + 1) * _PAGE_SIZE - 1);
      if (_err) { fetchError = _err; break; }
      if (!_rows || _rows.length === 0) break;
      allUplifts.push(..._rows);
      if (_rows.length < _PAGE_SIZE) break;
      _uplPage++;
    }
    if (fetchError) return res.status(500).json({ error: fetchError.message });
    const data = allUplifts;
    const error = null;
    if (error) return res.status(500).json({ error: error.message });

    const uplifts = (data || []).map(u => ({
      ...u,
      is_reuploaded:  u.is_reuploaded  ?? false,
      reupload_count: u.reupload_count  ?? 0,
      reupload_note:  u.reupload_note   ?? null,
    }));

    res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=30');
    return res.status(200).json(uplifts);
  }

  // ── PATCH — approve or reject an uplift ─────────────────────────────────────
  if (req.method === 'PATCH') {
    if (admin.role === 'Manager') return res.status(403).json({ error: 'Managers cannot approve or reject uplifts' });
    const { id, action, rejected_reason } = req.body;
    if (!id || !action) return res.status(400).json({ error: 'id and action are required' });
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action must be approve or reject' });

    // Fetch the uplift + its items
    const { data: uplift, error: upliftErr } = await adminSupabase
      .from('uplifts')
      .select('id, user_id, shop_id, status, uplift_items(product_id, cartons)')
      .eq('id', id)
      .single();

    if (upliftErr || !uplift) return res.status(404).json({ error: 'Uplift not found' });
    if (uplift.status !== 'pending') return res.status(400).json({ error: `Uplift is already ${uplift.status}` });

    // Region-scoped admin: verify this uplift's shop is in an allowed region
    if (allowedRegionIds.length > 0 && uplift.shop_id) {
      const { data: shopCheck } = await adminSupabase
        .from('shops').select('region_id').eq('id', uplift.shop_id).single();
      if (!shopCheck || !allowedRegionIds.includes(shopCheck.region_id))
        return res.status(403).json({ error: 'Not authorized to manage this uplift' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // Update status
    const { error: updateErr } = await adminSupabase
      .from('uplifts')
      .update({
        status:          newStatus,
        approved_by:     admin.id,
        approved_at:     new Date().toISOString(),
        rejected_reason: action === 'reject' ? (rejected_reason || null) : null,
      })
      .eq('id', id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // ── On approval: add uplifted cartons to salesperson's stock balances ──────
    if (action === 'approve' && uplift.uplift_items?.length > 0) {
      const userId     = uplift.user_id;
      const productIds = uplift.uplift_items.map(i => i.product_id);

      // Fetch current balances
      const { data: currentBalances } = await adminSupabase
        .from('stock_balances')
        .select('product_id, quantity')
        .eq('user_id', userId)
        .in('product_id', productIds);

      const balanceMap = {};
      (currentBalances || []).forEach(b => { balanceMap[String(b.product_id)] = b.quantity ?? 0; });

      // Add uplifted cartons per SKU — never go below 0
      const updatedBalances = uplift.uplift_items.map(item => ({
        user_id:      userId,
        product_id:   item.product_id,
        quantity:     Math.max(0, (balanceMap[String(item.product_id)] ?? 0) + (item.cartons || 0)),
        last_updated: new Date().toISOString(),
      }));

      const { error: balErr } = await adminSupabase
        .from('stock_balances')
        .upsert(updatedBalances, { onConflict: 'user_id,product_id' });

      if (balErr) {
        console.warn('stock_balances increase error:', balErr.message);
        return res.status(500).json({ error: 'Uplift approved but stock update failed: ' + balErr.message });
      }
    }

    return res.status(200).json({ success: true, status: newStatus });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
