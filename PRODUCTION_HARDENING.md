# Production Hardening & Optimisation — Salim Wazaran Kenya Sales App

Date: June 2026

---

## 1. Security Headers (next.config.js)

Added HTTP security headers applied to **every route** via `next.config.js`:

| Header | Value | Purpose |
|---|---|---|
| `X-Frame-Options` | `SAMEORIGIN` | Prevents clickjacking — the app can only be embedded in its own origin |
| `X-Content-Type-Options` | `nosniff` | Stops browsers guessing MIME types; prevents script injection via uploaded files |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter for older browsers |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Enforces HTTPS for 2 years, prevents protocol downgrade attacks |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Hides full URL path from third-party requests (e.g. map tiles) |
| `X-DNS-Prefetch-Control` | `on` | Speeds up DNS resolution for external resources (Supabase, Leaflet tiles) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(self)` | Locks camera/mic to none; geolocation only to same origin (GPS capture) |
| `X-Powered-By` (removed) | — | `poweredByHeader: false` hides Next.js version from attackers |

---

## 2. API Response Caching

All API routes now return `Cache-Control` headers matching data sensitivity and freshness requirements:

| Endpoint | Cache Policy | Reason |
|---|---|---|
| `/api/sales/dashboard` | `private, max-age=30, swr=60` | Per-user KPIs, short TTL |
| `/api/sales/performance` | `private, max-age=30, swr=60` | Per-user data |
| `/api/sales/stock` | `private, max-age=30, swr=60` | Inventory changes frequently |
| `/api/sales/meta` | `private, max-age=60, swr=120` | Regions/subregions rarely change |
| `/api/sales/profile` | `private, max-age=60, swr=120` | User profile rarely changes |
| `/api/sales/storage-settings` | `private, max-age=300, swr=600` | App config very stable |
| `/api/sales/subregions` | `s-maxage=300, swr=3600` | Public, CDN-cacheable |
| `/api/admin/dashboard` | `private, max-age=60, swr=120` | Admin summary |
| `/api/admin/map-data` | `private, max-age=30, swr=60` | Map refreshes every 30s |
| `/api/admin/uplifts` | `private, max-age=15, swr=30` | Near-real-time approval queue |
| `/api/sales/products` | `no-store` | Submitted per visit, must be fresh |
| `/api/sales/no-sale-reasons` | `private, no-store` | Sensitive per-visit data |

---

## 3. Server-Side In-Process Cache (lib/serverCache.js)

A lightweight TTL Map cache (`lib/serverCache.js`) eliminates repeated database hits within the same server process:

- `getCache(key)` / `setCache(key, value, ttlMs)` / `deleteCache(key)` / `deleteCacheByPrefix(prefix)`
- Used by: dashboard, performance, SKU analysis, stock position, competitor analysis, reasons-not-sold, map meta, branding, throttle state
- TTLs range from **45 seconds** (throttle state) to **5 minutes** (meta/config data)
- Cache is invalidated on write operations (visits, uplift approve/reject, shop registration)

---

## 4. Intelligent Adaptive Throttling (lib/throttle.js)

LOW-priority endpoints (dashboards, reports, maps, analytics) are automatically slowed under load:

| Load Level | Monthly Edge Usage | Delay Applied |
|---|---|---|
| NORMAL | < 60% | 0 ms |
| WARNING | 60–80% | 500 ms |
| HIGH | 80–95% | 1 500 ms |
| CRITICAL | > 95% | 3 000 ms |

- HIGH-priority endpoints (visit submissions, auth, shop ops) are **never throttled**
- Throttle state is cached for 45 s to avoid DB polling per request
- Throttling can be toggled by Super Admin via the Throttle Config UI

---

## 5. Client-Side Caching (Admin & Sales Pages)

Both the admin and sales pages use **module-level JavaScript caches** to prevent re-fetching on tab switches within the same browser session:

**Sales page caches:**
- `_dashCache` — dashboard KPIs (3 min TTL)
- `_metaCache` — regions, subregions, competitor data (5 min TTL)
- `_stockCache` — salesperson stock balances (2 min TTL)
- `_visitShopsCache` — shop list per subregion (2 min TTL)

**Admin page caches:**
- `_perfCache`, `_custCache`, `_skuCache`, `_stkCache`, `_rnsCache`, `_mapMetaCache`
- All admin filter-heavy tabs also use **400 ms debounce** on filter changes to prevent rapid-fire requests

**Branding:**
- Branding config is cached in `localStorage` — applied instantly on next load before first paint (no colour flash)

---

## 6. Service Worker & Offline Support

A service worker (`public/sw.js`) is registered on app mount:
- Enables PWA install prompt
- Caches static assets for offline use
- Sales reps in low-connectivity areas can still navigate the app

---

## 7. Map UI Fixes Applied (June 2026)

- **Double popup removed** — unvisited shop markers no longer show a Leaflet popup AND a side panel simultaneously; only the side panel opens on click
- **"Invalid Date" fixed** — unvisited shop markers (shops not visited in the selected month) no longer show "Invalid Date"; the date field is conditionally hidden
- **"Never visited" label removed** — replaced with a neutral grey dot on unvisited markers; the label was misleading since the shop may have been visited in a prior month
- **SKU section hidden** for unvisited markers (no visit data exists to display)

---

## 8. Production Deployment Checklist

Before going live, verify:

- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set in production environment
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set as a **secret** (never exposed client-side)
- [ ] Supabase RLS policies enabled on all tables
- [ ] Supabase Auth email confirmation enabled (if required)
- [ ] `NEXT_PUBLIC_APP_URL` set to production domain
- [ ] DNS HTTPS certificate active (HSTS header requires HTTPS)
- [ ] Service worker HTTPS requirement met (SW only works on HTTPS)
- [ ] Super Admin throttle config updated with production edge limit

