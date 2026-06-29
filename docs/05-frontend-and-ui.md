# Frontend & UI Guidance

Tech
- Next.js (React) — mobile-first UI. Use Supabase JS SDK for client auth and storage.
- Leaflet for map visualizations.

Pages & components to implement
- `/login` - email OTP flow.
- `/sales/dashboard` - Salesperson dashboard (analytics, stock box, uplift status, actions).
- `/sales/visit` - Sales Visit form: region, shop (new or existing), stock positions, sold qty, selfie capture, submit.
- `/sales/uplift` - Uplift form: cartons, receipt upload.
- `/admin/dashboard` - Admin metrics, pending uplifts.
- `/admin/uplifts` - Approvals list with approve/reject UI.
- `/admin/reports` - Uplifters, Customer Reports, Map.

UI details
- Required fields must be validated client-side and server-side.
- Selfie flow: open camera, capture, preview, upload to storage then create visit referencing `selfie_path`.
- GPS: capture via browser `navigator.geolocation` at submit; POST coords with visit.
- Status colors: Pending = orange, Approved = green, Rejected = red (show reason).

Mobile UX
- Prioritize fast forms, minimal inputs, offline not required.
- Use responsive components and large tap targets for field agents.
