# Sales Visit System — Overview

Purpose: role-based ERP to manage field sales visits, stock control, uplifts, approvals and analytics.

Core modules:
- Super Admin: system configuration, user & access management, backups, master data, security.
- Admin: uplift approvals, reports, map, targets, performance monitoring.
- Salesperson: visit logging, uplift requests, stock updates, selfie + GPS capture.

Key constraints & decisions:
- Tech stack: Next.js frontend + Supabase (Postgres + Storage + Auth).
- No offline capability.
- Selfies retained for 5 months via scheduled deletion function.
- WhatsApp notifications deferred (integrate later via provider).

Primary goals for PoC:
- Implement secure auth (Supabase OTP), RBAC, and RLS.
- Build visit/uplift flows with strict stock controls.
- Provide admin approval flow, reports, and Leaflet map visualizations.
