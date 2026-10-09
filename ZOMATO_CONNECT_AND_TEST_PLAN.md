# Zomato — Connecting and Integration-Testing Plan

How to get from today's code to a live Zomato connection, how to test it at each
step, and what stands in the way.

- **Companion to:** `ZOMATO_INTEGRATION_PLAN.md`, the feature build. Phases 0–4 of it are
  done. This plan covers connecting, testing, and the gaps that plan does not cover.
- **Basis:** Zomato's public POS developer docs (read 3 Oct 2026), and `src/modules/posportal`,
  `poswebhook`, `posonlineorder` and `database/01-schema-definition.sql` at `2f4fdb5`.
- Every code defect below was **checked against the source**. Claims about Zomato's API that come
  from reading their docs rather than seeing a payload are marked **(confirm)**.

---

## 1. Short answer

**Yes, it is possible, in two stages.**

| Stage | Possible today? | What it needs |
|---|---|---|
| **Integration testing against a mock Zomato** | ✅ Yes, no permission needed | A mock server we build ourselves. Zomato's own onboarding *requires* this step (Milestones 2–3) before they give you anything real. |
| **End-to-end testing against real Zomato** | ❌ Not until Zomato onboards you | Zomato creates a POS ID and a test restaurant, configures your webhooks on their side, and shares API keys. |

**The blocker is eligibility, not code.** Zomato's published prerequisites for a POS vendor:

- **≥ 50 restaurants onboarded, or ≥ 10,000 orders a month.**
- **100 % parity** on their critical feature list (41 features, see §3.4).
- A **24×7 on-call channel** with a **< 10-minute** response time.
- **> 99.999 % uptime**, which allows about 5 minutes of downtime a year.

If the volume bar rules out direct onboarding, use an **aggregator middleware** such as
UrbanPiper. It is already integrated with Zomato and Swiggy and has a public staging environment
(`pos-int.urbanpiper.com`). Our adapter registry was designed for this: it means one more adapter
file and one row in `pos_portal`.

**Recommendation:** start the mock-based work now (§5, Stages 1–4). It is required for the direct
route anyway, and most of it carries over to the UrbanPiper route. Apply to Zomato in parallel,
and contact UrbanPiper the same week so you are not waiting on one answer.

---

## 2. Zomato's onboarding milestones, and where we stand

| # | Zomato milestone | What it involves | Our status |
|---|---|---|---|
| 1 | Initial setup | Getting Started form → Vendor Onboarding form (webhook URLs, **headers**, base URLs) → NDA → shared Slack/WhatsApp channel | ⬜ Not started |
| 2 | Development | Build every webhook; **build a mock server for Zomato's endpoints** from the API-reference examples | 🟡 Pipeline exists; mock does not |
| 3 | Integration testing | Menu, order and outlet flows against the **mock**; all live-order and post-order flows covered | ⬜ Blocked on the mock and on D1 (§3.2) |
| 4 | End-to-end testing | Swap the mock for real Zomato endpoints. Zomato provides a test restaurant and store ID, configures your webhooks and shares credentials | ⬜ Blocked on Milestone 1 |
| 5 | Feature demo | Demo every critical feature to your Zomato contact | ⬜ |
| 6 | Pilot | Two live restaurants | ⬜ |
| 7 | Monitoring and scaling | Zomato watches API latency and fulfilment accuracy; you send load-test reports **quarterly** | ⬜ |

After integration, Zomato also asks for a feature checklist with demo videos, a
technical-architecture document, load-test reports, an escalation matrix and a signed legal
agreement.

---

## 3. Gap register

### 3.1 Access and business gaps (not code)

| ID | Gap | Why it matters | Action |
|---|---|---|---|
| A1 | **Volume bar**: 50 restaurants or 10k orders a month | Zomato decides eligibility, and this is the stated minimum | Ask your Zomato contact whether it is firm for a new POS. Have the UrbanPiper route ready |
| A2 | **The API reference is login-gated**: "Please login with your organization email ID first" | Exact payload schemas, header names and the Rejection Message ID list are behind it. Our `zomato.v1` field map is **a guess** until we can read them | Register with a **company-domain email**. A Gmail address will not be accepted |
| A3 | NDA, legal agreement, architecture doc, escalation matrix, load-test reports | Required before go-live, and load tests every quarter after | Draft the architecture doc from the existing plans. Load tests are covered in Stage 7 |
| A4 | **24×7 on-call, under 10 minutes** | A prerequisite, not optional | Needs people, not code. Decide who carries the pager |
| A5 | Each restaurant must already be live on Zomato. Zomato maps and unmaps outlets on request (`posintegrations@zomato.com`) | We cannot self-serve the outlet mapping | Add this to the tenant onboarding runbook |

### 3.2 Defects in the current code (found while writing this plan)

These are independent of Zomato access, and all six would surface in the first real test.

| ID | Severity | Defect | Evidence | Effect with real Zomato |
|---|---|---|---|---|
| **D1** | 🔴 Critical | **A second event for the same order returns a 500.** `ingest()` treats every webhook as a new order and always INSERTs `pos_online_order`. That table has `UNIQUE (PortalId, ExternalRef, TenantId)`. | `posportal.ingest.service.js` `ingest()`; schema line ~2561; `QUERIES.POS_ONLINE_ORDER.INSERT` is a plain INSERT | Zomato's *reject*, *timedout*, *rider-assigned*, *pickedup* and *delivered* webhooks all crash and roll back. **A cancelled order keeps cooking**, and Zomato sees repeated 500s. |
| **D2** | 🟠 High | **Rejecting sends no reason code.** `reject()` records free-text `data.Reason` and pushes the bare status `'cancelled'`. The `pos_rejection_reason` table and CRUD exist (Phase 5 schema), but the lifecycle never reads `RejectionReasonId` or `RejectedItemIds`. | `posonlineorder.lifecycle.js` `reject()` | Zomato requires a `rejection_message_id`, and an item-out-of-stock rejection must include the item IDs. |
| **D3** | 🟠 High | **The kitchen preparation time (KPT) is never sent.** `accept()` attaches `KptMinutes` to the order object, but `HttpAggregatorAdapter.pushStatus` serialises only `{ externalRef, status }`. | `httpAggregator.adapter.js` `pushStatus()` | Phase 3's "pushed to the portal" is not true yet: the KPT is computed and stored, but never sent. |
| **D4** | 🟠 High | **Out-of-stock and outlet on/off changes stay local.** Bulk availability updates `pos_portal_listing.Available`, and `setOnline` updates `pos_portal_branch.IsOnline`. Neither calls the portal. | `posportal.listing.service.js`, `posportal.controller.js` `setOnline` | The customer can still order a dish marked out of stock, or order from an outlet the cashier "paused". |
| **D5** | 🟠 High | **Failed pushes are never retried.** `pushStatusSafely` returns `{ pushed:false }` in the HTTP response, and nothing stores it. The comment says "the caller records the failure and retries", but no code does. | `posonlineorder.lifecycle.js` `pushStatusSafely` | Zomato's order-inaction rule: if an accept that failed to send is not retried within about 5 minutes, **Zomato auto-rejects an order we are already cooking.** |
| **D6** | 🟡 Medium | Portal secrets are stored as plain text in `pos_portal_credential` (`WebhookSecret`, `ApiKey`, `ApiSecret`). | `posportal.service.js` | Anyone who can read the database holds the Zomato keys. |

> **Why the test suite did not catch D1.** Every test, including
> `src/__tests__/integration/*.test.js`, mocks `config/db`. The ingest test *"hashes the body, so
> a changed order for the same ref is not a replay"* proves deduplication lets the second event
> through. On real MySQL, that event then hits the unique key. Constraint, foreign-key and
> transaction bugs are invisible to a mocked database, which is why Stage 3 adds a real-DB lane.

### 3.3 Contract mismatches between our `zomato.v1` declaration and Zomato's published flows

`adapters/index.js` declares Zomato as a configuration of the generic `HttpAggregatorAdapter`. The
published flows show that is not enough:

| Area | What we assume | What Zomato documents |
|---|---|---|
| **Webhook auth** | HMAC-SHA256 of the raw body in `x-zomato-signature` | Order relay headers are *"`<authorization header>`: headers provided by the integration partner"*. We name the headers in the Vendor Onboarding form. This looks like a **static token header**, not a body signature **(confirm)**. Our `verify()` would reject every real request. |
| **Tenant routing** | Each tenant has its own secret. Try every tenant's secret, and the one that verifies is the tenant | Zomato configures **one set of webhook URLs and headers per POS vendor (POS ID)**, not per restaurant **(confirm)**. If every tenant shares one secret, the *first* tenant tried "verifies", **so orders land in the wrong tenant.** Routing has to use `restaurant_id` → `pos_portal_branch.ExternalStoreId`. |
| **Outbound credentials** | Per-tenant `ApiKey` and `ApiBaseUrl` | API keys are issued to the POS vendor by your Zomato contact. That makes them platform-level secrets, not a row per tenant **(confirm)**. |
| **Status push** | One endpoint, `orders/:ref/status` | Separate endpoints: `/online-ordering/v1/order/confirm`, `/reject`, `/ready`, `/pickedup`, `/assigned` and `/delivered`. A path template cannot express this, so Zomato needs its own adapter class. Phase 6 §6.1 already planned one. |
| **Relay response body** | `{ success, message, data: { status, orderId } }` | `{ code: 200, status: "success", message, external_order_id, rejection_message_id: 0 }`. Failure: `{ code: 400, status: "failure", message, rejection_message_id }` |
| **Inbound event types** | One handler, and every event is a new order | At least 11 webhooks: order relay, order status update (`reject` / `timedout`), **fetch order status** (Zomato asks *us* and expects an answer in the response), delivery-partner status (`rider-assigned` / `pickedup` / `delivered`), MAC relay, complaint relay, rating update, outlet serviceability, menu processing status, menu moderation status, chat new-message |
| **Menu push** | A flat list of active items, marked synced on HTTP 200 | `/v3/menu/add` takes the **full menu snapshot: anything not sent is deleted.** The restaurant is **taken off search until processing finishes**, so pushes must be batched. The result arrives later through the processing and moderation webhooks. |
| **Stock** | Sent inside the menu | `inStock` in the menu is **ignored for existing items**. Stock changes go through `/v3/menu/item/stock`. |
| **Category timing** | Overnight windows end at `24:00:00`; any minute is allowed | End of day must be sent as `00:00`. Times must be **multiples of 30 minutes**, with no overlaps, and at least one weekday must stay open |
| **Name length** | `categorydetail.Name` is `VARCHAR(50)` | Zomato allows at most 45 characters for categories and sub-categories. The serializer should flag this before sending; the database stays as it is (the DB is the source of truth). |
| **Required tags** | Optional | A dietary tag on every catalogue item, and a GST goods/services tag on every item except add-ons |
| **Item images** | None. `posmedia` holds only the branch logo and payment QR | A public URL on a Zomato-whitelisted domain, JPEG or PNG, under 15 MB |
| **Order tags** | Ignored | `order_tags` (`MANDATORY_ITEM_CHECKLIST`, `SKIPPABLE_ITEM_CHECKLIST`, `PURE_VEG`) and `scan_text`. The `scan_text` value must be **printed as a QR code on the KOT and the bill** so the rider picks up the right bag. |
| **Mark ready** | No body | `{ order_id, item_check_list: true/false }` when the order carries a checklist tag |

### 3.4 Critical-list features the existing plan does not count

`ZOMATO_INTEGRATION_PLAN.md` counts 37 features (23 menu + 14 order). Zomato's list also has
**Outlet Management (4)**, and 100 % parity is a prerequisite:

| Feature | What exists today | Gap |
|---|---|---|
| Store Operational Hours | Nothing | Delivery-timing APIs, at most 3 slots a day in `HH:MM:SS`, with separate Zomato-delivery and self-delivery timings |
| Turn Outlet on/off | `pos_portal_branch.IsOnline` / `PausedUntil`, local only (D4) | Push through `/v1/restaurant_delivery_status/update` |
| Offline Reason API | `PauseReason` free text | A coded reason |
| Zomato Help Centre (live chat) | Nothing | `/v1/restaurant/help/get` returns a chat link, embedded in the Front Desk |

**Still open from the existing plan:** Order Notification alert (Phase 7, more urgent now that
Zomato auto-rejects after about 5 minutes of inaction), Fetch Order Status, Merchant Agreed
Cancellation, Order Return Flow, Call Masking (the `get-contact-details` endpoint now exists),
and Bulk Order.

### 3.5 Test-infrastructure gaps

| ID | Gap | Fix |
|---|---|---|
| T1 | No mock Zomato, although Zomato's Milestone 2 requires one | Stage 2 |
| T2 | No test runs against a real database (see D1) | Stage 3 |
| T3 | No recorded Zomato payload fixtures | Write them from the public examples now and replace them once A2 gives access to the API reference |
| T4 | No stable public URL for webhooks. Zomato whitelists domains and IPs, and free ngrok URLs change on restart | Use a fixed staging domain for Stage 6 (see H2) |

### 3.6 Hosting and operations gaps

| ID | Gap | Note |
|---|---|---|
| H1 | **99.999 % uptime** is not credible on Vercel Hobby with a single Aiven node | Decide before applying: either upgrade, or state it honestly and ask Zomato what they accept |
| H2 | **Static IP for whitelisting.** Zomato's pre-integration guide asks for *"domain names … and IP addresses"* | Standard Vercel functions have no fixed outbound IP. If Zomato whitelists the IPs we call *from*, outbound Zomato calls need a static-IP proxy or a host with a fixed IP **(confirm whether this is inbound or outbound)** |
| H3 | **Region.** If functions still run in `iad1` against the Mumbai database, each webhook pays about 20 cross-globe round trips (login measured 7.1 s). Zomato monitors API latency | Pin the function region to `bom1` in Vercel Project Settings, not in `vercel.json` |
| H4 | **No background worker.** The D5 retries and any timers need a scheduler | Vercel Cron cannot run every minute on Hobby. Alternatives: an external cron hitting a protected endpoint, or retry-on-next-request plus a slower sweep |

---

## 4. Choosing the route

| | **Direct to Zomato** | **Through UrbanPiper (or similar)** |
|---|---|---|
| Eligibility | 50 restaurants or 10k orders a month | Lower bar for a POS partner **(confirm with UrbanPiper)** |
| Sandbox | Mock first, then a Zomato-provided test restaurant | Public staging at `pos-int.urbanpiper.com` |
| Coverage | Zomato only | Zomato, Swiggy and others through one integration |
| Cost | No middleman fee | Per-outlet fees, usually paid by the restaurant |
| Our work | `zomato.adapter.js` with the full menu serializer | `urbanpiper.adapter.js`. Zomato's menu rules are then UrbanPiper's problem |
| Certification | Zomato's 7 milestones | UrbanPiper's own certification |

Stages 1–3 below help both routes. Stages 4–5 are written for the direct route; for UrbanPiper,
Stage 4 becomes the UrbanPiper adapter and most of Stage 5 shrinks.

---

## 5. The plan

### Stage 0 — Get access (week 1, mostly waiting on others)

1. Register on the Zomato developer portal with a **company-domain email** (fixes A2).
2. Submit the Getting Started form, or email `pos-partnership@zomato.com`.
3. Send your Zomato contact the questions in §8 *before* writing the adapter. The answers
   change what gets built.
4. In parallel, email UrbanPiper's partner programme (`pos.support@urbanpiper.com`) for their
   eligibility rules and staging credentials.
5. Once the API reference is readable, export every request, response and webhook example into
   `scripts/fixtures/zomato/`.

### Stage 1 — Fix the verified defects (week 1–2, no Zomato needed)

| Fix | Approach |
|---|---|
| **D1** | Split `ingest()` by event type. Order created → insert, as today. Status and rider events → `SELECT_BY_EXTERNAL_REF`, then the same `assertTransition` the till uses. A portal-side cancel also voids the KOT. An unknown ref → park the event as `orphan_status`, never a 500. The event row is still written first. |
| **D2** | Wire `RejectionReasonId` and `RejectedItemIds` into the reject schema and lifecycle. Enforce `RequiresItems` and pass `ExternalCode` to the adapter, exactly as `ZOMATO_INTEGRATION_PLAN.md` §5.2 already specifies. |
| **D3** | Make the KPT part of what `pushStatus` sends. |
| **D4** | Add `pushStock(listings, credential)` and `pushOutletStatus(branch, credential)` to `BaseAdapter`. The base implementation reports "not supported", like `pushStatus`. Call them after the local commit. |
| **D5** | Add a `pos_portal_outbox` table (edited into `01-schema-definition.sql` in place; no migration) holding every outbound call that has not yet succeeded: kind, payload, attempts, next attempt, last error. Retry with backoff. Show **"Not yet sent to Zomato"** on the order card. Also add the table to the tenant-delete sweep and `schemaCheck.js`. |
| **D6** | Encrypt credential columns at rest with a key from env. Vendor-level Zomato keys go in env and are never stored in a tenant row. |

Done when every fix has a test and the full suite still passes.

### Stage 2 — Mock Zomato (week 2–3)

`scripts/mock-zomato.js` follows the `mock-graph.js` pattern: it is dev-only, nothing in `src/`
imports it, and config refuses to point at it in production. Run it with `npm run mock:zomato`.

**Half 1: a fake Zomato API** (port 4100) that our backend calls:

- `/online-ordering/v1/order/{confirm,reject,ready,pickedup,assigned,delivered}`,
  `/v3/menu/add`, `/v3/menu/get`, `/v3/menu/item/stock`,
  `/v1/restaurant_delivery_status/{get,update}`, the delivery-timing endpoints, and
  `/v1/restaurant/help/get`.
- **Records every call** to `mock-zomato.log.json`, so a test can assert "we sent confirm with
  KPT 22".
- **Enforces the menu rules we know**: names of 45 characters or fewer, 30-minute slots, no empty
  sub-categories, unique `vendorEntityId`, dietary and GST tags present, and full-snapshot
  deletion semantics.
- After `/menu/add`, it **calls back** our menu-processing and moderation webhooks after a
  delay, as Zomato does.
- `MOCK_ZOMATO_FAIL=503|timeout|400` injects failures, to exercise D5.

**Half 2: a driver** that plays Zomato calling us:

```bash
npm run mock:zomato -- relay   --fixture veg-order          # new order
npm run mock:zomato -- relay   --fixture checklist-order    # MANDATORY_ITEM_CHECKLIST + scan_text
npm run mock:zomato -- status  --order 1965530160 --to reject
npm run mock:zomato -- status  --order 1965530160 --to timedout
npm run mock:zomato -- rider   --order 1965530160 --to rider-assigned|pickedup|delivered
npm run mock:zomato -- fetch-status --order 1965530160    # prints what we answered
npm run mock:zomato -- mac     --order 1965530160         # customer asks to cancel
npm run mock:zomato -- replay  --last                     # byte-identical retry
```

Locally, point the tenant's Zomato `ApiBaseUrl` at `http://localhost:4100`. Swapping it for the
real URL is the whole of Milestone 4.

### Stage 3 — A real-database integration test lane (week 3)

- A Docker MySQL 8.0 container with `01` and `02` applied, the same setup the earlier manual
  validation used.
- A separate Jest project, `src/__tests__/it/**`, run by `npm run test:it`, that **does not mock
  `config/db`**. The app runs in-process under supertest, and the mock Zomato runs in-process
  too.
- It stays out of the default `npm test`, so the fast suite stays fast. Run it before any merge
  that touches portals.
- It covers the scenario matrix in §6. **D1 would have failed here on day one.**

### Stage 4 — The Zomato adapter (weeks 4–6; replaces Phase 6 of the existing plan)

`zomato.adapter.js` extends `BaseAdapter` directly and no longer configures
`HttpAggregatorAdapter`.

| Piece | Work |
|---|---|
| `verify` | Static-header mode with a constant-time compare, plus HMAC if Zomato also signs (per the §8 answer) |
| Tenant routing | Use the vendor credential from env, and resolve the tenant from `restaurant_id` → `pos_portal_branch.ExternalStoreId`, across tenants. Needs a uniqueness rule (Decision 4) |
| Event router | One handler per webhook type in §3.3, each returning Zomato's response shape |
| Fetch order status | Answer synchronously from `pos_online_order.Status`, mapped to Zomato's words |
| `pushStatus` | One endpoint per action. Confirm carries the KPT, reject carries `rejection_message_id` and item IDs, and ready carries `item_check_list` |
| Menu serializer | Build the full snapshot: categories, sub-categories, catalogues, variants, modifier groups, tags, timings (`24:00` → `00:00`), nutrition and GST classification. **Run a preflight check first** that lists every problem. Send one push per batch. Track sync status as `submitted` → `processing` → `live`, or `rejected` with the moderation reason |
| Order tags | Store `order_tags` and `scan_text`. Print `scan_text` as a QR code on the KOT and bill (reusing the QR printing path), and render the checklist before marking ready |

### Stage 5 — Outlet management and remaining critical features (weeks 6–8)

- Outlet on/off with a coded offline reason; delivery timings (at most 3 slots a day); the
  help-centre chat link in the Front Desk.
- The order-arrival alert (Phase 7). This matters more now that Zomato auto-rejects after about
  5 minutes of inaction.
- The Merchant Agreed Cancellation loop, the order return flow, masked contact details, and the
  complaint relay with a refund decision.

### Stage 6 — End to end with Zomato's test restaurant (needs Stage 0)

**From Zomato:** a test restaurant and store ID, our webhooks configured on their side, and
credentials.

**From us:**

- A stable HTTPS domain. Use the production alias, or a dedicated staging project on a fixed
  domain; never per-deployment preview URLs, which are behind Vercel SSO.
- The function region pinned (H3), and a static egress IP if H2 requires one.

**Steps:**

1. Map the test store ID to a test branch.
2. Swap `ApiBaseUrl` from the mock to Zomato.
3. Run the §6 matrix by hand, with your Zomato contact placing test orders.
4. **Capture the real payloads**, replace the Stage 2 fixtures with them, and re-run Stage 3.
   Any difference between the fixtures and reality shows up as a failing test, not a
   production incident.

### Stage 7 — Demo, pilot and scale

- A checklist and demo video for every critical feature, an architecture document and an
  escalation matrix.
- A **load-test report**: k6 or Artillery against the relay webhook plus the accept path, at
  several times peak volume. Repeat it every quarter.
- A two-restaurant pilot. Watch webhook latency, outbox backlog, timed-out orders and
  rejection rate.

### Effort

| Stage | Est. | Needs Zomato? |
|---|---|---|
| 0 Access | 1 wk elapsed | Yes |
| 1 Defects D1–D6 | 1–1.5 wks | No |
| 2 Mock Zomato | 1 wk | No (better with A2) |
| 3 Real-DB test lane | 1 wk | No |
| 4 Zomato adapter | 2–3 wks | Answers to §8 |
| 5 Outlet and remaining features | 2 wks | No |
| 6 E2E with test restaurant | 1–2 wks | Yes |
| 7 Demo and pilot | 2–4 wks elapsed | Yes |

**Stages 1–3 (about 3–4 weeks) can start today** and help whichever route you choose. Frontend
work (order-card push state, checklist UI, outlet controls, chat link) comes on top, at roughly
60 % of the backend effort as before.

---

## 6. Integration-test scenario matrix (Stage 3 and Stage 6)

| # | Scenario | Trigger | Expected in our system | Expected call to Zomato |
|---|---|---|---|---|
| 1 | New order, Zomato delivery | `relay` | `pos_online_order` row `new`, branch resolved, lines priced | — (reply `code:200`, `external_order_id`) |
| 2 | Accept | Front Desk accept | `pos_order` + KOT created; KPT stamped | `order/confirm` with KPT |
| 3 | Mark ready | KDS ready | Status `processing` → ready | `order/ready` |
| 4 | Rider assigned → picked up → delivered | `rider` ×3 | Rider name and phone set; `out for delivery` → `delivered`; settlement posted once | — |
| 5 | Self-delivery | Accept → ready → assign → deliver from POS | Same lifecycle | `confirm`, `ready`, `assigned`, `pickedup`, `delivered` |
| 6 | **Restaurant rejects, item out of stock** | Reject with an IOOS reason and no items | **400**, nothing sent | — |
| 7 | Restaurant rejects, item out of stock, with items | Reject with item IDs | `cancelled`, reason coded | `order/reject` with `rejection_message_id` and item IDs |
| 8 | **Zomato rejects or customer cancels** | `status --to reject` | `cancelled`, **KOT voided**, no 500 (D1) | — |
| 9 | **Order inaction** | `relay`, then no action, then `fetch-status` | We answer `unacknowledged`; then `status --to timedout` cancels it | — |
| 10 | Accept push fails | `MOCK_ZOMATO_FAIL=503`, then accept | Order accepted locally; outbox row; card shows "not sent" | Retried until success (D5) |
| 11 | Byte-identical replay | `replay --last` | `duplicate`, no second order or KOT | — |
| 12 | Unmapped store | `relay` with an unknown `restaurant_id` | Parked as `needs_mapping`, reply 200 | — |
| 13 | Unmapped item | `relay` with an unknown item | Kept, flagged `unmapped`, rest priced | — |
| 14 | Bad auth header | `relay` with the wrong token | 401, **no DB write** | — |
| 15 | Wrong-tenant safety | Two tenants, one vendor secret, `relay` for tenant B's store | Lands in **tenant B** only | — |
| 16 | Missing-item checklist | `relay --fixture checklist-order` | Checklist shown before ready; mandatory checklist blocks ready | `order/ready` with `item_check_list:true` |
| 17 | QR on KOT | `relay` with `scan_text` | KOT and bill print the QR | — |
| 18 | Merchant Agreed Cancellation | `mac`, merchant accepts | `cancelled` | `mac/update` |
| 19 | Menu publish | Publish from the listings screen | Preflight passes → `submitted` → callbacks → `live` | `menu/add`, one full snapshot |
| 20 | Menu preflight failure | A category name over 45 characters | Publish refused with the item list; **nothing sent** | — |
| 21 | Item out of stock | Bulk availability off | Listing unavailable | `menu/item/stock` |
| 22 | Outlet off | `setOnline false` with a reason | Branch paused | `restaurant_delivery_status/update` |
| 23 | Overnight category | Schedule Fri 22:00–02:00 | Two rows stored | Sent as `22:00–00:00` and `00:00–02:00` |

---

## 7. Decisions for you

1. **Route:** direct, UrbanPiper, or both. *Recommended:* build Stages 1–3 now, apply direct, and
   switch Stage 4 to UrbanPiper if Zomato says you are below the volume bar.
2. **Hosting for Stage 6 onward:** stay on Vercel or move the API to a fixed-IP host.
   *Recommended:* decide after your Zomato contact answers the IP question (H2). Upgrading too
   early wastes money.
3. **Retry storage:** a new `pos_portal_outbox`, or reuse `notification_outbox`.
   *Recommended:* a new table. Notifications and portal pushes retry on different schedules and
   fail for different reasons.
4. **Zomato restaurant ID across tenants:** enforce that one Zomato outlet maps to exactly one
   tenant. *Recommended:* yes. Without it, Scenario 15 cannot be guaranteed.
5. **Vendor credentials:** env or a secrets store, never a tenant row. *Recommended:* env, plus
   at-rest encryption for any per-tenant secret that remains (D6).

---

## 8. Questions for your Zomato contact

1. Webhook authentication: a static header we choose, or a signature over the body? Which
   header?
2. Is the 50-restaurant / 10k-orders bar firm for a new POS, or is there a pilot track?
3. Relay webhook timeout and retry policy. What response counts as failure?
4. The exact order-inaction window before Fetch Order Status and the auto-reject.
5. IP whitelisting: is it for *our* outbound calls, for *their* calls to us, or both? Is a
   domain alone enough?
6. The full **Rejection Message ID** list.
7. Is there a separate sandbox base URL, or do test restaurants live on production?
8. Which image domains are whitelisted, and is an item image mandatory?
9. Is the Help Centre chat required as an embedded iframe, or is a link enough?

---

## Sources

- Zomato POS developer platform — https://www.zomato.com/developer/integration/
- Milestones — https://www.zomato.com/developer/integration/docs/getting-started/milestones/
- Prerequisites — https://www.zomato.com/developer/integration/docs/getting-started/prerequisites
- Critical feature list — https://www.zomato.com/developer/integration/docs/getting-started/critical-feature-list
- Forms — https://www.zomato.com/developer/integration/docs/getting-started/forms
- Pre-integration — https://www.zomato.com/developer/integration/docs/getting-started/development-for-integration/pre-integration
- Post-integration — https://www.zomato.com/developer/integration/docs/getting-started/development-for-integration/post-integration
- Order / menu / outlet management — https://www.zomato.com/developer/integration/docs/api-documentation/order-management (also `/menu-management`, `/outlet-management`)
- Menu rules — https://www.zomato.com/developer/integration/docs/getting-started/development-for-integration/menu-integration-flow/add-menu
- Order inaction, QR, item checklist, rejections — `…/development-for-integration/live-order-flow/*`
- UrbanPiper partner programme and environments — https://api-docs.urbanpiper.com/downstream/getting-started/environments

*Written 3 Oct 2026. The Zomato API reference (exact payload schemas) was not readable without a
company-email login, so every item marked **(confirm)** is drawn from their flow documentation
and needs checking against the reference once access lands.*
