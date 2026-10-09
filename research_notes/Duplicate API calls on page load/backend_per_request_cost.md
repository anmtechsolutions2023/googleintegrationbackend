# Backend per-request DB cost (repeated work that multiplies duplicate frontend calls)

All paths relative to `src/`. Code audit only; no runtime measurement. Pool: `DATABASE.CONNECTION_LIMIT` defaults to **4**, `MAX_IDLE` 1 (config/config.js:32-33).

## How many DB queries does authenticateToken + checkScope + liveAccess run per request?

### Takeaway
checkScope is pure in-memory (0 queries). authenticateToken costs 0 queries on a liveAccess cache hit and **3 sequential pool queries on a miss**; the cache is an in-process Map with a 15 s TTL, so on Vercel serverless (many cold/parallel instances) misses are common. Duplicate parallel calls that arrive before the first fills the cache all miss together (no in-flight de-duplication).

### Cited Findings
- authenticateToken verifies the JWT locally then calls `liveAccess.refresh` for any tenant member (`user.tid`) — middleware/authMiddleware.js:23-58 (confirmed).
- checkScope / checkGuestScope only read `req.user.scopes`; no DB — middleware/authMiddleware.js:65-115 (confirmed).
- liveAccess.load runs 3 queries sequentially on the pool: `ADMIN_USERS.SELECT_ACCESS_FLAGS` (liveAccess.js:57), `PERMISSIONS.SELECT_ALL_GRANTS` via buildScopes (modules/auth/access.js:25,41-46), `USER_ROLES.SELECT_BY_USER_TENANT` via getRoleNames (access.js:58) (confirmed). Each `db.execute` borrows/returns a pool connection, so not concurrent.
- Cache: `TTL_MS = 15 * 1000`, `MAX_ENTRIES = 5000` (cleared wholesale when full), keyed `tenantId|phone`, per process — liveAccess.js:31-38, 67-76 (confirmed). No promise memoization: N concurrent requests from one user on a cold key run 3N queries (confirmed by reading currentAccess; severity **medium**).
- Disabled under NODE_ENV=test unless LIVE_ACCESS_IN_TESTS=1 (liveAccess.js:43-44) — tests will not show this cost.
- Net per request: 0 (hit) or 3 (miss) queries for auth, plus audit INSERT if the route is audited (below).

## Which GET endpoints write an audit row on every call?

### Takeaway
Every route using `auditLogCrud` writes one `INSERT` into audit logs on **every GET** ("Viewed X list"/"Viewed X details"), fired on `res.finish` through its own pool connection. ~61 modules use auditLogCrud; additionally several `auditLog(...)` calls on GETs (branch list, POS settings) log at DEBUG level but still INSERT. Severity **high** for the branch list (on every screen with a branch picker) and item-meta/menu-reference lists; medium elsewhere.

### Cited Findings
- `auditLogCrud` maps GET → "Viewed {module} list/details" and always calls `writeAuditLog` (one `db.execute(AUDIT_LOGS.INSERT_MIDDLEWARE)`) for any req with a user — middleware/auditLogger.js:17-21, 77-112 (confirmed). `auditLog` does the same with a fixed label — auditLogger.js:37-65. Neither has a GET skip or level filter; DEBUG level is still written.
- `grep -rln auditLogCrud( modules` → 61 files; ≥50 single-line `router.get(... audit ...)` matches plus multi-line ones (confirmed by grep).
- GET /api/pos/branches — `auditLog(POS,'DEBUG','POS branch list viewed')`; route comment says "Every screen with a branch picker reads this" — modules/posbranch/posbranch.routes.js:21-28 (confirmed). Cost: auth 0/3 + 1 SELECT (posbranch.service.js:24) + 1 INSERT.
- GET /api/pos/settings?branchId= — `auditLog(POS,'DEBUG','POS settings viewed')` — modules/possetting/possetting.routes.js:28-29 (confirmed). 1 SELECT (possetting.service.js:91-92) + 1 INSERT.
- GET /api/pos/item-meta and /:id — `audit = auditLogCrud('POS Item Meta')` on both — modules/positemmeta/positemmeta.routes.js:14,25-30 (confirmed).
- Other audited GETs (examples, confirmed): pos orders list/detail/waiters (posorder.routes.js:32-49), online-order queue (posonlineorder.routes.js:32 — a polled queue, so one INSERT per poll: **high**, suspected polling frequency), cash sessions + summary (poscashsession.routes.js:23-29), addons/addon groups/food types/meat types/menu tags/variants/floors/channels/return & rejection reasons/category schedule, portals incl. /:id/branches and /:id/listings (posportal.routes.js:79-88), assets + /summary (asset.routes.js:21-27), expense/asset categories, POS report (posreport.routes.js:16), and master-data CRUD (organization, costinfo, category, taxgroup, uomfactor, paymentmode, contactdetail, batchdetail, paymentbreakup, etc.).
- Not audited on GET (confirmed): /api/exports catalogue & preview (export.routes.js:21,27), /api/menu/* reads (menu.routes.js:25-53), /api/pos/tax-settings (taxsetting.routes.js:25), business profile (businessprofile.routes.js:33), ledger /reports/overview (ledger.routes.js:37).

## Which services do per-row queries (N+1)? Cite file:line.

### Takeaway
Read paths are largely batched (IN-lists / one-connection Promise.all); no classic per-row SELECT loop found on list GETs. Remaining per-row loops are on write paths, plus one read-ish N+1 on inbound portal orders and a pool-fan-out pattern (Promise.all across separate withConnection/executeQuery calls) that takes 2-4 connections from a pool of 4 in one request.

### Cited Findings
- Batched (good, confirmed): pricing `priceCostInfos` one IN query for all costinfo ids (pricing.service.js:54-84; pricing.repository.js:76); item-meta `attachAvailability` and `attachStock` one read per page (positemmeta.service.js:361-428); menu `loadDishes` 9 queries on one connection for any number of dishes (menu/menu.dish.js:79-89); menu options 12 queries on one conn (menu/menu.service.js:17-22).
- N+1 (confirmed): `resolveLines` does `listingService.findByExternalItem` per inbound line via Promise.all — modules/posportal/posportal.ingest.service.js:69-74 (webhook/ingest path, not page loads; severity low-medium).
- N+1 on writes (confirmed, not page-load): bulkUpdate re-syncs links per dish in a loop (positemmeta.service.js:465-478); per-row INSERT loops in ledger (ledger.service.js:262, ledger.returns.service.js:497,561), admin role/permission inserts (admin.service.js:90,153,845), possetting UPSERT per key (possetting.service.js:111), posqr settings (posqr.settings.service.js:67-69), category tag links (category.service.js:161), import tax-group lookup per name (import.service.js:332-335). Severity low for page loads.
- Multi-connection fan-out (confirmed): `priceCostInfos` runs `Promise.all([getChainForCostInfos, isGstCharging])` as two separate pool calls (pricing.service.js:55-58, 33-37); same at pricing.service.js:122 (5 items). `attachAvailability` Promise.all of schedule read + getTimeZone (positemmeta.service.js:363; getTimeZone cached in-process, poscategoryschedule.service.js:85-88). `overviewReport` runs sales/expense/cashFlow/writeOff reports in parallel, each its own `withConnection` → up to **4 connections = the whole default pool** for one request — ledger.report.service.js:447-452, 51-52, 390-391, 416-417 (writeOff assumed same pattern; suspected). Severity **high** under duplicate calls: two concurrent overview loads need 8 connections from a pool of 4 and queue (no deadlock since none is nested, but serializes everything else).
- `withConnection` accepts an existing connection to avoid nested acquisitions (utils/dbHelper.js:21-37); callers above don't pass one.

## Which endpoints are hit on most page loads and what do they cost?

### Takeaway
Estimated query counts per call (auth miss = +3, hit = +0; audit = +1 INSERT after response):

| Route | Data queries | Audit | Notes |
|---|---|---|---|
| GET /api/pos/branches | 1 | +1 | every branch-picker screen (confirmed) |
| GET /api/pos/settings?branchId | 1 | +1 | (confirmed) |
| GET /api/pos/item-meta?page | COUNT + SELECT (BaseCRUDService.js:64-72) + pricing 2 (parallel conns) + schedule 1 (+tz on cache miss) + stock 1 ≈ **5-6** | +1 | 2 concurrent conns during pricing (confirmed) |
| GET /api/pos/item-meta/:id | SELECT + nutrition + pricing 2 + schedule 1 + stock 1 ≈ 6 | +1 | each via separate executeQuery/withConnection (confirmed) |
| GET /api/exports | **0** (in-memory catalogue by scopes, export.controller.js:38-43) | none | only auth cost (confirmed) |
| GET /api/menu/options | 12 on one conn | none | (confirmed) |
| GET /api/ledger/reports/overview | many, across 4 parallel conns | none | (confirmed/suspected count) |
| Any BaseCRUD list (master data) | 2 (COUNT + SELECT on one conn) | +1 | most audited (confirmed) |

### Cited Findings
- BaseCRUDService.getAll always runs COUNT then SELECT on one connection — common/BaseCRUDService.js:47-72 (confirmed). Audit-log list runs COUNT and SELECT via Promise.all on one connection (audit/audit.service.js:77-82).
- No /me or profile GET route exists in auth (auth.routes.js only POST OTP routes, :31,:37); identity comes from the JWT, so no per-page "me" DB call (confirmed by grep for '/me' routes).
- Overall: a typical audited list GET with a cold liveAccess cache = 3 auth + 2-6 data + 1 audit INSERT = **6-10 queries**; each duplicated frontend call repeats all of it, including the audit row (no request de-dup or response caching on the server). Auth cost collapses to 0 for repeats within 15 s on the same warm instance only.
