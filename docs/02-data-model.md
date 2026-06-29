# Data Model (high-level)

Primary entities (see `supabase/migrations/001_init.sql`):
- `app_users`: id, email, full_name, role_id, vehicle, is_active
- `roles`: Super Admin, Admin, Salesperson
- `regions`, `subregions` and `user_regions` (assignment)
- `products` (SKUs)
- `shops`: name, location, region/subregion, coordinates
- `stock_balances`: per-user per-product quantity
- `visits` + `visit_items`: stores visit meta, selfie_path, GPS, per-SKU stock and sold
- `uplifts` + `uplift_items`: uplift requests, status, receipt_path, approval metadata
- `targets`: monthly targets per salesperson
- `audit_logs`: actor, action, entity, details

Indexes & performance:
- Index `visits(user_id, created_at)`, `uplifts(status)`, `stock_balances(user_id,product_id)` recommended.

Retention & storage:
- Selfies stored in Supabase Storage bucket `selfies`.
- Retention enforced by scheduled script `scripts/retention/delete_old_selfies`.

Security & RLS notes:
- Enable Row Level Security on `visits`, `stock_balances`, `uplifts`, `shops`.
- Policies: salespersons can access their own visits/uplifts/stock; admins and super-admins have broader access.
- Use `auth.uid()` in policies to compare against `app_users.id` (string cast as needed).
