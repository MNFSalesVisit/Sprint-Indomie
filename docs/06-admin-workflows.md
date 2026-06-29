# Admin Workflows

Uplift approval flow
- Salesperson submits uplift → `uplifts.status = pending` (receipt stored in `receipt_path`).
- Notify admin (WhatsApp deferred); admin reviews from `/admin/uplifts`.
- Approve: update `uplifts` (approved_by, approved_at, status), and add cartons to `stock_balances` for the salesperson.
- Reject: set `status = rejected` and store `rejected_reason`.

Manual stock adjustments
- Super Admin can adjust `stock_balances` per SKU (audit every change).

Reports
- Uplifters Reports: filters (year/month/region/subregion/salesperson) → aggregate visits, shops sold, cartons sold, performance% (compare against `targets`).
- Customer Reports: shop-level visits, cartons purchased, current shop stock position.

Map
- Leaflet with markers showing shop, stock, sale status, selfie thumbnail, cartons uplifted.
- Export map data as HTML.

Targets
- Admin assigns monthly targets per salesperson (`targets` table).
- Performance percent = (actual cartons sold month-to-date) / target.
