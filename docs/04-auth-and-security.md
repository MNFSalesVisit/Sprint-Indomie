# Auth & Security

Auth
- Use Supabase Email OTP (magic link/otp) for salesperson login.
- Super Admin manages users and roles; consider provisioning initial super-admin manually.

RBAC
- Roles: `super_admin`, `admin`, `salesperson` (store in `roles` table).
- Enforce in backend and with Postgres RLS policies.

RLS policy examples
- `visits`: allow select/insert for `auth.uid() = user_id`; allow admin/super-admin to select/update all.
- `stock_balances`: salespersons can read their own balances; only admins/super-admins can adjust others.

Security controls
- Encrypt sensitive fields at rest via Supabase defaults (Postgres + managed infra).
- Session management: keep sessions active until logout; implement account lockout after repeated failed attempts via audit logs and a flag in `app_users`.
- Audit logging: insert into `audit_logs` for critical actions (uplift approvals, manual stock adjustments, role changes).

Selfie & GPS privacy
- Store selfie files in `selfies` bucket; restrict public access (signed URLs for viewing only).
- Retention: delete files older than 5 months using `scripts/retention/delete_old_selfies` (scheduled job).
- Minimize stored GPS precision if required for privacy.

Compliance
- Keep access logs and retention policy documentation.
- Document data deletion and user data export procedures for requests.
