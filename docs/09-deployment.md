# Deployment & Environment Setup

Supabase setup
- Create a Supabase project; enable Postgres and Storage.
- Apply SQL migration: `supabase/migrations/001_init.sql` (via psql or Supabase CLI).
- Create Storage bucket `selfies` (private) and configure service role key for scheduled tasks.

Environment variables (example)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)

Deployment targets
- Frontend: Vercel (recommended for Next.js) or any Node host.
- Scheduled job: run `scripts/retention/delete_old_selfies` daily using GitHub Actions, serverless cron, or a small VM.

Backups & recovery
- Configure Supabase automatic backups and test restore process.

Secrets & keys
- Keep `SUPABASE_SERVICE_ROLE_KEY` secret; only server-side code or scheduled jobs should use it.
