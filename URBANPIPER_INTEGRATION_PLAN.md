# UrbanPiper Integration — Readiness, Gaps and Plan

Whether we can integrate with UrbanPiper's POS partner programme today, what stands in the
way, and the build-and-certify plan to get there.

- **Companion to:** `ZOMATO_CONNECT_AND_TEST_PLAN.md`. That plan's defects D1–D6 and its test
  infrastructure (mock server, real-database lane) are shared with this one and not repeated in
  full.
- **Basis:** all 88 pages of UrbanPiper's public POS documentation (`api-docs.urbanpiper.com/downstream`,
  read 3 Oct 2026, including full sample payloads), plus `src/modules/posportal`, `poswebhook`,
  `posonlineorder`, `database/01-schema-definition.sql` at `2f4fdb5`, and the frontend
  `OnlineOrders.js` / `OrderDetailPanel.js`.
- Every gap was **checked against the source**. Points marked **(confirm)** come from documentation
  that is ambiguous or silent and need checking with UrbanPiper.

---

## 1. Short answer

**Not yet. But UrbanPiper is a much shorter road than Zomato direct, and the remaining blockers are
mostly ours to fix.**

| | Zomato direct | UrbanPiper |
|---|---|---|
| Eligibility bar | ≥ 50 restaurants or ≥ 10k orders a month | **None published** (confirm) |
| API docs | Behind a company-email login | **Fully public, with complete sample payloads** |
| Sandbox | Mock first, then a test restaurant from Zomato | Staging `pos-int.urbanpiper.com`, an Atlas test account, and **Developer Tools that simulate Zomato and Swiggy orders** |
| Uptime / on-call | 99.999 %, 24×7, under 10 minutes | Not stated |
| Static IP | Requested | Not mentioned |
| Channels covered | Zomato only | Zomato, Swiggy, and about 20 others |
| Certification | 7 milestones, then a pilot | Self-validation checklist, demo, sign-off in "a day or two" |

**What stops us today:**

1. **Business:** staging access is granted only **after a partnership agreement** is signed.
2. **Code:** of the 26 touchpoints UrbanPiper's certification checks, **3 are ready, 10 partial and
   13 missing** (§3). The plumbing is sound: the adapter registry, raw-body webhook route,
   idempotent event log, store mapping, listings, KPT, add-ons, nutrition and GST supply type all
   exist. What is wrong is the *dialect*, plus several shared defects.
3. **Hosting:** UrbanPiper allows **3 s to connect and 5 s to read** on every webhook. A
   **circuit breaker** disables all of a business's webhooks for 1–3 minutes after more than 15
   failures in a minute. Our current hosting measured 7.1 s on login, and webhook latency has never
   been measured.

**Recommendation:** start the partnership paperwork this week. It runs in parallel with Stages 1–7
(§6) and needs no access to begin. Most of the work also serves the Zomato-direct route later.

---

## 2. How UrbanPiper works

```
 Restaurant POS (us)  ⇄  UrbanPiper Hub (Atlas)  ⇄  Zomato · Swiggy · Magicpin · …
   "downstream"              middle layer                 "upstream"
```

### 2.1 Journey

| Step | What happens | Who |
|---|---|---|
| 1. Sign up | Partnership agreement, then a **Gamma** account (UrbanPiper's integration-progress tracker) | Us + UrbanPiper |
| 2. Sandbox | An email with **Atlas** staging credentials, the auth token and a **Postman collection** | UrbanPiper |
| 3. Build | Mark each API in Gamma *New → In-Progress → To-be-verified* | Us |
| 4. Self-validate | Run UrbanPiper's **Testing & Validation** exercise list in staging (at least 3 stores, a virtual brand menu, Developer Tools orders) and fill in the self-validation checklist | Us |
| 5. Demo | A call with UrbanPiper. Fix what they find, then demo again | Both |
| 6. Certify | Submit the sign-off form. The production base URL arrives in 1–2 days | UrbanPiper |
| 7. Per merchant | Gamma *Backlog* → UrbanPiper creates the merchant's Atlas account and production **auth key** → we push stores and menu → their onboarding manager verifies → outlet is mapped to the aggregator → go-live | Both |

### 2.2 Authentication

- **Our calls to UrbanPiper:** `Authorization: apikey <username>:<api_key>`, a static token
  issued **per business (merchant)**.
- **UrbanPiper's calls to us:** static headers *we* choose when registering each webhook (for
  example `x_api_token`). *"No other mode of authorization is supported."* Every webhook also
  carries **`X-UPR-Event-Type`** and **`X-UPR-Biz-Id`**.

### 2.3 Webhook events we must handle

| Code | Event | Kind |
|---|---|---|
| `18` | Order placed | Order |
| `60008` | Order status update (including `customer_cancelled`) | Order |
| `60012` | Order delivery (rider) status update | Order |
| `60017` | Order feature action (complaints, masked contact, additional rider) | Order |
| `60018` | Mark order items stock-out (Swiggy) | Order |
| `60013` | Catalogue create/update through API | Callback |
| `12002` | Hub menu publish | Callback |
| `60014` | Store create/update through API | Callback |
| `60015` | Store actions through API | Callback |
| `12004` / `12005` | Item / option actions through API | Callback |
| `60016` | Category timing groups through API | Callback |
| `60019` | Webhook order retry | Callback |

### 2.4 Constraints we must honour

| Endpoint | Throttle | Payload limit |
|---|---|---|
| `POST /external/api/v1/webhooks/` (register webhooks) | 5 / min | — |
| `POST /external/api/v1/stores/` | 20 / min | 5,000 stores |
| `POST /hub/api/v1/location/` (store toggle) | 20 / min | — |
| `POST /external/api/v1/inventory/locations/:ref/` (menu) | **1 per 5 s** | 2,000 items, 10,000 options |
| `POST /hub/api/v1/items/` (item and option toggle) | **20 / min at peak** (10:00–16:00 and 19:00–01:00 IST), 100 off-peak | 400 per request |
| `POST /external/api/v1/inventory/categories/timing-groups/` | 10 / min | — |
| `PUT /external/api/v1/orders/:id/status/` | 100 / min | — |
| `POST /external/api/v1/webhooks/retry/` | **2 / hour**, today's orders only | — |

Rules that apply everywhere:

- At most **3 retries** on any failed call to UrbanPiper.
- Bulk payloads only.
- **Wait for the callback before sending the next request.**
- Callback successes and errors **must be shown in the POS UI**.

---

## 3. Readiness scorecard

Measured against UrbanPiper's *Testing & Validation* checklist, which is the certification bar.

| # | Touchpoint | Status | Why |
|---|---|---|---|
| 1 | Webhook endpoint (raw body, rate limit, event log) | 🟡 | Exists, but authenticates by HMAC only (G2) |
| 2 | Tenant routing | 🔴 | Tries each tenant's secret, so it cannot use `X-UPR-Biz-Id` (G2) |
| 3 | Routing by event type | 🔴 | Every event is treated as a new order (G3, D1) |
| 4 | Order relay → our order | 🟡 | The pipeline exists, but every field path is wrong (G6) and options are not priced (G9) |
| 5 | `order_ref_id` in the relay response | 🔴 | We return our own envelope (G4) |
| 6 | Duplicates ignored by UrbanPiper order ID | 🔴 | Deduplication is by payload hash, and a changed payload crashes (G5, D1) |
| 7 | Status, POS → UrbanPiper | 🔴 | Wrong method, path, body, auth and vocabulary (G11, G12) |
| 8 | Status, UrbanPiper → POS | 🔴 | Crashes on the unique key (D1); `Food Ready` and `customer_cancelled` are unmapped (G11) |
| 9 | Cancellation reason codes | 🟡 | The table exists but is not wired in (D2, G13) |
| 10 | Customer cancellation (Zomato MAC) | 🔴 | Missing (G14) |
| 11 | Rider status and OTPs | 🟡 | Name and phone columns only (G15) |
| 12 | KPT on acknowledge | 🟡 | Computed but never sent (D3) |
| 13 | Store add/update | 🔴 | No push, and **no store-hours model** (G21) |
| 14 | Store toggle | 🟡 | `IsOnline`/`PausedUntil` exist, but locally only (D4, G23) |
| 15 | Menu push (master, then location) | 🔴 | A flat list, marked synced on HTTP 200 (G16) |
| 16 | Flush and clear operations | 🔴 | Missing (G16) |
| 17 | Category timing groups | 🟡 | Data model ready; no push (G20) |
| 18 | Item and option toggle | 🟡 | Local only (D4, G22) |
| 19 | Variants and add-ons → option groups | 🟢 | Model exists; needs a mapper (G17) |
| 20 | Taxes as CGST_P / SGST_P | 🟢 | The tax engine already splits components; needs a mapper (G18) |
| 21 | Charges (packaging, delivery) | 🔴 | No charge master (G19) |
| 22 | Nutrition, serves, meat type, packaged-good tag | 🟢 | All present from earlier Zomato phases |
| 23 | Callback results shown in the UI | 🔴 | No sync-job model (G24) |
| 24 | New-order alert | 🟡 | In-page sound and banner, only while the queue screen is open |
| 25 | Order screen shows the required fields | 🟡 | A subset; address, order type, delivery type, discounts, payment and rider status are missing (G30) |
| 26 | Webhook answered within 5 s, retries ≤ 3, throttles honoured | 🔴 | Unmeasured; no outbox (H1, D5, G25) |

**3 ready · 10 partial · 13 missing.**

---

## 4. Gap register

### 4.1 Business and access

| ID | Gap | Action |
|---|---|---|
| U-A1 | **Staging only after a partnership agreement** | Email `pos.support@urbanpiper.com` this week |
| U-A2 | **Commercial model unknown.** UrbanPiper charges merchants, and partner terms are not published **(confirm)** | Ask before committing (§9). It decides whether this is viable for small tenants |
| U-A3 | **Each merchant must become an UrbanPiper customer.** A Gamma backlog entry becomes an Atlas account and a production auth key | Needs a "Connect UrbanPiper" screen where a tenant admin enters their biz ID and key |
| U-A4 | The restaurant must already be live on Zomato or Swiggy. UrbanPiper maps the outlet to the aggregator | Add this to the tenant onboarding runbook |
| U-A5 | **Certification test data:** at least 3 stores, a virtual brand menu with variants, add-ons, taxes and charges, and every webhook configured | Build a seed script for a staging tenant (Stage 8) |

### 4.2 Defects shared with the Zomato plan, re-checked for UrbanPiper

Full detail is in `ZOMATO_CONNECT_AND_TEST_PLAN.md` §3.2. UrbanPiper makes each of them worse:

| ID | Defect | Effect with UrbanPiper |
|---|---|---|
| **D1** | A second event for the same order INSERTs again and hits `UNIQUE (PortalId, ExternalRef, TenantId)` → 500 | Every status and rider webhook fails. **More than 15 failures in a minute trips the circuit breaker**, which disables *all* of that business's webhooks, including new orders, for 1–3 minutes. At dinner peak this repeats. |
| **D2** | Rejection ignores `RejectionReasonId` | `reason_code` is **mandatory** for Zomato cancellations |
| **D3** | KPT never sent | Goes in `extra.prep_time_mins` on *Acknowledged* |
| **D4** | Stock and outlet toggles stay local | Certification exercises 7 and 8 fail |
| **D5** | Failed pushes are not stored or retried | The checklist requires retries, but no more than 3, within the throttles |
| **D6** | Secrets stored as plain text | Each merchant's production key would be stored unencrypted |

### 4.3 Integration-model gaps

**Connection and inbound**

| ID | Gap | Evidence | Fix |
|---|---|---|---|
| **G1** | **One transport, many channels.** A `pos_portal` row is a single aggregator carrying its own commission and settlement tender. With UrbanPiper, one connection delivers orders for several channels, named in `order.details.channel` (`zomato`, `swiggy`). | `pos_portal` schema; the webhook route resolves one portal from `/:code` | The ingest step resolves the **channel portal** from `channel`, so commission, settlement and reports stay per Zomato and per Swiggy. Credentials stay on the transport (Decision 1) |
| **G2** | **Inbound auth is a static header plus `X-UPR-Biz-Id`, not HMAC.** `HttpAggregatorAdapter.verify()` rejects anything unsigned. Trying every tenant's secret is also wrong here: the biz ID names the tenant directly | `httpAggregator.adapter.js` `verify()`; `poswebhook.auth.js` | Look up the credential by biz ID, then compare the token in constant time. An unknown biz ID or token gets one generic 401, as today |
| **G3** | **No event routing.** 13 event types arrive (§2.3), and `ingest()` treats each one as an order | `posportal.ingest.service.js` | Dispatch on `X-UPR-Event-Type`. Orders → ingest; status and rider → lifecycle; callbacks → sync jobs (G24) |
| **G4** | **The relay response must carry `{ "order_ref_id": "<our id>" }` at root level** | Relay docs; checklist "Order Relay" item 7 | An UrbanPiper-specific response from the adapter |
| **G5** | **Deduplication must use UrbanPiper's order ID.** After a circuit-breaker trip, UrbanPiper re-pushes missed orders *with their current state* (for example `Acknowledged`), so the bytes differ and our hash check misses them | Circuit-breaker doc; checklist technical item 8 | Duplicate check on (portal, `order.details.id`). Accept a starting state other than `Placed` |
| **G6** | **Every field path is wrong.** `COMMON_FIELDS` assumes `order.id`, `order.items`, `order.totals.*` | `adapters/index.js` | A new map (see the table below) |
| **G7** | **Store resolution uses *our* ID.** `order.store.merchant_ref_id` is the `ref_id` we sent when creating the store. Today we look up `pos_portal_branch.ExternalStoreId` | Relay sample | Send `pos_portal_branch.Id` as the store `ref_id` and resolve on it directly |
| **G8** | **Line resolution uses *our* item ID.** UrbanPiper's menu is *federated*: one item `ref_id` across all stores, so `items[].merchant_id` is our `ItemDetailId`, not a per-portal `ExternalItemId` | `listingService.findByExternalItem`; menu-architecture doc | Resolve `ItemDetailId` + branch → that branch's `pos_item_meta` |

Field map for G6:

| Canonical field | UrbanPiper path |
|---|---|
| externalRef | `order.details.id` (UrbanPiper's ID, used for status calls) |
| channel order ID | `order.details.ext_platforms[0].id` (show it; it is what the rider quotes) |
| channel | `order.details.channel` |
| store | `order.store.merchant_ref_id` |
| state | `order.details.order_state` |
| placed / promised | `order.details.created` / `delivery_datetime` (epoch ms) |
| order type / delivery type | `order.details.order_type` / `ext_platforms[0].delivery_type` (`self` or `partner`) |
| customer | `customer.name`, `customer.phone`, `customer.address.*` |
| lines | `order.items[]`: `merchant_id`, `title`, `quantity`, `price`, `total`, `instructions`, `options_to_add[]` |
| totals | `order_subtotal`, `discount`, `total_external_discount`, `total_charges`, `total_taxes`, `order_total`, `payable_amount` |
| payment | `order.payment[].option` (`cash`, prepaid…) and `ext_platforms[0].extras.cash_to_be_collected` |
| cutlery / instructions | `ext_platforms[0].extras.send_cutlery`, `order.details.instructions` |
| access code / OTP | `extras.contact_access_code`, `extras.order_otp` |
| KPT hint | `order.details.prep_time.{estimated,min,max,adjustable}` |

**Order lines and money**

| ID | Gap | Fix |
|---|---|---|
| **G9** | **Options are neither resolved nor priced.** `options_to_add[]` (variants and add-ons, each with a price) is kept raw in `addOns`. `resolveLines` prices only the item from our listing, and an item's price can be 0 with the price on its variant. The checklist requires our totals to **match Atlas exactly** | Resolve each option `merchant_id` to `pos_variant` or `pos_addon`, and carry its price |
| **G10** | **We re-price what the customer already paid.** Mapped lines are priced through our tax engine, so line totals can differ from the payload | Treat the payload as the money of record for portal orders. Run our engine only to *flag* differences; UrbanPiper even has a `total_missmatch` reason code for this (Decision 2) |
| G28 | Food-type mapping: ours is veg / non-veg / egg, theirs is `1/2/3/4`. Swiggy has no egg type | Mapper plus a preflight warning |
| G29 | **Cash orders.** `payment[].option = cash` with self-delivery means the cash reaches *our* till, but `settle.js` always settles through the portal's settlement tender **(confirm against the finance design)** | Settle cash orders to the cash tender |
| G30 | **The order screen is missing required fields.** The checklist requires customer address, order type, delivery type, contact access code, channel order ID, instructions, delivery time, charges, discounts (merchant-sponsored = `discount − total_external_discount`), payment type, and rider name, phone and status. `OrderDetailPanel.js` shows about half | Persist the missing fields on `pos_online_order`, not only in `Payload`, and render them |
| G31 | **Scheduled orders.** A `delivery_datetime` beyond the minimum prep time means a future order, and the KOT fires immediately today | Hold the KOT until a configured lead time before delivery |

**Order lifecycle**

| ID | Gap | Fix |
|---|---|---|
| **G11** | **Status vocabulary.** UrbanPiper's states are `Placed`, `Acknowledged`, `Food Ready` (with a space), `Dispatched`, `Completed`, `Cancelled` and `customer_cancelled`. `COMMON_STATUS_MAP` has `FOOD_READY`, not `FOOD READY`, and nothing for `customer_cancelled`, so both resolve to null and are ignored | Inbound mapping in both directions. Outbound: `accepted`→`Acknowledged`, `processing`→`Food Ready`, `out for delivery`→`Dispatched`, `delivered`→`Completed` |
| **G12** | **Outbound transport.** We send `POST` with `Bearer` and `{ externalRef, status }`. UrbanPiper needs `PUT /external/api/v1/orders/:id/status/` with `apikey user:key` and `{ new_status, message, reason_code, extra }` | An UrbanPiper adapter class (not a configuration of `HttpAggregatorAdapter`) |
| **G13** | **Cancellation rules per channel.** Our transitions allow cancelling from any open state. UrbanPiper's rules: POS cancellation generally only before *Acknowledged*. Zomato also allows it after acceptance, up to *Food Ready* for Zomato delivery or *Completed* for self-delivery, each with a restricted reason list. **Swiggy returns 400 "Callback requested instead"**, which must be treated as cancelled locally. `turn_on_at` is required for some reasons | Rules come from the adapter, not hard-coded per portal name. Map `pos_rejection_reason.ExternalCode` to their 11 codes |
| **G14** | **Customer cancellation (Zomato MAC).** `customer_cancelled` arrives with `timeout_secs`, and we must answer `extra.accept_customer_cancellation` before it expires | A countdown prompt on the order card, plus the outbound response |
| **G15** | **Rider status.** `delivery_info.current_state` (`assigned`, `at-store`, `out-for-delivery`, `delivered`, `re-assigned` and return states) and the OTPs (`order_return_otp`, `bag_return_otp`). We store only rider name and phone. For Zomato, the rider OTP is the last 4 digits of the customer's phone | Add `RiderStatus` and OTP fields; return flows validate the OTP |

**Stores and availability**

| ID | Gap | Fix |
|---|---|---|
| **G21** | **No store opening hours anywhere in the schema.** The store payload needs per-day `timings` slots, along with name, city, address, latitude/longitude, phone, notification phones and emails, minimum pickup and delivery times, and `platform_data` (Zomato or Swiggy store ID **and URL**). We have address, city, pincode, lat/lng and phone through branch joins, but no hours, no platform URL and no minimum times | A new `pos_branch_hours` table (Decision 4), and `PlatformUrl` on `pos_portal_branch`. Edit `01-schema-definition.sql` in place, with no migration |
| G22 | **Item and option toggle.** Up to 400 per request, **20 a minute at peak**. Category out-of-stock has no API, so it becomes a toggle of every item in the category. Variant out-of-stock is an option toggle | Batched through the outbox |
| G23 | **Store toggle.** `turn_on_at` (5 minutes to 30 days) maps directly to our `PausedUntil`. The callback can return `editable:false`, meaning the store can't be changed through the API | Push it, and show the `editable:false` case |
| G36 | **Webhook registration** can be automated with `POST /external/api/v1/webhooks/` (5 a minute) | The "Connect UrbanPiper" action registers every event for that business |

**Menu**

| ID | Gap | Fix |
|---|---|---|
| **G16** | **The menu push model.** A **master** request (`-1`), **wait for its callback**, then one **location** request per store, each waiting for its callback. One bulk payload ordered categories → items → option groups → options → taxes → charges. At most 1 request per 5 s, 2,000 items and 10,000 options. Plus `flush_*` and `clear_*` semantics. Today `pushMenu` sends one flat list and marks it synced on HTTP 200 | A **menu sync job** driven by callbacks (G24) |
| G17 | **Variants and add-ons.** A variant group must have min = max = 1 and more than one option, with prices on the options. An add-on group has min 0 and max −1 (unlimited); ours defaults `MaxSelection` to 1. Our variants are a tenant master (`pos_variant`) plus per-branch `pos_item_meta.Variants` JSON | Generate one variant option group per item (`VG-<ItemDetailId>`). Our `pos_addon_group` → option group, `pos_addon` → option. Skip nested groups in v1 |
| G18 | **Taxes** use codes `CGST_P` / `SGST_P` / `IGST_P` with `item_ref_ids`. There is no single GST code, and titles must contain "cgst" or "sgst". Our tax groups already store CGST and SGST as components | A mapper from tax-group components |
| G19 | **Charges.** There is no packaging or delivery charge master; `PackingCharge` exists only on the order. UrbanPiper codes are `PC_F` / `PC_P` / `DC_F` / `DC_P`, with titles exactly "Packaging Charge" or "Delivery Charge". Zomato requires order-level charges to be a percentage, at most one per store; Swiggy allows item-level only | Configure charges in Atlas manually for v1, or build a `pos_charge` master (Decision 3) |
| G20 | **Category timing groups** are a separate API, master-level only (which fits our tenant-wide `pos_category_schedule`), with `HH:MM` on :00 or :30. We store the end of an overnight window as `24:00:00`. UrbanPiper's end-of-day form is unstated **(confirm)** | Serializer conversion, plus 30-minute steps in the UI when UrbanPiper is connected |
| G24 | **Callbacks must reach the UI.** Each async call returns a `reference`, and the callback reports per-entity `upipr_status` errors. Our per-listing `SyncStatus` is close, but it has no reference and no job | A `pos_portal_sync_job` table (kind, reference, state, request summary, callback, errors) and a screen listing jobs and their errors |
| G25 | **Throttles and ≤ 3 retries** apply to every outbound call | The D5 outbox enforces per-endpoint rates and a maximum of 3 attempts, then marks the call failed and visible |
| G26 | **Item images:** 400×400 PNG or JPG; "recommended" items *require* one. We store no item images | Defer: add them in Atlas for v1 (Decision 5) |
| G27 | **Aggregator content rules**, checked before sending: price ≤ ₹5,000; no two item names that differ only in digits (Zomato treats "Chicken 65" and "Chicken 95" as the same); no platform names or promo words in titles; nutrition mandatory for Zomato and Swiggy; a `packaged-good` tag when `SupplyType = GOODS`; description mandatory for combos and thalis (Swiggy); meat type for non-veg items (we have `MeatTypeId`); at most 400 items per store on Swiggy; a parent category with sub-categories cannot hold items itself | A preflight validator that returns every problem at once. Atlas validates again before publish |

**Lower priority (v1.1)**

| ID | Gap |
|---|---|
| G32 | **Multi-brand.** UrbanPiper assigns a POS ID per location *and* brand. We have no brand concept. v1 assumes one brand per tenant branch |
| G33 | Swiggy order modification (`60018`, mark order items out of stock) |
| G34 | Complaints (`60017`, codes `food-quality` / `packaging` / `food-quantity` / `other`) and Zomato feature actions (additional rider for bulk orders, masked contact). Store them from day one even before acting on them |
| G35 | **Webhook Order Retry API** (2 an hour, today only) as an admin "recover missed orders" button and a runbook step after any outage |

### 4.4 Hosting and operations

| ID | Gap | Note |
|---|---|---|
| **H1** | **3 s connect / 5 s read on every webhook.** Ingest makes about `5 + 2×lines` round trips plus pricing. Login measured 7.1 s with functions in `iad1` and the database in Mumbai. Missing the window means *"the orders will fail to reach the POS system"* | Pin the Vercel function region to `bom1`. Keep pricing off the hot path (G10). Add a latency test with a **p95 under 2 s** as the bar. If it can't be met, host the webhook somewhere always warm |
| **H2** | **Circuit breaker:** more than 15 failures a minute for one business disables all its webhooks to our hostname for 1 minute, or 3 minutes after 5 trips in a week. Disabled-webhook emails go to the business's contact emails | Fixing D1 and H1 is what prevents this. Send the breaker emails to our ops address |
| H3 | Static IP, uptime SLA, on-call: **none stated** | Not a blocker, unlike Zomato direct |
| H4 | Retries need a scheduler; menu sequencing does not, because callbacks drive each next step | An external cron hitting a protected endpoint, or retry-on-next-callback |

---

## 5. Recommended design

```
                               ┌──────────────── pos_portal: URBANPIPER (adapter urbanpiper.v1)
 UrbanPiper ──webhook──▶ /api/pos/portal-webhooks/URBANPIPER     credential: BizId, apikey user:key,
   X-UPR-Event-Type           │                                  webhook token, base URL (staging|prod)
   X-UPR-Biz-Id               ▼
                    auth: BizId → credential → constant-time token compare
                              │
            ┌─────────────────┼──────────────────────┬────────────────────────┐
         18 order        60008/60012 status      600xx/120xx callbacks     60017/60018
            │                 │                       │                       │
   ingest → channel portal  lifecycle (no INSERT)   pos_portal_sync_job     store, then act later
   (ZOMATO / SWIGGY row:     Food Ready, MAC,         → next step of the
    commission, settlement)  rider, OTP               menu/store job
            │
   reply { order_ref_id }

 Outbound: lifecycle / toggles / menu jobs → pos_portal_outbox (per-endpoint throttle, ≤3 tries) → UrbanPiper
```

- **Channel portals stay as they are.** The seeded Zomato and Swiggy rows keep their commission,
  settlement tender and reports. They gain a reference to the transport, `ViaPortalId →
  URBANPIPER`, and the ingest step resolves `channel` → the portal whose `Code` matches.
- **The credential gains `ExternalAccountId` (biz ID)**, edited into `01-schema-definition.sql`
  in place, plus `schemaCheck.js` and the tenant-delete sweep. `ApiKey` holds the username and
  `ApiSecret` holds the key, both encrypted (D6).
- **`urbanpiper.adapter.js` extends `BaseAdapter`**, adding `routeEvent`,
  `buildRelayResponse`, `pushStoreAction`, `pushItemToggle`, `pushStores` and
  `pushTimingGroups` with "not supported" defaults in the base class. `manual` and the other
  adapters stay untouched (Open/Closed).

---

## 6. The plan

### Stage 0 — Partnership and sandbox (start now; 1–2 weeks elapsed)

1. Email `pos.support@urbanpiper.com` to join the POS partner programme, and send the §9
   questions in the same email.
2. Sign the partnership agreement, then receive the sandbox: Atlas staging login, auth token
   and Postman collection.
3. Log into Gamma and keep each API's status current as Stages 1–7 land. UrbanPiper watches it
   to spot stalled partners.

### Stage 1 — Shared defects D1–D6 (1–1.5 weeks; no access needed)

Do this exactly as `ZOMATO_CONNECT_AND_TEST_PLAN.md` Stage 1 describes, with one UrbanPiper-specific
acceptance test: **a re-pushed order whose state is `Acknowledged` is recognised as a duplicate
by order ID**, with no 500 and no second order.

### Stage 2 — Connection and inbound (1.5 weeks)

- G1, G2, G3, G4, G5, G6, G7, G8, and the inbound half of G11.
- Schema: `pos_portal.ViaPortalId`, `pos_portal_credential.ExternalAccountId`.
- Seed: a `URBANPIPER` portal row in `02-seed-data.sql` **and** in `posMasters.provision.js`.
- Front Desk: a "Connect UrbanPiper" screen that saves credentials and auto-registers webhooks
  (G36).
- **Latency test** for the full relay path, with a p95 under 2 s (H1).

### Stage 3 — Line and money fidelity (1 week)

- G9 (option resolution and pricing), G10 (payload as the money of record), G28, G29.
- G30, backend half: persist address, order type, delivery type, channel order ID, access code,
  OTP, discounts, payment type and promised time.
- G31: hold the KOT for scheduled orders.

### Stage 4 — Outbound lifecycle (1 week)

- G12, plus the outbound half of G11 with KPT in `prep_time_mins` (D3).
- G13: channel cancellation rules and reason codes (D2).
- G14: MAC with its countdown.
- G15: rider status and OTPs.
- Every call goes through the outbox (D5, G25).

### Stage 5 — Stores and availability (1 week)

- G21: the `pos_branch_hours` table and editor, plus platform URL and minimum times.
- Store add/update push and callback.
- G23: store toggle with `turn_on_at`.
- G22: item and option toggle, including category and variant out-of-stock.

### Stage 6 — Menu push (2–2.5 weeks)

- G16: a menu sync job running master → callback → each location → callback, with flush and
  clear.
- G17, G18, and G19 (per Decision 3).
- G20: timing groups.
- G27: preflight.
- G24: the sync-job screen.

### Stage 7 — Mock UrbanPiper and real-database lane (1 week, overlapping Stages 2–6)

- `scripts/mock-urbanpiper.js`, following the `mock-graph.js` pattern: dev-only and refused in
  production.
- **Fake API:** every endpoint in §2.4. It records calls, enforces the throttles (returning
  `429`) and validates menu rules, then fires the matching callback webhook after a delay.
  `MOCK_UP_FAIL` injects failures.
- **Driver:** `npm run mock:up -- relay --fixture zomato-veg | status --to customer_cancelled |
  rider --to at-store | replay --state Acknowledged | breaker` sends events with the right
  `X-UPR-*` headers.
- **Fixtures come from UrbanPiper's own sample payloads**, which their public docs publish in
  full. This is a real advantage over Zomato, where we could only guess.
- The real-database Jest lane is shared with the Zomato plan's Stage 3. It runs §7's matrix.

### Stage 8 — Staging certification (1–2 weeks elapsed; needs Stage 0)

1. Seed a staging tenant with **3 branches** and a virtual brand menu (variants, add-ons,
   taxes, charges), then connect it to Atlas staging.
2. Run **UrbanPiper's exercise list verbatim** (§7.3) using Atlas *Developer Tools* for orders
   and Postman for rider payloads.
3. Fill in the self-validation checklist, book the demo, fix what they find, and demo again.
4. Submit the sign-off form and receive the production base URL.

### Stage 9 — First merchant live

1. Gamma backlog entry → Atlas account and production key → tenant connects → stores and menu
   pushed.
2. UrbanPiper's onboarding manager verifies, then the outlet is mapped to Zomato or Swiggy.
3. Watch webhook p95, outbox backlog, sync-job errors and breaker emails for the first two weeks.

### Effort

| Stage | Backend | Needs UrbanPiper? |
|---|---|---|
| 0 Partnership | — (1–2 wks elapsed) | Yes |
| 1 Shared defects | 1–1.5 wks | No |
| 2 Connection and inbound | 1.5 wks | No |
| 3 Money fidelity | 1 wk | No |
| 4 Outbound lifecycle | 1 wk | No |
| 5 Stores and availability | 1 wk | No |
| 6 Menu push | 2–2.5 wks | No |
| 7 Mock and real-database lane | 1 wk (overlaps) | No |
| 8 Certification | 1–2 wks elapsed | Yes |
| **Total** | **about 8.5–9.5 weeks of backend** | |

**Stages 1–7 need nothing from UrbanPiper**, because their docs and sample payloads are public.
Frontend work comes on top, at roughly 60 % as before:

- the Connect screen;
- the order-panel fields;
- the MAC countdown;
- rider status and OTP;
- the store-hours editor;
- the sync-job and preflight screens.

---

## 7. Test plan

### 7.1 What each layer proves

| Layer | Proves | Catches |
|---|---|---|
| Unit (existing, mocked DB) | Mappers, status maps, preflight rules, response shapes | Wrong paths, missing codes |
| **Real-database lane + mock UrbanPiper** | Whole flows against MySQL with real constraints | D1-type crashes, transaction and foreign-key bugs, throttle handling |
| **Atlas staging** | The real contract, with real Developer Tools orders | Anything the docs got wrong |

### 7.2 Mock-lane scenarios (Stage 7)

| # | Scenario | Expected |
|---|---|---|
| 1 | Relay, Zomato, veg, no options | Order in the **Zomato** channel portal; reply has `order_ref_id` |
| 2 | Relay with variant + 2 add-ons, qty 2 | Options resolved; our totals equal the payload's to the paisa |
| 3 | Relay for a Swiggy order on the same connection | Lands under the **Swiggy** portal with Swiggy commission |
| 4 | Same order re-pushed with state `Acknowledged` | Duplicate by order ID: 200, no second order, no 500 |
| 5 | Wrong token / unknown biz ID | 401, no database write |
| 6 | Two tenants, two biz IDs | Each order lands in its own tenant only |
| 7 | Accept with KPT 22 | `PUT …/status/` with `Acknowledged` and `prep_time_mins: 22` |
| 8 | Kitchen ready → dispatched → delivered | `Food Ready` → `Dispatched` → `Completed` |
| 9 | Inbound `Cancelled` from Atlas | Order cancelled, KOT voided |
| 10 | Inbound `customer_cancelled`, `timeout_secs: 180` | Prompt with countdown; reply carries `accept_customer_cancellation` |
| 11 | POS cancels a Swiggy order and gets the 400 "callback requested" | Marked cancelled locally; nothing further sent |
| 12 | Cancel after Acknowledge, Zomato delivery, reason `store_busy` | Allowed. With `rider_not_available` → refused before sending |
| 13 | Rider: assigned → at-store → out-for-delivery → delivered | Rider status and phone on the card; OTP shown |
| 14 | Status push gets a 503 | Outbox retries **3 times at most**, then a visible failure |
| 15 | 25 toggles in one minute at peak | Batched and throttled to ≤ 20 a minute, no 429 storm |
| 16 | 20 failing webhooks in a minute | The mock's breaker trips; our alerting fires |
| 17 | Menu publish | Master job → callback → 3 location jobs → callbacks; errors listed per entity |
| 18 | Menu preflight: ₹6,000 item, "Chicken 65" + "Chicken 95" | Publish refused, both problems listed, nothing sent |
| 19 | Store pause for 45 minutes | Store toggle `disable` with `turn_on_at` = now + 45 min |
| 20 | Variant "Large" out of stock | Option toggle for that option only |
| 21 | Scheduled order, delivery in 3 hours | Order accepted; KOT held until the lead time |
| 22 | Cash, self-delivery, delivered | Settles to the **cash** tender, not the portal tender |
| 23 | Relay p95 over 50 runs | Under 2 s |

### 7.3 Atlas staging run (Stage 8): UrbanPiper's own exercise list

Store create ×3 in one request · store disable and enable · master menu (`-1`) then location
menus for all 3 stores · menu update · flush and clear operations · item and option disable and
enable · Developer Tools orders across both locations and platforms:

- no options;
- quantity and line count above 1;
- with an add-on, and with more than one add-on;
- with variants, and with variants plus add-ons;
- packaging, delivery and service charges;
- partner and self delivery;
- delivery and pickup;
- a future order;
- prepaid and cash;
- order instructions.

Then:

- compare every order against Atlas field by field;
- move orders through Acknowledged → Food Ready from the POS, and Dispatched → Completed from
  Atlas;
- cancel from the POS with a reason, and from Atlas;
- cancel a Swiggy order and get the 400 "callback requested";
- send rider status through Postman in 4 steps.

---

## 8. Decisions for you

1. **Connection model:** an `URBANPIPER` transport portal, with Zomato and Swiggy as channel
   portals that point to it. *Recommended*, because commission, settlement and reporting per
   channel keep working unchanged. The alternative, one `URBANPIPER` portal for everything,
   loses the Zomato-vs-Swiggy split.
2. **Money of record for portal orders:** the payload. *Recommended*: the customer paid that
   amount, and certification compares against it. Our tax engine then only flags
   mismatches.
3. **Charges:** set them up in Atlas by hand for v1. *Recommended*: it is permitted and unblocks
   certification. Build a `pos_charge` master in v1.1.
4. **Store hours:** a new `pos_branch_hours` table. *Recommended*. The Zomato-direct outlet
   features need it too, so it is built once.
5. **Item images:** defer to Atlas for v1. *Recommended*. Proper image storage is its own project
   (public URLs, 400×400).
6. **Multi-brand:** out of scope for v1, with one brand per branch. *Recommended*.
7. **Hosting:** pin `bom1` and measure. Move the webhook to an always-warm host **only if** the
   p95 misses 2 s.

---

## 9. Questions for UrbanPiper (send with the Stage 0 email)

1. **Commercials:** is there a partner fee, and what does a merchant pay per outlet? Any minimum
   merchant count for a new POS partner?
2. **India pricing:** the `platform_pricing` note is headed "aggregators outside India". Can a
   different price be set for Zomato and Swiggy through the API in India, or is `external_price`
   the only aggregator price?
3. **Category timing slots:** how is end of day written (`23:59`, `24:00` or `00:00`)?
4. **Webhook auth:** confirm a different static token per business is supported, and that
   `X-UPR-Biz-Id` is sent on *every* event, callbacks included.
5. **Retry scheme:** what `retrial_interval_units` and attempt count do you recommend for order
   relay?
6. **Staging:** how many test businesses and stores do we get? Can Developer Tools simulate
   `customer_cancelled` and the rider flows, or is Postman the only way?
7. Is any IP or domain whitelisting needed on either side?
8. Is the self-validation checklist the same as the published Testing & Validation page, or a
   separate document?

---

## Sources (UrbanPiper public docs, read 3 Oct 2026)

- Partner programme — https://api-docs.urbanpiper.com/downstream
- Onboarding process — https://api-docs.urbanpiper.com/downstream/getting-started/onboarding-process
- Environments and sandbox — https://api-docs.urbanpiper.com/downstream/getting-started/environments
- Webhooks and callbacks — https://api-docs.urbanpiper.com/downstream/getting-started/webhooks-callbacks
- Webhook event headers — https://api-docs.urbanpiper.com/downstream/api/references/webhook-event-headers
- Webhook circuit breaker — https://api-docs.urbanpiper.com/downstream/resources/webhook-circuit-breaker
- Authentication — https://api-docs.urbanpiper.com/downstream/authentication/authentication
- Developer Tools — https://api-docs.urbanpiper.com/downstream/getting-started/developer-tools
- Testing and validation — https://api-docs.urbanpiper.com/downstream/integration-certification/testing-and-validation
- Certification — https://api-docs.urbanpiper.com/downstream/integration-certification/certification
- Order relay / status / rider — https://api-docs.urbanpiper.com/downstream/api/endpoints/order-management/order-relay (and `/order-status-update`, `/rider-status-update`)
- Stores / store toggle — https://api-docs.urbanpiper.com/downstream/api/endpoints/stores/add-update-stores (and `/store-toggle`)
- Menu / menu toggle / timing groups — https://api-docs.urbanpiper.com/downstream/api/endpoints/menu/add-update-menu (and `/menu-toggle`, `/category-timing-groups`)
- Flush operations — https://api-docs.urbanpiper.com/downstream/resources/flush-operations
- Aggregator constraints (generic, Zomato, Swiggy) — https://api-docs.urbanpiper.com/downstream/aggregator-constraints/generic (and `/zomato`, `/swiggy`)
- Multi-brand workflow — https://api-docs.urbanpiper.com/downstream/resources/multi-brand-workflow

*Written 3 Oct 2026. UrbanPiper's docs note they "try to keep this doc in sync … but at times a gap
creeps in", so Stage 8 against Atlas staging is the final word on every field map above.*
