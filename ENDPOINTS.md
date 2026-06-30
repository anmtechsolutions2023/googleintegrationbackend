# API Endpoints Reference

**Base URL:** `http://localhost:3001` (dev) / `http://localhost:5000` (default)
**Interactive docs:** `http://localhost:3001/api-docs`

---

## Auth & Identity

| Method | Endpoint | Auth Required | Request Body | Description |
|--------|----------|---------------|--------------|-------------|
| POST | `/api/auth/google` | No | `{ idToken }` | Google OAuth login. Returns JWT (full user) or guest JWT (15 min) if unprovisioned |
| POST | `/api/user/logout` | Yes | — | Invalidate session / logout |

---

## Onboarding (Guest User)

| Method | Endpoint | Auth Required | Request Body | Description |
|--------|----------|---------------|--------------|-------------|
| GET | `/api/onboarding/status` | `guest:explore` | — | Check own onboarding request status |
| PUT | `/api/onboarding/note` | `guest:explore` | `{ note }` | Add/update a note on the onboarding request |

---

## Admin — Onboarding Approvals

| Method | Endpoint | Auth Required | Request Body / Query | Description |
|--------|----------|---------------|----------------------|-------------|
| GET | `/api/admin/onboarding` | `admin:access` | `?status=PENDING\|APPROVED\|REJECTED\|ALL&page=1&limit=20` | List onboarding requests with status filter |
| PUT | `/api/admin/onboarding/:id/approve` | `admin:access` | `{ tenantId: string, roleIds?: string[] }` | Approve request — provisions user into tenant, optionally assigns roles |
| PUT | `/api/admin/onboarding/:id/reject` | `admin:access` | `{ rejectionReason: string }` | Reject request with a reason |
| GET | `/api/admin/onboarding-requests` | `admin:access` | `?status=PENDING\|APPROVED\|REJECTED\|ALL&page=1&limit=20` | Same as above (legacy path) |
| POST | `/api/admin/onboarding-requests/:requestId/approve` | `admin:access` | `{ tenantId: string, roleIds: string[] }` | Approve (legacy — roleIds required) |
| POST | `/api/admin/onboarding-requests/:requestId/reject` | `admin:access` | `{ reason: string }` | Reject (legacy — field name is `reason`) |

---

## Admin — User Management

| Method | Endpoint | Auth Required | Request Body | Description |
|--------|----------|---------------|--------------|-------------|
| GET | `/api/admin/users` | `admin:access` | `?page=1&limit=20` | List all users in caller's tenant |
| GET | `/api/admin/users/:email` | `admin:access` | — | Get user detail including assigned roles |
| GET | `/api/admin/users/:email/roles` | `admin:access` | — | Get current roles for a specific user |
| PUT | `/api/admin/users/:email/roles` | `admin:access` | `{ roleIds: string[] }` | Replace all roles for a user |
| PUT | `/api/admin/users/:email/status` | `admin:access` | `{ status: "ACTIVE"\|"SUSPENDED" }` | Activate or suspend a user |
| DELETE | `/api/admin/users/:email` | `admin:access` | — | Remove user from tenant |

---

## Admin — Role Management

| Method | Endpoint | Auth Required | Request Body | Description |
|--------|----------|---------------|--------------|-------------|
| GET | `/api/admin/roles` | `admin:access` | — | List all roles in tenant |
| POST | `/api/admin/roles` | `admin:access` | `{ name: string, description?: string }` | Create a new role |
| PUT | `/api/admin/roles/:roleId` | `admin:access` | `{ name?, description?, isActive? }` | Update a role |
| DELETE | `/api/admin/roles/:roleId` | `admin:access` | — | Delete a role (non-system roles only) |
| GET | `/api/admin/roles/:roleId/permissions` | `admin:access` | — | Get feature permissions assigned to a role |
| PUT | `/api/admin/roles/:roleId/permissions` | `admin:access` | `{ featureIds: string[] }` | Replace all permissions for a role |

---

## Admin — Feature / Scope Management

| Method | Endpoint | Auth Required | Request Body | Description |
|--------|----------|---------------|--------------|-------------|
| GET | `/api/admin/features` | `admin:access` | — | List all features/scopes |
| POST | `/api/admin/features` | `admin:access` | `{ featureShortName: string, scope: string, displayName: string, category?, description? }` | Create a new feature/scope |
| PUT | `/api/admin/features/:featureId` | `admin:access` | `{ displayName?, scope?, category?, description?, isActive? }` | Update a feature |
| DELETE | `/api/admin/features/:featureId` | `admin:access` | — | Delete a feature (only if not assigned to any role) |

---

## Tenants

| Method | Endpoint | Auth Required | Request Body | Description |
|--------|----------|---------------|--------------|-------------|
| POST | `/api/tenants` | Yes | — | Switch active tenant |

---

## Reports & Data

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| GET | `/api/reports` | Yes | Reports and billing data |
| GET | `/api/reports/:id` | Yes | Single report |
| GET | `/api/data` | Yes | Admin settings / general data |
| GET | `/api/data/:id` | Yes | Single data record |
| GET | `/api/audit/logs` | Yes | Audit log retrieval |

---

## Master Data — CRUD Modules

All 31 modules below follow the **same 5-endpoint pattern**:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/{module}` | List all records (paginated) |
| GET | `/api/{module}/:id` | Get single record by ID |
| POST | `/api/{module}` | Create new record |
| PUT | `/api/{module}/:id` | Update record |
| DELETE | `/api/{module}/:id` | Delete record |

### Reference / Lookup Tables

| Module | Base URL |
|--------|----------|
| Tax Types | `/api/taxtypes` |
| Unit of Measure | `/api/uom` |
| UOM Factors | `/api/uomfactors` |
| Categories | `/api/categories` |
| Organizations | `/api/organizations` |
| Account Types | `/api/accounttypes` |
| Account Type Bases | `/api/accounttypebases` |
| Transaction Type Statuses | `/api/transactiontypestatuses` |
| Transaction Type Configs | `/api/transactiontypeconfigs` |
| Transaction Types | `/api/transactiontypes` |
| Contact Address Types | `/api/contactaddresstypes` |
| Tax Groups | `/api/taxgroups` |
| Tax Group Tax Type Mappers | `/api/taxgrouptaxtypemappers` |
| Map Providers | `/api/mapproviders` |
| Payment Modes | `/api/paymentmodes` |
| Payment Received Types | `/api/paymentreceivedtypes` |

### Transactional / Relational Tables

| Module | Base URL |
|--------|----------|
| Transaction Type Base Conversions | `/api/transactiontypebaseconversions` |
| Transaction Type Conversion Mappers | `/api/transactiontypeconversionmappers` |
| Transaction Detail Logs | `/api/transactiondetaillogs` |
| Transaction Item Details | `/api/transactionitemdetails` |
| Contact Details | `/api/contactdetails` |
| Address Details | `/api/addressdetails` |
| Location Details | `/api/locationdetails` |
| Map Provider Location Mappers | `/api/mapproviderlocationmappers` |
| Branch Details | `/api/branchdetails` |
| Branch User Group Mappers | `/api/branchusergroupmappers` |
| Batch Details | `/api/batchdetails` |
| Item Details | `/api/itemdetails` |
| Cost Infos | `/api/costinfos` |
| Payment Mode Transaction Details | `/api/paymentmodetransactiondetails` |
| Payment Details | `/api/paymentdetails` |
| Payment Breakups | `/api/paymentbreakups` |

---

## Quick Count

| Group | Endpoints |
|-------|-----------|
| Auth & Identity | 2 |
| Onboarding (guest) | 2 |
| Admin — Onboarding Approvals | 6 |
| Admin — User Management | 6 |
| Admin — Role Management | 6 |
| Admin — Feature Management | 4 |
| Tenants | 1 |
| Reports & Data & Audit | 5 |
| Master Data (31 modules × 5) | 155 |
| **Total** | **187** |

---

## Auth Notes

- All requests (except `POST /api/auth/google`) require `Authorization: Bearer <JWT>` header
- `admin:access` scope is required for all `/api/admin/*` endpoints
- `TENANT:SUPER_ADMIN` scope bypasses all scope checks
- Guest JWT (from unprovisioned login) has 15-minute expiry and only grants `guest:explore` scope
