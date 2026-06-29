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
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 5);
    const cutoffISO = cutoff.toISOString();

    // Find visits with selfies older than cutoff
    const { data: rows, error } = await supabase
      .from('visits')
      .select('id, selfie_path')
      .not('selfie_path', 'is', null)
      .lt('created_at', cutoffISO)
      .limit(1000);

    if (error) throw error;
    if (!rows || rows.length === 0) {
      console.log('No old selfies to delete.');
      return;
    }

    for (const row of rows) {
      const { id, selfie_path } = row;
      if (!selfie_path) continue;
      // Attempt to delete from storage (assumes bucket 'selfies')
      try {
        const { error: rmErr } = await supabase.storage.from('selfies').remove([selfie_path]);
        if (rmErr) {
          console.warn(`Failed to remove file ${selfie_path}:`, rmErr.message || rmErr);
        } else {
          // Clear DB reference
          const { error: updErr } = await supabase
            .from('visits')
            .update({ selfie_path: null })
            .eq('id', id);
          if (updErr) console.warn(`Failed to clear selfie_path for visit ${id}:`, updErr.message || updErr);
          else console.log(`Deleted and cleared selfie for visit ${id}`);
        }
      } catch (e) {
        console.error('Error processing', selfie_path, e.message || e);
      }
    }
  } catch (err) {
    console.error('Retention script failed:', err.message || err);
    process.exit(1);
  }
}

run();
