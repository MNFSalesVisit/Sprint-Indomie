/**
 * Batch-migrate 14 admin API files:
 *  - Replace the inline verifyAdmin function with an import from lib/adminAuth
 *  - This makes Manager role work across all admin APIs
 */
const fs = require('fs');
const path = require('path');

// The old inline verifyAdmin function body (all variants have the same role guard line)
// We replace just the role-check line since function content may vary slightly
const OLD_ROLE_GUARD = `if (role !== 'Admin' && role !== 'Super Admin') return null;`;
const NEW_ROLE_GUARD = `if (!['Admin', 'Super Admin', 'Manager'].includes(role)) return null;`;

const apiDir = path.join(__dirname, '..', 'pages', 'api', 'admin');

function scan(dir) {
  const results = [];
  fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) results.push(...scan(p));
    else if (f.endsWith('.js')) results.push(p);
  });
  return results;
}

const files = scan(apiDir);
let updated = 0;
let skipped = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes(OLD_ROLE_GUARD)) {
    content = content.replace(new RegExp(OLD_ROLE_GUARD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), NEW_ROLE_GUARD);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated:', path.relative(path.join(__dirname, '..'), file));
    updated++;
  } else if (content.includes('verifyAdmin') && content.includes('allowedRegionIds')) {
    console.log('SKIPPED (already updated or different pattern):', path.relative(path.join(__dirname, '..'), file));
    skipped++;
  }
});

console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
