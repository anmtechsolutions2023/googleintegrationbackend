# POS Front Desk Integration Plan (RestroOS → Platform)

Integrate the **RestroOS** restaurant POS (repo: `searchkota2021/Restro2026`, deployed at
https://searchkota2021.github.io/Restro2026/) as a **Front Desk** section of the existing
platform. The current master-data modules become the backend support portal for it.

- **Backend:** `googleintegrationbackend` (Node/Express/MySQL, multi-tenant, JWT+scopes+audit)
- **Frontend:** `googleintegrationfrontend/tenant-auth-ui` (React 18 CRA) — POS lives here as a
  new section next to Master Data / Audit Logs.

## Source app (RestroOS) facts
- Vanilla JS SPA, no framework/build. All state in a global `restrosDB` object persisted to
  `localStorage` via `js/db.js` (`initDB`/`saveDB`). 14 sidebar tabs.
- Ships its own Node backend + `restro_os` schema, but it is **not wired to the frontend**
  (localStorage only) — treat that backend as reference material.
- Must be **ported to React**; cannot be dropped in as-is.

## Confirmed decisions
1. Phase-1 scope: **everything** (all 14 tabs, incl. building backends for current mock stubs).
2. POS-specific data: **new modules in the backend** (single source of truth).
3. Hosting: inside **tenant-auth-ui** React app (new `/frontdesk/*` section + nav link).
4. **Branch-scoped:** every `pos_*` table carries `BranchId`; every query filters by the
   cashier's branch (resolved via existing `branchusergroupmapper`).
5. Menu items: **reuse `itemdetail`** for the item core + a linked **`pos_item_meta`** table for
   POS-only fields (channels, per-channel prices, foodType, variants, addons).
6. Every new endpoint is **audit-logged**; full **IAM** (features/roles/permissions/scopes) for
   POS following the existing category×READ/WRITE pattern; all new code follows **SOLID**.

## Verified codebase standards (the plan conforms to these)
- **DB/ID standard** (`database/01-schema-definition.sql`): `Id VARCHAR(50)` app-generated UUID
  PK (Joi `.uuid()` validated), `TenantId VARCHAR(50) NOT NULL`, `Active TINYINT(1)`, four
  standard audit columns `CreatedOn DATETIME, CreatedBy VARCHAR(50), UpdatedOn DATETIME,
  UpdatedBy VARCHAR(50)`, `UNIQUE(Name, TenantId)`, FKs for referential integrity.
- **Scope string** = `feature_short_name:scope` (e.g. `MASTER_DATA:READ`), built in
  `auth.service.js` from `features` × `role_permissions` × `user_roles`. Features = business
  category × {READ, WRITE}. Super-admin (`TENANT:SUPER_ADMIN`) bypasses `checkScope`.
- **Audit:** `auditLogCrud(moduleName, category, level)` / `auditLog(category, level, label)` on
  each route → `audit_logs`, visible to admin/super-admin in the Audit Logs UI, filterable by
  `AUDIT_CATEGORIES`.
- **Module pattern:** controller-as-array; `routes → controller → service → constants/messages`;
  data access only via `dbHelper` `withConnection`/`withTransaction`.

---

## Part A — Backend: Database (`database/03-pos-schema.sql` + `migrations/00X_pos_*.sql`)
Every table: `Id VARCHAR(50)` UUID PK, `TenantId`, `BranchId`, `Active`, 4 audit columns,
`UNIQUE(..., TenantId)`, FKs.
- `pos_floor`, `pos_table` (FK floor)
- `pos_item_meta` (FK `itemdetail.Id`; channels, per-channel prices, foodType, variants, addons)
- `pos_order`, `pos_order_item` (FK `itemdetail`)
- `pos_kot`
- `pos_bill`, `pos_bill_payment` (FK `paymentmode`)
- `pos_customer` (or reuse `contactdetail`)
- Stub-now-real: `pos_online_order`, `pos_feedback`, `pos_token`, `pos_expense`, `pos_staff`

## Part B — Backend: Modules (SOLID, controller-as-array)
`src/modules/pos<x>/` (4-file split), registered under `/api/pos/*` in `routes.js`.
- **SRP:** routes → controller (HTTP/validation) → service (business rules) → queries in
  `constants.js`, strings in `messages.js`.
- **DIP:** services depend on `dbHelper` abstraction, never the raw pool.
- **OCP:** additive registration; existing modules untouched.
- **ISP/LSP:** per-operation Joi schemas; consistent `responseHelper` contracts.

## Part C — Backend: Audit logging (every new endpoint)
- Add `POS` to `AUDIT_CATEGORIES`.
- Every POS route: `auditLogCrud('POS Order', AUDIT_CATEGORIES.POS)` (CRUD) or
  `auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'Fired KOT')` (domain actions: fire KOT, settle bill,
  mark ready).
- Reused endpoints (`itemdetail`, `category`, `taxtype`, `paymentmode`) already carry
  `auditLogCrud` — verify before wiring.

## Part D — Backend: IAM for POS (features → roles → permissions → scopes)
New feature categories (each × READ + WRITE → scope strings), seeded like existing 12 features:

| feature_short_name | Scopes | Covers |
|---|---|---|
| `POS_CONFIG`  | `POS_CONFIG:READ/WRITE`  | floors, tables, menu/channel setup |
| `POS_ORDER`   | `POS_ORDER:READ/WRITE`   | order taking, table occupancy, KOT firing |
| `POS_KITCHEN` | `POS_KITCHEN:READ/WRITE` | KDS view / mark-ready |
| `POS_BILLING` | `POS_BILLING:READ/WRITE` | bill settlement, payments |
| `POS_CRM`     | `POS_CRM:READ/WRITE`     | customers, loyalty, feedback |
| `POS_OPS`     | `POS_OPS:READ/WRITE`     | inventory adj., expenses, tokens, online orders |
| `POS_REPORTS` | `POS_REPORTS:READ`       | POS dashboard & reports |

New roles (seeded into `roles` + `role_permissions`, per-tenant):
- `POS_CASHIER` — ORDER R/W, BILLING R/W, CRM R, CONFIG R
- `POS_WAITER` — ORDER R/W, KITCHEN R
- `POS_KITCHEN_STAFF` — KITCHEN R/W, ORDER R
- `POS_MANAGER` — all POS_* R/W + POS_REPORTS R

Route guard shape: `checkScope(SCOPES.POS_ORDER_WRITE, SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN)`.

**Onboarding integration:** after admin approves an onboarding request, assign a POS role via the
existing `PUT /api/admin/users/:email/roles`. Category-driven admin UI surfaces the new
features/roles automatically. New scopes land in JWT on next login.

## Part E — Frontend (tenant-auth-ui, React)
- New **"Front Desk"** nav link in `Navbar`, scope-gated (any `POS_*`/admin scope).
- New `/frontdesk/*` route tree in `App.js` under `ApprovedRoute` + `ScopeGuard` (respects JWT
  scopes like Master Data / Reports).
- Port RestroOS screens → `pages/frontdesk/*`; global `restrosDB` → `FrontDeskContext` hydrated
  from backend; replace `js/db.js` with `services/posService.js` over the existing axios
  `api/api.js` (Bearer + 401 handled).
- Add POS scopes to `constants/scopes.js`, POS modules to `config/modules.js` (Menu Master reuses
  the generic CRUD engine). Per-control gating via `hasScope`. Namespace POS CSS under `.frontdesk`.

## Part F — Phased delivery (each phase non-breaking & shippable)
0. Foundation: `03-pos-schema.sql` + POS features/roles/scopes seed + `POS` audit category;
   `/frontdesk` shell + nav link (scope-gated), localStorage behind a flag.
1. Menu Master + Dashboard on reused `itemdetail/category/taxtype` (+ `pos_item_meta`).
2. Tables/Floors + Billing & KOT + KDS — new `pos_*` modules, full audit + scope guards.
3. Inventory + CRM + Payments settlement.
4. Stub tabs (online orders, tracking, feedback, tokens, expenses) on new modules.
5. Hardening: Jest/Supertest per new module (incl. audit-write + scope-denial tests), RTL for POS
   pages, Swagger, Postman.

## Part G — Non-breaking guarantees
- Backend: additions only — new schema file, new `src/modules/pos*`, new lines in
  `routes.js`/`constants.js`/seed. Existing 40 modules + auth flow untouched.
- Frontend: new `/frontdesk/*` + new files; existing routes/guards/services unchanged; POS CSS
  namespaced.
- IAM: new features/roles are added rows; existing roles/scopes unchanged.
