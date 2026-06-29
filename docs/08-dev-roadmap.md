# Development Roadmap (suggested milestones)

Milestone 1 — Core infra & schema
- Deploy Supabase project, apply `supabase/migrations/001_init.sql`.
- Create `selfies` storage bucket and set policies.
- Configure service role key and env vars.

Milestone 2 — Auth & RLS
- Implement Supabase Email OTP login and user provisioning.
- Add RLS policies for `visits`, `uplifts`, `stock_balances`, `shops`.

Milestone 3 — API & Stock Logic
- Build API endpoints for visits, visit_items, uplifts, approvals, stock updates.
- Implement server-side validations (no oversell, uplift pending logic).

Milestone 4 — Frontend forms
- Sales portal forms (visit + uplift) with camera + GPS and validations.
- Admin dashboard, approvals UI, reports and map page.

Milestone 5 — Extras & Hardening
- Scheduled retention script deployment (delete_old_selfies).
- Backups, exports, audit logging, monitoring.
- Integrate WhatsApp notifications (deferred).

Testing & CI
- Add unit tests for core logic and integration tests for API flows.
- Add CI to run lint, tests, and deploy to staging.
