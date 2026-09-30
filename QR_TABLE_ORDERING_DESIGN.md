# QR Table Ordering — Design

Status: **Implemented** · 2026-09-30 · Not yet committed.

### Where the build differs from the proposal below

- **Staff endpoints live under `/api/pos/qr`**, not `/api/pos/tables/qr` and
  `/api/pos/orders/:id/reject`. One module (`src/modules/posqr/`) owns codes,
  settings, limits and the review queue:
  `GET /codes`, `POST /codes/:tableId/rotate`, `GET|PUT /settings`,
  `GET /limits`, `GET /orders/pending`, `GET /rejection-reasons`,
  `POST /orders/:id/accept`, `POST /orders/:id/reject`.
- **Guest endpoints** (`src/modules/posdine/`, `/api/dine`) add `GET /session`,
  `PUT /me` (first-visit name, applied only while the customer is still
  "Guest") and `POST /orders/quote` (server-priced cart total).
- **Permissions:** new feature `POS_QR` (READ/WRITE, category POS), granted to
  SUPER_ADMIN, TENANT_ADMIN, POS_MANAGER and OWNER_OPERATOR (both scopes) and
  POS_CASHIER and POS_WAITER (READ). Accept/reject also admits `POS_ORDER:WRITE`
  (`SCOPE_SETS.POS_QR_ORDER_DECIDE`). Code management is `POS_QR` only.
  `POS_QR` was added to `POS_REFERENCE_READ` so the QR screens can read the
  branch list.
- **The customer upsert is NOT in the verify transaction.** The verify commits
  the consumed challenge first, then the customer is found or created. A
  failure between the two costs the guest one fresh code.
- **Existing bug fixed:** `verifyOtp` used to throw from inside its
  transaction after bumping `attempts`, and the rollback undid the bump, so the
  five-attempt lock never engaged. Failures are now committed first and thrown
  afterwards (tests: `otp.purpose.test.js`).
- **The OTP layer is split by purpose:** `otp.policies.js` holds a staff policy
  and a diner policy, so `otp.service.js` is the same for every purpose.
- **Getting the schema:** all of it lives in `database/01-schema-definition.sql`
  and `02-seed-data.sql` (PART 14); `npm run db:reset -- --yes` applies both.
  Staff sign out and in again to pick up `POS_QR`.

UI mockup and clickable workflow: https://claude.ai/artifact/1eEszs9hmaDTL5oZ5LLYe5
(diner screens D1–D9, staff screens S1–S5).

Owner decisions, 2026-09-30:
- Staff approve every QR order before the kitchen sees it (§4.5, Q2 closed).
- Diner code limits are separate from staff and are defined in one place (§4.2.1).
- Phone numbers are validated at entry in the UI and the API. The database is
  new, so there is no clean-up migration (§4.3).

A printed QR code on each table opens that branch's menu for that table. The
diner proves a mobile number with a WhatsApp OTP and becomes a `pos_customer`
of the tenant. What they order is linked to them, so visits and spend show up
in the CRM through the settle path that already exists.

Read alongside `WHATSAPP_IDENTITY_MIGRATION.md`, which covers the OTP
machinery this design reuses.

---

## 1. Summary of decisions

| # | Decision | Why |
|---|---|---|
| D1 | The QR code holds an **opaque random token**, not tenant/branch/table ids | Ids in a URL can be guessed, so anyone could walk them. A token can be rotated when a code is photographed and misused. |
| D2 | The OTP is **`otp.service` with a new purpose `DINER`**, not a second implementation | One place for hashing, single-use and rate limits. The diner flow changes only *who may receive a code* and *what the proof buys*. |
| D3 | Diners get a **separate session token signed with a different secret** | A diner token must never pass `authenticateToken`. That check accepts any token with a `tid` and a `scopes` array, so a diner token signed with `JWT_SECRET` would reach every route that has no `checkScope`. |
| D4 | Diners count against their **own daily send cap**, separate from staff | The staff cap is a circuit breaker that turns off WhatsApp sign-in. If diners shared it, a busy Saturday could lock staff out of the POS. |
| D5 | The customer record is **tenant-wide**, found by normalised phone | `pos_customer` is already `UNIQUE (Phone, TenantId)`. The same person at two branches of one chain is one customer. At two different restaurants they are two customers, which is correct. |
| D6 | A diner's order is an ordinary `pos_order` round, **not sent to the kitchen until staff fire the KOT** | This reuses the existing menu, add-on, schedule and pricing checks unchanged, and staff check each order before the kitchen sees it. No new order status. |
| D7 | Turned on **per branch** through `pos_setting` | A branch without table service should not show a menu no one will serve. |

---

## 2. The flow

```
 Staff                          Diner's phone                      Backend
 ─────                          ─────────────                      ───────
 Tables → "QR codes" → print
                                scan  →  /t/<token>
                                                         GET  /api/dine/<token>
                                                         ← branch, table, logo, enabled?
                                enter mobile
                                                         POST /api/dine/<token>/otp/request
                                                         → WhatsApp template (DINER)
                                enter code (+ name, first time only)
                                                         POST /api/dine/<token>/otp/verify
                                                         → upsert pos_customer
                                                         ← diner token (3h)
                                browse menu              GET  /api/dine/menu
                                add to cart, place       POST /api/dine/orders
                                                         → pos_order (TableId from token,
                                                           CustomerId from session)
 Tables shows "new QR order" ←
 review → Fire KOT (existing)
                                "Sent to kitchen"        GET  /api/dine/orders
 Settle bill (existing)                                  → poscustomer.stats.recordSaleTx
                                                           (Visits, TotalSpent, LastVisitAt)
```

---

## 3. Schema

### 3.1 `pos_table_qr` — new

```sql
CREATE TABLE pos_table_qr (
    Id              VARCHAR(50)  NOT NULL,
    Token           CHAR(32)     NOT NULL,   -- crypto.randomBytes(16).hex; the only thing in the QR
    TableId         VARCHAR(50)  NOT NULL,
    BranchDetailId  VARCHAR(50)  NOT NULL,   -- denormalised: resolves branch without a join, survives table moves
    TenantId        VARCHAR(50)  NOT NULL,
    Active          TINYINT(1)   NOT NULL DEFAULT 1,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE KEY uk_tableqr_token (Token),
    UNIQUE KEY uk_tableqr_table (TableId, TenantId),   -- one live code per table; rotate = overwrite Token
    FOREIGN KEY (TableId) REFERENCES pos_table(Id)
);
```

**Why a separate table rather than a column on `pos_table`:** codes are issued
lazily the first time someone prints them, so table CRUD
(`postable.service.prepareInsertParams`) stays untouched. Rotating or revoking a
code is a change to this table only.

**Why 128 bits:** the token is the only thing standing between the internet
and a table's order endpoint. 32 hex characters still fit in a small, easily
scanned QR code.

### 3.2 `auth_otp_challenge` — two changes

```sql
ALTER TABLE auth_otp_challenge
  MODIFY purpose ENUM('LOGIN','SIGNUP','DINER') NOT NULL,
  ADD COLUMN context_ref VARCHAR(50) NULL COMMENT 'DINER: pos_table_qr.Id the code was requested at',
  ADD INDEX idx_otp_context (context_ref, created_at);
```

`context_ref` ties a code to the table where it was requested. Verify checks it
matches, so a code requested at table 4 cannot open a session at table 9. It
is also what the per-table rate limit counts.

### 3.3 `pos_setting` keys (per branch, no row = off)

| Key | Values | Meaning |
|---|---|---|
| `qr.ordering.enabled` | `0` / `1` | QR codes resolve at all |
| `qr.ordering.mode` | `menu` / `order` | `menu` = view only; `order` = cart and place |

### 3.4 `pos_channel`

Seed a `QR` channel (`Code='qr'`) with the other POS masters in
`posMasters.provision`. Diner orders carry `ChannelId` = this channel. That is
how the front desk tells them apart and how reports split QR revenue from other
channels. Only items linked to the `QR` channel in `pos_item_meta_channel` are
shown. If a tenant never links any, fall back to the dine-in channel's items
(see §9 Q4).

---

## 4. Backend

### 4.1 Routes — new module `src/modules/posdine/`

Mounted at `/api/dine`. **Not behind `authenticateToken`.** This is the third
router like that, after `poswebhook` and `whatsapp`, and needs a comment in
`routes.js` saying so. Add `/api/dine` to
`TENANT_SETUP.ALLOWED_PATH_PREFIXES`. Otherwise the setup gate may block it,
since it keys off a staff session the diner does not have. Confirm how
`requireTenantSetup` treats a request with no token before relying on that.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/dine/:token` | none | Branch name, table name, logo, `enabled`, `mode`. 404 for an unknown, inactive or disabled token (one answer for all three) |
| GET | `/api/dine/:token/logo` | none | Branch logo bytes from `pos_branch_media` (the existing route requires staff auth) |
| POST | `/api/dine/:token/otp/request` | none | `{ phone }` → `{ challengeId, expiresInSeconds, resendInSeconds }` |
| POST | `/api/dine/:token/otp/verify` | none | `{ challengeId, code, name? }` → `{ token, customer: { name, isNew } }` |
| GET | `/api/dine/menu` | diner | Branch menu for the QR channel with prices, add-ons, variants and `available`/`opensAt` from `categorySchedule` |
| POST | `/api/dine/orders` | diner | `{ Items, CookingInstructions? }` → the round |
| GET | `/api/dine/orders` | diner | This diner's rounds at this table in this session, with status (`open` / KOT fired / ready) |

Staff side, added to the existing `postable` router under `POS_CONFIG:WRITE`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/pos/tables/qr?branchId=` | Every active table in the branch with its token. Issues missing tokens in the same call, so "print all" is a single request |
| POST | `/api/pos/tables/:id/qr/rotate` | New token for one table. The old printed code stops working immediately |

### 4.2 OTP — what changes in `otp.service`

`requestOtp` takes an optional `contextRef` and `tenantId`. For
`purpose === DINER`:

- **Always send.** The "unknown numbers get nothing" rule protects staff login
  against enumeration. Every diner is an unknown number, so that rule means
  nothing here. The limits below control cost instead.
- **Limits.** The per-phone, per-IP and cooldown limits apply unchanged. The
  diner-only limits are listed in §4.2.1. The global diner cap is **counted
  separately from the staff cap** (D4): `COUNT_SENT_TODAY` becomes
  purpose-aware, so staff counts `LOGIN`+`SIGNUP` and diners count `DINER`.
- **Same WhatsApp template.** Meta authentication templates are fixed-format
  ("123456 is your verification code"), so the existing template covers diners.
  Its sender name is the platform, not the restaurant (§9 Q5).

`verifyOtp` takes an `expectedPurpose` and an optional `contextRef`, and
rejects anything that does not match.

**This also fixes an existing gap:** `auth.controller.verifyOtp` ignores
`purpose` today. Once `DINER` exists, a diner code redeemed on
`/api/auth/otp/verify` would mint a staff session for that number. It is not a
privilege escalation, because the number was still proven. But it skips the
staff send limits and makes it unclear which code was issued for what. Both
verify endpoints should pass the purpose they expect.

### 4.2.1 Where the limits live — decided 2026-09-30

**One place: `src/config/rateLimits.js`**, in a new `DINER` block next to the
existing `OTP_REQUEST`, `OTP_VERIFY` and `COST` blocks. That file already
holds every throttle in the system. Each value can be overridden by an
environment variable and follows the same `num(process.env.X, default)`
pattern. The values are not stored in the database or edited in the UI.
Branch settings (mockup S4) shows them **read-only**, together with today's
count for the restaurant.

```js
// ── Diners (QR table ordering) ─────────────────────────────────────────────
// Counted separately from staff. Reaching any of these must never stop staff
// sign-in: COST.DAILY_SEND_CAP counts LOGIN + SIGNUP only.
DINER: {
  MAX_PER_TABLE:       num(process.env.DINER_MAX_PER_TABLE, 20),        // per OTP_REQUEST.WINDOW_SECONDS, on context_ref
  TENANT_DAILY_CAP:    num(process.env.DINER_TENANT_DAILY_CAP, 500),    // per restaurant (tenant), all branches
  DAILY_SEND_CAP:      num(process.env.DINER_DAILY_SEND_CAP, 5000),     // whole platform, diners only
  SESSION_TTL_SECONDS: num(process.env.DINER_SESSION_TTL_SECONDS, 3 * 60 * 60),
},
```

| Limit | Default | Counted on | Shared with staff? |
|---|---|---|---|
| Codes per mobile number | 3 / 15 min | phone | Rule shared (`OTP_MAX_PER_PHONE`) |
| Codes per device | 10 / 15 min | IP | Rule shared (`OTP_MAX_PER_IP`) |
| Resend wait | 60 s | phone | Rule shared |
| Wrong tries per code | 5 | challenge | Rule shared |
| Code valid for | 5 min | challenge | Rule shared |
| Codes per table | 20 / 15 min | `context_ref` | Diner only |
| Codes per restaurant | 500 / day | tenant | Diner only |
| Codes, whole platform | 5,000 / day | purpose `DINER` | **Separate count** from staff `OTP_DAILY_SEND_CAP` (500) |
| Diner session | 3 h | token | Diner only |

The 5,000 platform default is a starting value. Set it from the Meta budget
before go-live.

### 4.3 Customer upsert — on verify

After the challenge is consumed (see the implementation notes at the top):

1. `phone = toE164(challenge.phone)`
2. `SELECT … FROM pos_customer WHERE TenantId=? AND Phone=?` → found: update
   `Name` if the diner supplied one and the stored name is a placeholder.
   Not found: insert with `Name = name || 'Guest'`,
   `BranchDetailId` = this branch (the first branch they visited), and
   `CreatedBy = 'diner'`.
3. Return the customer id. It goes into the diner token.

**Phone format — validate at entry (decided 2026-09-30).** `pos_customer.Phone`
is free text today (`poscustomer.schemas`: `Joi.string().max(20)`). A customer
typed at the till as `98765 43210` and the same person verifying as
`+919876543210` would not match. The result is a duplicate that the `UNIQUE`
constraint does not catch.

The database is new, so **there is no clean-up migration**. Every new record
is validated instead, in two layers:

- **UI, on every phone field** (diner mockup D2, staff "Add customer" S5, and
  any other form that takes a customer's number). A fixed `+91` prefix is
  shown, and the input accepts digits only. It strips spaces and a pasted
  `+91`/`91`, and needs 10 digits starting with 6–9. It shows the error as the
  user types, and Save stays disabled until the number is valid. On staff
  forms, a number already on file shows "X already uses this number" with a
  link to their profile. Put the rule in one shared frontend helper so the
  diner app and Front Desk cannot drift apart.
- **API**, the authority: `poscustomer.schemas` uses the existing
  `utils/phoneSchema` / `toE164` on create and update, stores
  `+91XXXXXXXXXX`, and returns 400 for anything else. It returns 409 when the
  normalised number already exists for the tenant. The diner verify path
  stores the same normalised value.

`ContactDetailId` is unchanged: `contactResolver` fills it at settle, the same
as for a customer added at the till.

### 4.4 Diner session token

```js
// signed with DINER_JWT_SECRET — never JWT_SECRET (D3)
{ aud: 'diner', phone, tid, bid, tableId, qrId, customerId, exp: now + 3h }
```

- New middleware `authenticateDiner` checks the signature and `aud`, then
  **re-reads `pos_table_qr` by `qrId`** and rejects the request if the code was
  rotated or the branch turned the feature off. Rotating a code must end
  sessions opened with it, not just stop new scans.
- The diner sends no tenant, branch or table ids. Every id comes from the
  token. An order body naming a `TableId` is rejected by the Joi schema.
- 3 hours covers a long meal. After that the diner verifies again.

### 4.5 Placing an order

`POST /api/dine/orders` calls the existing `posorder.service.create` with:

```js
{ Items, CookingInstructions,
  TableId: diner.tableId, CustomerId: diner.customerId,
  OrderType: 'dinein', ChannelId: qrChannelId }
// userPhone (CreatedBy) = `diner:${diner.phone}`
```

This reuses `assertLinesAreOnMenu`, `assertAddonSelectionsAreValid`, schedule
availability, `priceItems`, `resolveVenueTx` (table/floor snapshot) and table
occupancy without changing them. The diner's prices come from the server. A
client-sent price is ignored in the same way the till's is.

Two further checks, both in `posdine`:

- every item's `ItemMeta` belongs to `diner.bid`. Menus are per branch
  (`pos_item_meta.BranchDetailId`), and `create` checks tenant, not branch.
- `mode === 'order'` for the branch.

**The KOT is not fired.** The round is created `open`. Staff fire it with the
existing `POST /orders/:id/fire-kot`. That review is the defence against a
photographed QR code being used from outside the restaurant. This was decided
on 2026-09-30, and there is no auto-fire setting (mockups S2 and S3).

**Rejecting** (mockup S3) needs one addition. A new route,
`POST /api/pos/orders/:id/reject` (`POS_ORDER:WRITE`), takes
`{ reasonId, note? }`, where `reasonId` comes from the existing
`pos_rejection_reason` master. It is allowed only on a QR round with no KOT.
It sets `Status='cancelled'`, which is already in `CLOSED_STATUSES`, so table
occupancy refreshes as it does for any closed round. It stores the reason in
two new nullable columns on `pos_order`: `RejectionReasonId` and
`RejectionNote` (VARCHAR 200). `GET /api/dine/orders` returns the reason text,
and the diner sees it (D8, "Rejected").

**Shared tables:** each diner who verifies gets their own rounds with their own
`CustomerId`. The bill joins the rounds through `pos_bill_order` as it does
now. Which customer the *bill* credits is §9 Q3.

---

## 5. Frontend

### 5.1 Diner app — public, mobile-first

A route outside `AuthProvider` guards: `/t/:token`. It never reads or writes
the staff `app_token` cookie. The diner token goes in `sessionStorage` under
`diner_token`, so closing the tab ends the session.

| File | Purpose |
|---|---|
| `src/pages/dine/DineEntry.js` | Resolves the token. Shows branch logo, name and table. Handles "not available" |
| `src/pages/dine/DineOtp.js` | Phone → code → name (first time only), built on the shared OTP form |
| `src/pages/dine/DineMenu.js` | Category tabs, veg/non-veg markers, add-on and variant sheet, sold-out and "opens at" states |
| `src/pages/dine/DineCart.js` | Cart, dish notes, place order |
| `src/pages/dine/DineOrders.js` | Placed rounds and their status. Polls every 20 s |
| `src/services/dineService.js` | Axios instance with its own base config and its own `Authorization` header, separate from the staff instance |
| `src/pages/dine/dine.css` | `.dine-*` namespace. Designed for 375 px and tolerant of 768 px |

**Shared OTP UI:** move `useCountdown`, `mmss` and the phone/code form out of
`Login.js` into `src/components/otp/OtpForm.js`. It takes `onRequest(phone)`
and `onVerify(challengeId, code)` as props. Login and DineOtp both use it, so
the two flows behave the same (resend countdown, error copy, paste-to-fill).

### 5.2 Staff side

- **Tables page → "QR codes"**: pick a floor or the whole branch and render a
  printable A4 sheet. Each card shows the QR code, table name, branch name and
  "Scan to order". Printed with `window.print()` and a print stylesheet.
- **Per-table menu**: "Rotate code" (with a confirmation: *printed code for T4
  will stop working*).
- **Settings**: `qr.ordering.enabled` / `mode` on the branch settings screen.
- **Tables / Billing**: a round with `ChannelId = QR` and no KOT gets a
  "New QR order" badge and a **Fire KOT** button. The badge comes from the
  existing poll in `FrontDeskContext`, so nothing new is pushed.

**QR code rendering:** add the `qrcode` npm package (about 30 KB, no
dependencies). It renders to canvas or SVG in the browser, so the backend
makes no images. The encoded URL is `${PUBLIC_DINE_ORIGIN}/t/<token>`, with
the origin set in `config.js`. **This is the one new dependency.**

---

## 6. Security

| Threat | Answer |
|---|---|
| Guessing another restaurant's table URL | 128-bit random token (D1) |
| Ordering from home with a photographed QR code | Staff fire the KOT (D6). Rotate the code. Sessions end on rotation (§4.4) |
| Running up the WhatsApp bill | Per-table, per-phone and per-IP limits, a per-tenant daily cap and a separate global diner cap (§4.2) |
| Diner traffic locking staff out | Separate caps (D4) |
| Diner token used against staff APIs | Different signing secret (D3) |
| Diner token used at another table or branch | Every id comes from the token. `authenticateDiner` re-checks `pos_table_qr` |
| Tampering with prices or items | Server-side pricing and menu checks (§4.5) |
| Reading another diner's orders | `GET /api/dine/orders` filters on `CustomerId` **and** `TableId` from the token |
| Logging phone numbers in full | Use `maskForLog` everywhere, as in the staff flow |

Consent: the OTP screen needs a line such as "We'll save your number to
[restaurant] so you can see your visits and offers." Diners become CRM records
that later campaigns (`pos_campaign`) may target, so this should be shown
before they enter the number.

---

## 7. Build order

1. **Phone validation** on `pos_customer` in the API and the shared UI helper
   (§4.3). There is no migration. Ship this on its own; it benefits the till too.
2. Schema: `pos_table_qr`, the `auth_otp_challenge` changes, and seeding the
   QR channel.
3. `otp.service` purpose, context, per-purpose caps, and the purpose check on
   the staff verify. Unit tests go next to `otp.test.js`.
4. `posdine` module: resolve, OTP, customer upsert, diner token.
5. Staff QR endpoints, then the frontend print sheet. After this step codes can
   be printed and tested before ordering exists.
6. Diner menu (setting `mode=menu`) goes live. This is useful on its own.
7. Diner orders, the front-desk badge and `mode=order`.

## 8. Tests that matter

- A diner token is rejected by `authenticateToken` on `/api/user/*`.
- A DINER challenge is rejected by `/api/auth/otp/verify`, and a LOGIN
  challenge is rejected by `/api/dine/.../otp/verify`.
- A challenge from table A is rejected at table B.
- A rotated token gives 404 on resolve, and a session opened with it gets 401.
- Hitting the diner daily cap leaves staff `requestOtp` working.
- An order body with `TableId` or a price is refused or ignored.
- An item from another branch of the same tenant is refused.
- A second verify of the same phone reuses the customer (no duplicate). A
  customer typed at the till in local format is matched.
- Settling a QR round increments that customer's `Visits` / `TotalSpent`.

---

## 9. Open questions — need an owner decision

| # | Question | Recommendation |
|---|---|---|
| Q1 | OTP **before** the menu (as requested) or only before ordering? | As requested: OTP first. A `qr.ordering.otpBeforeMenu` flag would be cheap to add later if browse-first converts better, because every OTP costs money even when the diner orders nothing. |
| Q2 | Should staff confirm each QR round (fire KOT), or should it go straight to the kitchen? | **Decided 2026-09-30: staff confirm every QR round.** |
| Q3 | Shared table: which customer does the bill credit? | Each round's `CustomerId` is already recorded. Credit the bill to the customer on the **first** QR round unless staff change it at settle. Split credit needs a ledger change and is out of scope. |
| Q4 | The tenant has not linked any items to the QR channel. | Fall back to dine-in channel items, so turning the feature on works without extra setup. |
| Q5 | The WhatsApp sender shows the platform name, not the restaurant. | Accept for now. Per-tenant WhatsApp numbers are a separate project. |
| Q6 | Online payment from the diner's phone? | Out of scope. Settle at the counter as today. The existing payment QR image can be shown on `DineOrders` once the bill is raised. |
