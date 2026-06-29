const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment or .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function ensureRole(name) {
  const resp = await supabase.from('roles').select('id').eq('name', name).limit(1);
  if (resp.error) throw resp.error;
  if (resp.data && resp.data.length) return resp.data[0].id;
  const insertResp = await supabase.from('roles').insert({ name }).select('id').limit(1);
  if (insertResp.error) throw insertResp.error;
  if (insertResp.data && insertResp.data.length) return insertResp.data[0].id;
  throw new Error('Failed to ensure role ' + name);
}

async function run() {
  try {
    const email = process.env.SUPERADMIN_EMAIL || 'superadmin@example.com';
    const password = process.env.SUPERADMIN_PASSWORD || 'ChangeMe123!';

    // ensure roles exist
    const superRoleId = await ensureRole('Super Admin');
    await ensureRole('Admin');
    await ensureRole('Salesperson');

    // create auth user (admin)
    console.log('Creating auth user (if not exists)...');
    // Try to find existing user by email
    const listResp = await supabase.auth.admin.listUsers();
    if (listResp.error) throw listResp.error;
    const usersList = listResp.data?.users || listResp.data || [];
    const found = usersList.find(u => u.email === email);
    let userId;
    if (found) {
      userId = found.id || found.user?.id;
      console.log('User already exists with id', userId);
    } else {
      const createResp = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Super Admin' }
      });
      if (createResp.error) throw createResp.error;
      // inspect returned shapes
      const created = createResp.data || createResp;
      userId = created?.user?.id || created?.id || created?.user_id || null;
      // fallback: refresh list and search
      if (!userId) {
        const retry = await supabase.auth.admin.listUsers();
        const retryList = retry.data?.users || retry.data || [];
        const found2 = retryList.find(u => u.email === email);
        userId = found2?.id || found2?.user?.id || null;
      }
      if (!userId) throw new Error('Failed to determine created user id');
      console.log('Created auth user with id', userId);
    }

    // insert into app_users if not exists
    const appResp = await supabase.from('app_users').select('id').eq('id', userId).limit(1);
    if (appResp.error) throw appResp.error;
    if (!appResp.data || appResp.data.length === 0) {
      const ins = await supabase.from('app_users').insert({ id: userId, email, full_name: 'Super Admin', role_id: superRoleId });
      if (ins.error) throw ins.error;
      console.log('Inserted user into app_users');
    } else {
      console.log('app_users entry already exists');
    }

    console.log('\nSeed complete. Credentials:');
    console.log('Email:', email);
    console.log('Password:', password);
    console.log('\nRun the app and sign in using these credentials.');
  } catch (err) {
    console.error('Seed failed:', err.message || err);
    process.exit(1);
  }
}

run();
