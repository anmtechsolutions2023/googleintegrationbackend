# Master Setup Gate — Backend Plan

First-time tenancy setup becomes a **mandatory, one-time gate**. Until a tenant
completes the `/master-setup` wizard, its users can reach only Home, Audit Logs
and Logout — enforced at the API, not just the UI. Once complete, the wizard is
never offered again. Super admins get a per-tenant completion tracker.

---

## 1. Analysis — what already exists

| Piece | State |
|---|---|
| `POST /api/master-data/bootstrap` | **Exists.** `src/modules/mastersetup/` — one transactional call creating Organization → Branch(→Address→Contact→TxnConfig) → optional Item. Gated by `TENANT:ADMIN` / `TENANT:SUPER_ADMIN`. |
| `/master-setup` frontend route | **Exists.** `MasterDataSetup.js`, linked from Navbar for every tenant admin, **always visible**. |
| Completion state | **Missing entirely.** No table, no column, no flag. Nothing records that a tenant finished the wizard. |
| Enforcement | **Missing.** Wizard is optional; every other route is reachable without it. |
| Tracking for super admin | **Missing.** `GET /api/admin/users/all` → `QUERIES.ADMIN_USERS.SELECT_ALL_TENANTS` has no setup column. |
| Tenant table | **Does not exist.** `tenant_id` is a bare `CHAR(36)` on `user_tenants`; tenant *name* is derived from `organizationdetail`. |
| Session model | JWT is the **only** client-side source of truth (`AuthContext` decodes the cookie). There is no `/me` endpoint. |

### Consequences that drive the design

1. **Completion needs its own store.** Deriving "setup done" from the existence
   of `organizationdetail` rows is fragile — the Master Data CRUD screens can
   create an org without the wizard. A dedicated `tenant_setup` table is the
   source of truth.
2. **The client can't learn about completion without a new token.** Since state
   lives in the JWT, finishing the wizard must hand back a fresh token, or the
   user stays gated with a stale one.
3. **The gate must be backward-compatible or it breaks everything.** ~2,000
   lines of integration tests and every currently-issued token would start
   failing if "no claim" meant "incomplete". See §4.

---

## 2. Decisions taken

| Decision | Choice |
|---|---|
| Existing tenants on deploy | **Backfill by derivation** — a tenant with both an `organizationdetail` and a `branchdetail` row is marked `COMPLETED`. Live tenants are untouched; genuinely empty ones correctly see the wizard. |
| `TENANT:SUPER_ADMIN` | **Exempt from the gate**, consistent with the existing super-admin bypass in `checkScope` (`authMiddleware.js:70`). They retain `/admin` access to use the new tracker. |
| Gate signal | **JWT claim `setupCompleted`, with a DB re-check only when the claim is `false`.** Absence of the claim means "pass" — this is what keeps existing tokens and tests working. |
| Fresh token delivery | Returned as `data.setupToken` on the bootstrap 201 response — purely additive, existing assertions on `data.organization` keep passing. |

---

## 3. Database

### 3.1 New table — `tenant_setup`

Add to **Section 1 (Core Auth & Tenant Tables)** of
[database/01-schema-definition.sql](database/01-schema-definition.sql), after
`user_tenants`, with a matching `DROP TABLE IF EXISTS` in the section header.

```sql
-- 1.5 tenant_setup
-- One row per tenant recording whether the first-time master-data setup wizard
-- has been completed. Absence of a row is equivalent to status = 'PENDING'.
CREATE TABLE tenant_setup (
    tenant_id     CHAR(36)                       NOT NULL,
    status        ENUM('PENDING','COMPLETED')    NOT NULL DEFAULT 'PENDING',
    completed_at  TIMESTAMP                      NULL,
    completed_by  VARCHAR(255)                   NULL,
    created_at    TIMESTAMP                      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP                      NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                 ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id)
);
```

No FK — there is no `tenants` table to reference (`user_tenants.tenant_id` is
not unique).

### 3.2 Backfill

Lives at the end of [database/02-seed-data.sql](database/02-seed-data.sql) — no
separate migration file, because this project is deployed by running the two
scripts against a fresh database. Idempotent; safe to re-run.

```sql
INSERT INTO tenant_setup (tenant_id, status, completed_at, completed_by)
SELECT DISTINCT ut.tenant_id, 'COMPLETED', NOW(), 'SYSTEM_SEED'
FROM   user_tenants ut
WHERE  EXISTS (SELECT 1 FROM organizationdetail o WHERE o.TenantId = ut.tenant_id)
  AND  EXISTS (SELECT 1 FROM branchdetail       b WHERE b.TenantId = ut.tenant_id)
ON DUPLICATE KEY UPDATE status = 'COMPLETED';
```

Both `organizationdetail.TenantId` and `branchdetail.TenantId` are `NOT NULL
VARCHAR(50)` — verified against the schema.

**On a fresh install this matches nothing**, which is intended: the seed creates
no organizationdetail/branchdetail rows, so the seeded tenant starts PENDING and
its admin lands in the setup wizard.

To upgrade an existing deployment in place instead, run the `tenant_setup`
CREATE TABLE from §1.1b of `01-schema-definition.sql` plus the statement above
against the live database — that is the whole migration.

---

## 4. The gate middleware — `src/middleware/setupGate.js`

New file. Registered **once**, at the top of `registerRoutes()` in
[src/config/routes.js](src/config/routes.js), before any `app.use('/api/...')`
— one place to audit rather than 60 route files.

```js
app.use(requireTenantSetup);   // before all module route registrations
```

Evaluation order (first match wins):

1. **Path allowlist** (prefix match) → pass.
   `/api/auth`, `/api/onboarding`, `/api/user`, `/api/audit`,
   `/api/master-data`, `/api/tenants`, `/api/admin/app-config`, `/api-docs`, `/`.
2. **No/invalid bearer token** → pass. The downstream router's
   `authenticateToken` produces the correct 401/403; the gate never invents auth
   errors.
3. **`scopes` includes `TENANT:SUPER_ADMIN`** → pass (decision §2).
4. **`tid` is null** (guest) → pass. Guest routes are already allowlisted;
   everything else 403s on scope anyway.
5. **`setupCompleted !== false`** → pass. ← *the backward-compatibility hinge.*
   Only an **explicit `false`** gates. Tokens minted before this feature, and
   every existing integration-test token, carry no such claim and sail through.
6. **`setupCompleted === false`** → DB re-check `isSetupComplete(tid)`:
   - complete → pass (stale token; don't punish a user who just finished)
   - incomplete → `403` `HttpError` with `code: 'TENANT_SETUP_REQUIRED'`

The DB hit happens *only* for tenants that are genuinely mid-setup — a
vanishingly small share of traffic, and zero cost for everybody else.

Audit the denial once per request via the existing `captureAudit` with a new
`AUDIT_ACTIONS.MASTER_SETUP_BLOCKED`.

---

## 5. Service layer — `src/modules/mastersetup/mastersetup.service.js`

Additions:

- **`getStatus(tenantId)`** → `{ tenantId, status, completedAt, completedBy, isComplete }`.
  A missing row resolves to `PENDING` / `isComplete: false`.
- **`isSetupComplete(tenantId)`** → `boolean`. Used by the gate and by auth.
- **Completion inside the existing transaction.** In `bootstrap()`, as the final
  step inside `withTransaction`, upsert `tenant_setup` to `COMPLETED` with
  `completed_by = userEmail`. Atomic with the data: a rollback leaves the tenant
  `PENDING`, so a failed wizard run never falsely unlocks the system.
- **Idempotency guard.** At the top of `bootstrap()`, if the tenant is already
  `COMPLETED`, throw `HttpError(MESSAGES.ERROR.TENANT_SETUP_ALREADY_DONE, 409)`.
  This is the server-side half of "never show this option again" — a replayed
  request cannot duplicate the org/branch tree.

New route + controller:

```
GET /api/master-data/status   → authenticateToken only (any provisioned user)
```
Returns `getStatus(req.user.tid)`. Deliberately **not** scope-gated beyond
authentication: a non-admin user who is gated still needs to know *why*.

`POST /api/master-data/bootstrap` — response gains `data.setupToken`, a freshly
signed JWT built from `req.user` with `setupCompleted: true`, so the client
unlocks without re-login.

---

## 6. Auth — issuing the claim

[src/modules/auth/auth.service.js](src/modules/auth/auth.service.js):

- `findAndGetPermissions` — on the **provisioned** path and the
  **auto-approve** path, resolve `setupCompleted` via
  `mastersetup.isSetupComplete(tenantId)` and include it in the returned object.
  The auto-approve path creates a brand-new tenant with no `tenant_setup` row,
  so it correctly yields `false` — a newly auto-provisioned tenant admin lands
  straight in the wizard.
- `switchTenantPermissions` — resolve for the **target** tenant. Critical: a
  user with two tenants must be gated when switching into the incomplete one.
- `generateAppToken` — add `setupCompleted` to `appPayload` for non-guest
  tokens only.

> Circular-import note: `auth.service` already imports `admin.service`;
> importing `mastersetup.service` is a new edge (`mastersetup` → many CRUD
> services). Extract `isSetupComplete` into a small
> `src/modules/mastersetup/mastersetup.repository.js` that only depends on
> `dbHelper`, and have both `auth.service` and the gate import *that*.

---

## 7. Super-admin tracking column

**Backend** — extend `QUERIES.ADMIN_USERS.SELECT_ALL_TENANTS`
([src/config/constants.js:1005](src/config/constants.js#L1005)):

```sql
LEFT JOIN tenant_setup ts ON ts.tenant_id = ut.tenant_id
...
COALESCE(ts.status, 'PENDING') AS setup_status,
ts.completed_at                AS setup_completed_at,
```

Add `ts.status, ts.completed_at` to the `GROUP BY` (MySQL `ONLY_FULL_GROUP_BY`
safety). No new endpoint, no controller change — purely additive to the
existing `GET /api/admin/users/all` payload.

---

## 8. Constants & messages

- `AUDIT_ACTIONS`: `MASTER_SETUP_COMPLETED`, `MASTER_SETUP_BLOCKED`.
- `MESSAGES.ERROR`: `TENANT_SETUP_REQUIRED`, `TENANT_SETUP_ALREADY_DONE`.
- `QUERIES.TENANT_SETUP`: `SELECT_BY_TENANT`, `UPSERT_COMPLETED`.
- Reuse the existing `AUDIT_CATEGORIES.MASTER_DATA`.

---

## 9. Swagger — [src/config/swagger.js](src/config/swagger.js)

1. **`GET /api/master-data/status`** — new path under the existing Master Data
   tag; 200 with a `TenantSetupStatus` schema (`tenantId`, `status`,
   `completedAt`, `completedBy`, `isComplete`).
2. **`POST /api/master-data/bootstrap`** ([swagger.js:1643](src/config/swagger.js#L1643)) —
   add `setupToken` to the 201 `data` schema; add a `409` response
   ("Tenancy setup already completed").
3. **Shared `responses.forbidden`** — extend the description to note the
   `TENANT_SETUP_REQUIRED` code, since it can now surface on any gated path.
4. **`AdminUser` schema** — add `setup_status` (enum) and `setup_completed_at`.
5. New `TenantSetupStatus` component schema.

---

## 10. Tests

### New
- **`src/__tests__/middleware/setupGate.test.js`**
  - allowlisted path passes while gated
  - unauthenticated request passes through untouched
  - `TENANT:SUPER_ADMIN` bypasses
  - **token with no `setupCompleted` claim passes** (back-compat contract)
  - `setupCompleted: false` + DB `PENDING` → 403 `TENANT_SETUP_REQUIRED`
  - `setupCompleted: false` + DB `COMPLETED` → passes (stale token)

### Extended
- **`mastersetup.service.test.js`** — `getStatus` default-PENDING; completion
  upsert runs inside the transaction; 409 on a second bootstrap; rollback leaves
  status `PENDING`.
- **`endpoints.test.js`** — `GET /api/master-data/status`; a gated token hitting
  `/api/categories` → 403; the same token hitting `/api/audit`, `/api/user`,
  `/api/master-data/bootstrap` → not gated.
- **`auth.service.test.js`** / **`auth.autoapprove.test.js`** — claim present on
  provisioned tokens; `false` for a freshly auto-approved tenant; `switchTenant`
  resolves the target tenant's status.
- **`admin.service.test.js`** — `setup_status` present in `listAllUsers` rows.

### Regression guarantee
Every existing integration-test token is built without a `setupCompleted` claim,
so rule §4.5 makes the gate a no-op for the entire existing suite. No existing
test should require modification — that is the acceptance criterion for the
middleware, and any test that *does* need changing signals a gate that is too
aggressive.

---

## 11. Non-breakage summary

| Risk | Mitigation |
|---|---|
| Existing users locked out on deploy | Derivation backfill marks active tenants `COMPLETED`; plus the "absent claim = pass" rule means already-issued tokens are unaffected until they re-login. |
| 2,000 lines of integration tests 403ing | Same "absent claim = pass" rule. |
| Super admin can't reach the tracker | Explicitly exempt in the gate. |
| Wizard itself blocked by the gate | `/api/master-data` is allowlisted; the wizard makes exactly one API call (`bootstrap`) — verified, it has no dropdown prefetches. |
| Duplicate org/branch from a replayed wizard | 409 idempotency guard + transactional completion. |
| Stale token after finishing the wizard | Fresh `setupToken` in the response, plus the DB re-check fallback in the gate. |
| Response-shape breakage | Every change is additive (`data.setupToken`, `setup_status`); no field is renamed or removed. |

---

## 12. Implementation order

1. Schema + backfill migration + seed update
2. `mastersetup.repository.js` (`isSetupComplete`, `getStatus`, `upsertCompleted`)
3. Constants / messages / queries
4. `setupGate.js` + registration + its tests ← *run the full suite here; it must be green before proceeding*
5. Service completion-in-transaction, 409 guard, `GET /status`, `setupToken`
6. Auth claim (login / auto-approve / switch-tenant)
7. `SELECT_ALL_TENANTS` column
8. Swagger
9. Remaining test extensions
