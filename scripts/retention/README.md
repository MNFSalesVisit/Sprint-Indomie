Delete Old Selfies
===================

This script deletes selfie files in the `selfies` Supabase storage bucket for `visits` records older than 5 months, and clears the `selfie_path` column in the `visits` table.

Usage
-----

1. Set environment variables:

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
```

2. Install dependencies and run:

```bash
cd scripts/retention/delete_old_selfies
npm install
npm start
```

Deployment
----------
- Schedule this script as a cron job or a serverless function (e.g., Vercel Cron, GitHub Actions, or a small VM).
- Run at least daily; it processes up to 1000 records per run (adjust as needed).

Important
---------
- This script uses the Supabase Service Role key — keep it secret.
- Ensure the `selfies` bucket name matches your Supabase storage bucket.
- Test in a staging environment before running in production.
