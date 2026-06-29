const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  try {
    const { data, error } = await supabase
      .from('visits')
      .select('id')
      .limit(1);

    if (error) {
      console.error('Query error:', error.message || error);
      process.exit(1);
    }

    console.log('Query result (first row or empty):', data);
  } catch (e) {
    console.error('Unexpected error:', e.message || e);
    process.exit(1);
  }
}

run();
