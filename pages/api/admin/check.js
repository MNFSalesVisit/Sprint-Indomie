import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Missing access token' });

  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr) return res.status(401).json({ error: 'Invalid token' });
    const user = userData.user;
    if (!user) return res.status(401).json({ error: 'No user' });

    // Look up by email so app_users.id does not need to equal auth.uid
    let appUser;
    const { data: appUserFull, error: queryErr } = await supabase
      .from('app_users')
      .select('id, role_id, full_name, avatar_url, username, position')
      .eq('email', user.email)
      .limit(1);

    if (queryErr) {
      // Fallback: column may not exist in DB yet (migration pending)
      const { data: appUserBasic } = await supabase
        .from('app_users')
        .select('id, role_id, full_name')
        .eq('email', user.email)
        .limit(1);
      appUser = appUserBasic;
    } else {
      appUser = appUserFull;
    }

    if (!appUser || appUser.length === 0) return res.status(403).json({ error: 'No app user' });
    const { role_id: roleId, full_name = null, avatar_url = null, username = null, position = null } = appUser[0];
    const { data: role } = await supabase.from('roles').select('name').eq('id', roleId).limit(1);
    const roleName = role && role[0] ? role[0].name : null;
    return res.status(200).json({ role: roleName, full_name: full_name || null, avatar_url: avatar_url || null, username: username || null, position: position || null });
  } catch (err) {
    return res.status(500).json({ error: err.message || err });
  }
}
