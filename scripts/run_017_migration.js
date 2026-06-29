#!/usr/bin/env node
// Runs migration 017: seeds manager feature flags into the features table.
// Usage: node scripts/run_017_migration.js

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env variables.');
  process.exit(1);
}

// Use the PostgREST upsert endpoint directly — no need for a custom RPC.
const rows = [
  { key: 'mgr_dashboard',  name: 'Dashboard (Manager)',           enabled: true },
  { key: 'mgr_fuel',       name: 'Fuel Management (Manager)',     enabled: true },
  { key: 'mgr_targets',    name: 'Targets (Manager)',             enabled: true },
  { key: 'mgr_customer',   name: 'Customer Analysis (Manager)',   enabled: true },
  { key: 'mgr_competitor', name: 'Competitor Analysis (Manager)', enabled: true },
];

const body = JSON.stringify(rows);
const url  = new URL(SUPABASE_URL + '/rest/v1/features');

const options = {
  hostname: url.hostname,
  path:     url.pathname + '?on_conflict=key',
  method:   'POST',
  headers: {
    'Content-Type':  'application/json',
    'Prefer':        'resolution=ignore-duplicates',
    'apikey':        SERVICE_KEY,
    'Authorization': 'Bearer ' + SERVICE_KEY,
    'Content-Length': Buffer.byteLength(body),
  },
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode === 201 || res.statusCode === 200 || res.statusCode === 204) {
      console.log('Migration 017 applied successfully. Manager feature flags seeded.');
    } else {
      console.error('Unexpected status ' + res.statusCode + ':', data);
      process.exit(1);
    }
  });
});
req.on('error', (e) => { console.error('Request error:', e.message); process.exit(1); });
req.write(body);
req.end();
