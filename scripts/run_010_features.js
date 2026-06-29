/**
 * One-time script: creates the `features` table and seeds the optional Admin tabs.
 * Run with:
 *   $env:SUPABASE_URL="https://xxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="..."; node scripts/run_010_features.js
 * Or set the vars in your shell first, then run:
 *   node scripts/run_010_features.js
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log('Connecting to:', process.env.SUPABASE_URL);

  // Use the REST API to run raw SQL via the rpc endpoint (pg_execute) if available,
  // otherwise fall back to individual upsert operations which work without raw SQL access.

  console.log('\nStep 1 — ensuring `features` table exists via upsert check…');

  // Test if table exists by attempting a select
  const { error: checkErr } = await supabase.from('features').select('id').limit(1);

  if (checkErr) {
    // Table does not exist (Supabase JS client cannot run DDL directly)
    console.error('\n❌  Table `features` does not exist (or schema cache error).');
    console.error('    The Supabase JS client cannot run CREATE TABLE.');
    console.error('\n    Please run this SQL in your Supabase dashboard → SQL Editor:\n');
    console.error('─'.repeat(60));
    console.error(`
CREATE TABLE IF NOT EXISTS features (
  id         serial       PRIMARY KEY,
  key        text         NOT NULL UNIQUE,
  name       text         NOT NULL,
  enabled    boolean      NOT NULL DEFAULT true,
  created_at timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO features (key, name, enabled) VALUES
  ('map',        'Map',                 true),
  ('customer',   'Customer Analysis',   true),
  ('competitor', 'Competitor Analysis', true),
  ('fuel',       'Fuel Management',     true)
ON CONFLICT (key) DO NOTHING;
`);
    console.error('─'.repeat(60));
    console.error('\nAfter running the SQL above, re-run this script to verify.');
    process.exit(1);
  }

  console.log('  ✓  Table exists.');

  // Step 2 — seed / upsert the feature rows
  console.log('\nStep 2 — seeding feature rows…');
  const rows = [
    { key: 'map',        name: 'Map',                 enabled: true },
    { key: 'customer',   name: 'Customer Analysis',   enabled: true },
    { key: 'competitor', name: 'Competitor Analysis', enabled: true },
    { key: 'fuel',       name: 'Fuel Management',     enabled: true },
  ];

  const { data, error: upsertErr } = await supabase
    .from('features')
    .upsert(rows, { onConflict: 'key', ignoreDuplicates: false })
    .select();

  if (upsertErr) {
    console.error('Upsert error:', upsertErr.message);
    process.exit(1);
  }

  console.log('  ✓  Rows upserted:');
  (data || rows).forEach(r => console.log(`     • ${r.key} → ${r.name}`));

  // Step 3 — verify
  console.log('\nStep 3 — verifying table contents…');
  const { data: all, error: selErr } = await supabase
    .from('features')
    .select('id, key, name, enabled')
    .order('id');

  if (selErr) { console.error('Select error:', selErr.message); process.exit(1); }

  console.log('  ✓  Current `features` table:');
  all.forEach(r => console.log(`     [${r.id}] ${r.key.padEnd(12)} "${r.name}"  enabled=${r.enabled}`));

  console.log('\n✅  Done. Feature Management tab should now work.');
}

run().catch(err => { console.error(err); process.exit(1); });
