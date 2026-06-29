# API Specification (core endpoints)

Auth
- POST /api/auth/otp - request OTP (Supabase-managed)
- POST /api/auth/verify - verify OTP/session

Users & Admin
- GET /api/users - (admin) list users
- POST /api/users - (super-admin) create user / bulk import
- PATCH /api/users/:id - update user, assign regions/vehicle

Regions, Products, Shops
- GET /api/regions, /api/subregions
- CRUD /api/products, /api/shops (super-admin)

Visits
- POST /api/visits - create visit (sales or uplift type) with: user_id (from session), shop_id or new shop info, visit_type, items [product_id, stock_position, sold, not_sold_reason], selfie (upload to storage) — captures GPS server-side from request body.
- GET /api/visits?filters - list visits (RBAC, with region/subregion filters)

Uplifts
- POST /api/uplifts - create uplift request (cartons, receipt upload)
- GET /api/uplifts?status=pending - admin listing
- POST /api/uplifts/:id/approve - admin approves (updates `stock_balances` and `uplifts`)
- POST /api/uplifts/:id/reject - admin rejects (store reason)

Stock & Targets
- GET /api/stock-balances?user_id=
- POST /api/stock-adjustments - (super-admin) manual adjustments
- POST /api/targets - assign monthly targets

Reports & Exports
- GET /api/reports/uplifters - filters: year, month, region, subregion, salesperson
- GET /api/reports/customers - shop-level
- GET /api/reports/map?type=visit|uplift - returns geo points (export HTML option)
- Exports return CSV/Excel via streaming responses.

Auth & RBAC: All endpoints require session token; backend enforces role checks and RLS policies.
