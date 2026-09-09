# Billing under concurrency — diagnosis and plan

**Status:** partly SHIPPED — see §0. The rest is proposal, for review.
**Reported:** 30 tenants opening `/frontdesk/billing` at once get errors.
**Written:** 9 Sep 2026

---

## 0. What changed on 9 Sep, and why the numbers below moved

A settle reported as *"taking too much time and failed"* turned out to be a
different bug wearing this one's clothes, and finding it corrected the
arithmetic in §1.

**A settle cost TWO connections at once.** `settle()` opens a transaction and
holds that connection for the whole call, then called `assertBillMutable`, which
called this class's `getById` **override** — and that override opened a
transaction of its OWN. At `CONNECTION_LIMIT 4`, four overlapping settles each
held their transaction and waited for a second connection nobody was left to
release. mysql2 has no acquire timeout, so the wait never ended.

This is precisely the failure `config.js` warns about in its own comments, and
it had been invisible: the existing settle tests stub `withConnection` and
`withTransaction` to hand back one shared connection, so a second acquisition
could not be observed. `posbill.connections.test.js` now stubs the **pool** and
counts — peak concurrent must be 1.

**Billing made 58 requests per load, not 7.** After the seven parallel lists,
the till resolved every dish name with its own `GET /api/itemdetails/:id` — 51
more requests on a 51-dish menu, on every load, each taking a pool connection,
for a column two joins away in the menu query that was already running. That
storm is what the settle then queued behind. `positemmeta` now selects
`idt.Name AS ItemName`; the per-id fetch survives only for a row the join could
not name, which is normally none.

| | Before | After |
|---|---|---|
| Requests per Billing load | **58** | **7** |
| Connections held per settle | **2** | **1** |
| 30 tills opening Billing | 1,740 requests | 210 |

**The same nesting existed in two more places.** `poskot.setStatus` (the
KDS "Mark Ready" button) and `postoken.setStatus` (advancing the counter queue)
each called `this.getById` twice without passing the connection their own
`withConnection` was holding — three acquisitions, two held at once. Four cooks
tapping Ready between them wedged the pool permanently, and every later request,
including plain reads, was then refused instantly with `Queue limit reached.`
Both now borrow the caller's connection.

**A deadlocked pool never recovers.** The four blocked requests are parked
inside `withConnection`, so their `finally { release() }` never runs. Only a
restart clears it — which is why the symptom moves from "one screen hangs" to
"the whole application 503s" and stays there.

`oneConnectionPerRequest.test.js` now scans all of `src/` for this shape and
fails the build on it, because a runtime test structurally cannot see it.

The rest of this document was written against the 7-request figure. Where it
says 210, read 1,740; the ratios and the reasoning are unchanged, and Tier 1
matters *more*, not less.

---

## 1. What is actually happening

Billing fires **7 parallel requests** on every load — `Billing.js` line 170,
`Promise.allSettled` over tables, floors, item-meta, orders, variants, KOTs and
payment modes. Plus POS settings and the shell's own calls.

| | |
|---|---|
| Parallel calls per Billing load | **7** (was 58 before §0) |
| 30 tills open it at once | **210** concurrent requests (was 1,740) |
| Pool capacity | `CONNECTION_LIMIT 4` + `QUEUE_LIMIT 20` = **24** |
| Refused immediately | **186 of 210 — 89%** |

When the wait queue is full, mysql2 does not wait — it throws
`Queue limit reached.` at once. `errorHandler` classifies that correctly and
returns **503 `DB_BUSY`**. That is the error the tills are seeing.

**Nothing is broken.** The pool is doing exactly what it was configured to do.
The configuration is sized for a different shape of traffic than Billing makes.

### The headroom nobody is using

```
MySQL max_connections : 151
Application pool      : 4
```

The database is idle. The bottleneck is entirely in the app's own pool.

---

## 2. Why "just raise the pool" is a trap

The two environments fail in **opposite** directions, which is why one number
cannot be right for both.

| | Local / single process | Vercel serverless |
|---|---|---|
| Instances | 1 | many, one per concurrent burst |
| Total connections | `4` | `4 × instances` |
| Failure mode | queue overflow → `DB_BUSY` | `ER_CON_COUNT_ERROR` — the SERVER runs out |

`config.js` already says this: *"the pool is per instance, so this number is
multiplied by however many Vercel has warm, never a total."* And you have hit
the second failure before — the `ER_CON_COUNT_ERROR` branch in `errorHandler`
exists because it happened.

So raising `DB_CONNECTION_LIMIT` fixes today's local test and moves the failure
to production. It is a valid **step**, not the answer.

The governing rule:

```
warm instances × CONNECTION_LIMIT  <  max_connections × 0.8
```

You cannot size the pool without knowing the left-hand side.

---

## 3. The plan, in order of leverage

### Tier 0 — Unblock the test today (env only, no code)

Set `DB_CONNECTION_LIMIT=30` locally. Capacity becomes 30 + 20 = 50, comfortably
inside MySQL's 151, and your 30-till test will pass.

**Do not copy this to production** until Tier 3's arithmetic is done.

This is a measurement tool, not a fix: it tells you whether concurrency is the
whole story, or whether something else also breaks at 30 tills.

---

### Tier 1 — Stop making 210 requests (the actual fix)

Two independent changes; either helps, together they compound.

#### 1a. Cache the reference data

Five of the seven calls are data that barely changes during a shift:

| Endpoint | Changes | Today |
|---|---|---|
| Tables | when the floor plan is edited | fetched per till, per load |
| Floors | rarely | fetched per till, per load |
| Variants | when the menu is edited | fetched per till, per load |
| Payment modes | almost never | fetched per till, per load |
| Item-meta (menu) | when the menu is edited | fetched per till, per load — the 51 name lookups behind it are gone (§0) |
| Orders | constantly | genuinely live |
| KOTs | constantly | genuinely live |

30 tills currently cause **30 identical menu reads**. One cached read would
serve all of them.

Two layers, and they solve different halves:

- **HTTP caching** (`Cache-Control` + `ETag`) — the browser does not re-request
  at all on a reload. A till reloads Billing many times a shift; this removes
  those round trips before they reach the server.
- **In-process cache with TTL** — the first till to ask populates it; the other
  29 are served from memory.

> **Note:** `config.js` already defines `DATABASE.CACHE_TTL` (5 minutes), but it
> is **referenced nowhere in `src/`**. The intent was recorded and the layer was
> never built. This tier is finishing that thought, not inventing one.

Expected: 7 calls → ~2 live calls per load. **210 → ~60 concurrent.**

#### 1b. One bootstrap endpoint

A single `GET /api/pos/billing/bootstrap` returning all seven payloads.

You already have this pattern — `/api/master-data/bootstrap` composes a whole
first-time setup into one transactional call.

The win is not fewer queries; it is **fewer concurrent requests**. One request
holding one connection for 14 queries is far cheaper to the pool than seven
requests contending for seven connections. It also removes six round trips of
latency from every till's startup.

Expected: **210 → 30 concurrent.** Combined with 1a, most of those 30 are
cache hits.

---

### Tier 2 — Make the platform stop multiplying pools

**Enable Fluid Compute on Vercel.** It multiplexes concurrent requests onto
fewer, longer-lived instances instead of one instance per burst.

Three things improve at once:

1. Fewer instances × 4 = far fewer total connections at Aiven
2. An in-process cache (1a) actually gets **hits**, because instances live long
   enough to serve more than one request
3. The idle sweeper can run — a frozen instance never fires its timers, so idle
   connections are never trimmed

This is the single highest-value platform change for a serverless app talking to
a connection-limited database, and it needs no code.

---

### Tier 3 — Size the pool with real numbers

Only after Tiers 1 and 2, because both **reduce** the number you need.

1. Find `max_connections` on the Aiven plan (not the local 151 — managed plans
   allow far fewer, and it scales with RAM).
2. Observe peak warm instances in Vercel's dashboard.
3. Apply `instances × CONNECTION_LIMIT < max_connections × 0.8`.
4. Set `DB_CONNECTION_LIMIT` from the dashboard — no redeploy, as the comment in
   `config.js` intends.

---

### Tier 4 — Only if Tiers 1–3 are not enough

**An external connection pooler.** This is the industry-standard answer to
"serverless × relational database", and how most teams ultimately solve it: many
short-lived app connections multiplexed onto a few long-lived database ones.

**A caveat specific to your stack:** Aiven ships PgBouncer for **PostgreSQL**
([docs](https://aiven.io/docs/products/postgresql/concepts/pg-connection-pooling)),
and their documentation shows no equivalent managed pooler for **MySQL**. So
this likely means self-hosting ProxySQL rather than ticking a box — real
operational cost, and the reason it sits at Tier 4 rather than Tier 1.

Worth confirming with Aiven support before assuming either way.

---

## 4. A gap worth fixing regardless

**`503 DB_BUSY` is a retryable signal that the UI treats as fatal.**

The backend deliberately distinguishes "busy" from "broken" — that is why
`DB_BUSY` exists as its own code. But nothing on the frontend acts on the
distinction: the till shows an error and the person is stuck.

A short retry with jittered backoff on `503 DB_BUSY` would absorb exactly the
burst this ticket is about. Thirty tills opening at 9am is a *thundering herd*,
and the standard answer is to spread it, not only to widen the pipe.

This does not replace Tiers 1–3, but it is what makes the difference between
"the till was slow for two seconds" and "the till showed an error".

---

## 5. What NOT to do

- **Raising `QUEUE_LIMIT` alone.** It converts fast, honest refusals into long
  hangs. Failing fast under overload is correct; the current design is right.
- **Removing `QUEUE_LIMIT`.** mysql2 has no acquire timeout — an unbounded queue
  means requests that wait forever, which is how the sign-up hang looked.
- **Raising production's pool to match local.** See §2.
- **Retrying without backoff.** Thirty tills retrying in lockstep is the same
  herd, one second later.

---

## 6. Expected effect

| Stage | Concurrent DB requests, 30 tills |
|---|---|
| Today | **210** — 89% refused |
| Tier 0 (env only) | 210, but capacity 50 — still short |
| + Tier 1a (cache) | ~60 |
| + Tier 1b (bootstrap) | **~30**, mostly cache hits |
| + Tier 2 (Fluid) | fewer pools, higher cache hit rate |

Tier 1 is where the problem is actually solved. Tier 0 buys time; Tiers 2–4
protect production.

---

## 7. Decisions needed before any code is written

0. **Re-test the 30-till scenario first.** §0 removed 51 of every 58 requests
   and halved the cost of a settle. Measure before deciding anything below —
   the remaining tiers may be sizing a problem that no longer bites.
1. **Tier 0 still needed?** `DB_CONNECTION_LIMIT=30` locally, but only if the
   re-test still shows refusals.
2. **Cache, bootstrap, or both?** Both compound; the bootstrap endpoint is the
   larger change, caching the faster win.
3. **What is `max_connections` on your Aiven plan,** and what does Vercel report
   as peak concurrent instances? Tier 3 cannot be done without these.
4. **Is Fluid Compute enabled?** If not, that is a free improvement.
5. **Should the frontend retry on `DB_BUSY`?** (§4)

---

## 8. What was verified for this document

- 7 parallel calls: `Billing.js:170`
- Pool 4 + queue 20: `config.js`
- `Queue limit reached.` → 503 `DB_BUSY`: `mysql2/lib/base/pool.js:72`,
  `errorHandler.js:46`
- `max_connections = 151` on the local server
- `CACHE_TTL` defined in `config.js`, referenced nowhere in `src/`
- Menu endpoint takes a second connection for pricing:
  `pricing.repository.js:71`
- Aiven PgBouncer is PostgreSQL-only in their published docs

Not verified, and needed for Tier 3: the Aiven plan's `max_connections`, and
Vercel's peak instance count.
