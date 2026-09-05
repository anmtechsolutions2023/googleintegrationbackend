# WhatsApp Identity Migration — Decision Record

Replacing the email address with the mobile number as the identity key across
Restro OS, and Google sign-in with WhatsApp OTP.

Status: **design agreed, implementation starting.** Phase tracker in §11.

This file is the durable record of *why*, not just *what*. Every decision below
carries the reasoning that produced it, including the options rejected — those
are the parts that get re-litigated six months later when nobody remembers.

Design canvases (visual, same content):

- Audit and options — `https://claude.ai/code/artifact/3e8e1366-9e93-4981-895d-f14ea311eeec`
- Implementation design — `https://claude.ai/code/artifact/bd89ca0f-6f37-411f-8b1c-a2d9a178056a`
- OTP sign-in screens — `https://claude.ai/code/artifact/d7044ffa-69d4-4f87-8be1-1c4342c488b8`

---

## 1. The decision

Mobile number **replaces** email as the identity key. Google sign-in is retired.
Existing data is discarded, so this is a schema redefinition, not a migration.

Decided by the product owner after reviewing the full audit and the three
options in §3. Recorded here because the alternatives were argued and rejected
on the record, not overlooked.

---

## 2. Why the existing-data decision matters more than anything else

Everything expensive about this change was about carrying people and history
across: backfill, a dual-run window where both credentials resolve, lockout risk
at cutover, audit history stranded between two identity namespaces.

**None of it applies.** `database/01-schema-definition.sql` is edited in place
and the database is rebuilt. No `ALTER` scripts, no compatibility views, no
cutover window, no dual-run.

**Net:** what remains is a large mechanical rename plus one genuinely new
subsystem (WhatsApp). That is a materially different, and smaller, project than
the same change would have been with data to preserve.

---

## 3. Options considered

| | Option | Verdict |
|---|---|---|
| **A** | Replace the identity column: `user_email` → `user_phone` everywhere | **Chosen** |
| **B** | Phone as a second *credential*; email stays the internal key | Rejected by owner |
| **C** | Opaque internal `user_id`; email and phone both become credentials | Rejected by owner |

### Why A was originally advised against, and why that no longer holds

The original recommendation was B, then C. Three objections drove that, and the
existing-data decision removed two of them:

| Objection | Status now |
|---|---|
| Backfill, dual-run, lockout at cutover | **Gone** — no data to carry |
| Audit history split across two identity namespaces | **Gone** — no history to preserve |
| Phone numbers are recycled; a mutable identifier is a poor permanent key | **Still stands** — see §9.3 |

### The hedge that was offered and not taken

Naming the JWT claim `sub` rather than `phone` would cost nothing extra during a
rename that touches everything anyway, and would make the *next* identity change
free. The reason this migration is 971 references is that the last identity
choice was baked into the claim name.

Recorded as an open question in §12 — still cheap up to phase 4, expensive after.

---

## 4. Audit findings that shaped the design

Counted from source, not estimated.

### 4.1 How identity worked before

Three entry paths, all resolving to the email Google asserts:

1. **Signup** — Google → `onboarding_requests` (`UNIQUE(email)`, plus `google_sub`) → super-admin approval.
2. **Invitation** — admin writes `tenant_invitations` (email) → invited person signs in with Google → `acceptPendingTx(conn, email)` matches and provisions the membership.
3. **Return** — Google → `findAndGetPermissions(email)` → `generateAppToken()`.

### 4.2 The finding that changed the plan

**Invitations are never sent.** There is no mail transport in the system —
`src/modules/notification/notification.outbox.js` states this explicitly, and
nodemailer, sendgrid and twilio are absent from `package.json`.

An invitation is a row that *waits*. The model worked because Google asserted
the email for free.

**Why this matters:** the first instinct is that phone invitations need a
delivery channel you do not have. **They do not** — see §7.1. With OTP login,
the OTP *is* the proof of possession an invite link would have provided. This
removed the outbox worker from phase one entirely.

### 4.3 Blast radius

| Surface | Count |
|---|---|
| `userEmail` in backend source (97 files, excl. tests) | 971 |
| …of which in POS modules | 433 |
| `user_email` in SQL — all in `src/config/constants.js` | 46 |
| Tables keying on a person | 7 |
| Frontend files | 18 |
| Frontend screens displaying/collecting identity | 12 |
| Test files touching it | 29 |

**Net:** roughly a tenth is authentication. The rest is code that never asked
what identity meant and simply carried what the token held.

---

## 5. Identity model

- The identity is the **mobile number in E.164**, e.g. `+919876543210`.
- It is **globally unique per person**, not per tenant.
- One number in two tenancies is two `user_tenants` rows sharing a `user_phone`
  — structurally identical to one email in two tenancies today.
- `pos_customer` is a **separate namespace**. It is keyed `UNIQUE(Phone, TenantId)`
  (per-tenant) and is a CRM record, not an identity. **Never resolve a login
  against `pos_customer`.**

### 5.1 Tenant switching needs no work — verified

`switchTenantPermissions(req, userEmail, targetTenantId, userName)` takes the
identity string, runs `USER_TENANTS.SELECT` with it, and finds the target in the
result. It never inspects the string's shape. Rename the parameter and it is done.

Same in the UI: `Navbar.js` renders `user.associatedTenants` and calls
`switchTenant(tenantId)`. Only line 102 changes — `user.email` becomes
`user.name`, which reads better than either an address or a number.

---

## 6. Schema

All edited directly into `database/01-schema-definition.sql`.

### 6.1 `user_tenants`

```sql
user_phone        VARCHAR(20)   NOT NULL   -- was user_email VARCHAR(100)
full_name         VARCHAR(100)  NOT NULL   -- was NULL
UNIQUE KEY uk_tenant_user (tenant_id, user_phone)
INDEX      idx_user_lookup (user_phone)
```

**Why the old `phone` column is deleted:** it was a staff-profile field. It is
the identity now, and two copies of the same fact drift apart.

**Why `full_name` becomes NOT NULL:** this is the non-obvious one. An email
usually carries a name inside it — `animesh.malhotra@gmail.com` tells an admin
who they are looking at. `+919876543210` identifies nobody, and a screen full of
them is unreadable. Every admin list, the audit trail and the tenant switcher
were leaning on that. The name must be captured at invitation time.

### 6.2 `user_roles`

```sql
user_phone  VARCHAR(20)  NOT NULL   -- was user_email VARCHAR(255)
UNIQUE KEY uq_user_role_tenant (user_phone, tenant_id, role_id)
```

Mechanical, but the one place a mistake silently grants or removes access rather
than throwing.

### 6.3 `tenant_invitations`

```sql
phone       VARCHAR(20)  NOT NULL   -- already existed as staff detail; now the key
full_name   VARCHAR(100) NOT NULL
UNIQUE KEY uq_invite_live (tenant_id, phone, is_pending)
INDEX      idx_invite_claim (phone, status)
```

The `email` column drops. `phone` was already present carrying staff detail and
simply becomes the key. The `is_pending` generated-column trick (partial unique
index — one live invitation per tenant+number, unlimited closed history) survives
untouched.

### 6.4 `onboarding_requests`

```sql
phone   VARCHAR(20)  NOT NULL   -- was email VARCHAR(255)
UNIQUE KEY uq_onboarding_phone (phone)
-- google_sub dropped: nothing issues one any more
```

### 6.5 `auth_otp_challenge` — new

```sql
id               CHAR(36)     NOT NULL
phone            VARCHAR(20)  NOT NULL
purpose          ENUM('LOGIN','SIGNUP')  NOT NULL
code_hash        CHAR(64)     NOT NULL   -- sha256(code + OTP_PEPPER)
expires_at       DATETIME     NOT NULL
attempts         TINYINT      NOT NULL DEFAULT 0
consumed_at      DATETIME     NULL
wa_message_id    VARCHAR(128) NULL       -- the wamid
delivery_status  ENUM('PENDING','SENT','DELIVERED','READ','FAILED') NOT NULL DEFAULT 'PENDING'
failure_code     VARCHAR(20)  NULL       -- Meta's error code
request_ip       VARCHAR(45)  NULL
created_at       DATETIME     NOT NULL
INDEX idx_live  (phone, consumed_at, expires_at)
INDEX idx_wamid (wa_message_id)
```

**Why the code is never stored:** a database read must not be enough to sign in
as somebody. Only `sha256(code + OTP_PEPPER)` is kept, with the pepper in the
environment rather than the row.

**Why `failure_code` exists:** it turns "it never arrived" into an answer.
`131026` means the number has no WhatsApp account and no amount of resending
will fix it — a fundamentally different conversation from a wrong code.

### 6.6 Renames

```sql
audit_logs.user_phone         VARCHAR(20)   -- was user_email
  INDEX idx_audit_phone_ts (user_phone, timestamp DESC)
pos_cash_session.CashierPhone VARCHAR(20)   -- was CashierEmail, NOT NULL
```

`CashierPhone` remains a genuine lookup key — finding a cashier's open session
queries it directly, it is not merely an audit stamp.

### 6.7 The token

```js
{
  phone:            "+919876543210",   // was: email
  name:             "Priya Ramanathan",
  tid:              "<tenant id>",
  scopes:           [ … ],
  roles:            [ … ],
  onboardingStatus: "APPROVED",
  associatedTenants:[ { tenantId, isAdmin } … ],
  iss:              "…"
}
```

One claim renamed. Shape and expiry (1h; 15m for guests) unchanged, so
`authMiddleware`, `checkScope`, `auditLogger` and the setup gate all keep
working once they read the new claim name.

---

## 7. The four flows

### 7.1 Invite into an existing tenancy

1. Admin supplies number, name, branch, roles → row in `tenant_invitations`.
2. **Nothing is sent** — deliberately, exactly as today.
3. Person signs in with that number; `acceptPendingTx(conn, phone)` matches on
   `idx_invite_claim` and writes the membership in the same transaction that
   marks the invitation ACCEPTED. Idempotent, so two devices racing cannot
   double-provision.

**Why no delivery worker:** the OTP the person receives on first sign-in already
proves possession of the number. An invite link would prove the same thing, more
expensively. The admin tells them by whatever means they already use — which is
what happens today.

### 7.2 Sign in

1. `POST /api/auth/otp/request` — `{ phone }`. Normalise to E.164, consume any
   live challenge for that number (so only one code is ever valid), mint a new
   one, store its hash.
2. Send the template; store the `wamid`.
3. `POST /api/auth/otp/verify` — `{ challengeId, code }`. Constant-time compare;
   stamp `consumed_at` in the same transaction that issues the token.
4. Claim any pending invitation, then `findAndGetPermissions(phone)`.

**Why the response is uniform for unknown numbers:** same body, same timing,
whether or not the number is registered. Closes enumeration and removes the
cheapest way to run up the Meta bill. Cost: a typo'd number waits out the
countdown.

### 7.3 New business signs up

Number and name → OTP (`purpose='SIGNUP'`) → `onboarding_requests` → approval.

**Why OTP before the row is written:** otherwise the approval queue fills with
numbers nobody controls.

**Accepted cost:** a Google account was a weak but real barrier. Anyone with a
SIM can now start this, and every attempt spends money before a human looks at
it. This is why the daily cap belongs on this route specifically.

### 7.4 Switch tenancy

No design change. See §5.1.

---

## 8. WhatsApp integration

### 8.1 Endpoints called

**Required:**

| Purpose | Call |
|---|---|
| Send OTP | `POST https://graph.facebook.com/{VER}/{PHONE_NUMBER_ID}/messages` |
| Webhook | `GET`/`POST /api/webhooks/whatsapp` |

**Operational (day one):**

| Purpose | Call |
|---|---|
| Template health | `GET /{WABA_ID}/message_templates?name=login_otp` |
| Number quality | `GET /{PHONE_NUMBER_ID}?fields=quality_rating,verified_name,throughput` |

The two operational calls are not optional extras. With Google retired, a
paused template or a quality rating falling to RED is an early warning of a
**total login outage**. Alert on the transition, not on the failure.

### 8.2 Send payload — the shape that bites

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "919876543210",
  "type": "template",
  "template": {
    "name": "login_otp",
    "language": { "code": "en_US" },
    "components": [
      { "type": "body",
        "parameters": [ { "type": "text", "parameter_name": "code", "text": "483920" } ] },
      { "type": "button", "sub_type": "url", "index": "0",
        "parameters": [ { "type": "text", "text": "483920" } ] }
    ]
  }
}
```

**The code appears twice** — body and button. The button copy is what lands on
the clipboard. Sending only the body returns a parameter error, not a helpful one.

**A 200 means Meta accepted it, not that it arrived.** Delivery is asynchronous.
Never treat the send response as proof the person can receive the code.

Response carries `messages[0].id` — the `wamid`. Store it; it is the only handle
joining a send to the delivery receipt.

### 8.3 Error codes needing distinct handling

| Code | Meaning | Handling |
|---|---|---|
| `131026` | Undeliverable — usually no WhatsApp account | Terminal. Tell the user; do not offer resend |
| `132000` | Parameter count mismatch | Almost always the missing button parameter |
| `132001` | Template/language not found | `en` is not `en_US` |
| `133010` | Phone number not registered | Configuration failure — page someone |
| `190` | Token invalid/expired | System User tokens do not expire → revoked. Login is down; alert loudly |
| `80007`, `130429` | Meta rate limit | Back off; surface as temporary, not "wrong code" |

**Everything except `131026` is an infrastructure failure** and must never be
reported to the user as a wrong number.

### 8.4 Webhook

`GET` answers the subscription challenge by echoing `hub.challenge` as **plain
text** (not JSON) when `hub.verify_token` matches.

`POST` carries delivery receipts. Verify `X-Hub-Signature-256` as an HMAC over
the **raw** body keyed with `WA_APP_SECRET` — reuse the pattern already in
`poswebhook.auth.js` rather than writing a second one.

**Answer 200 immediately, process afterwards.** Meta retries anything slow or
non-200, and a retry storm against a struggling endpoint makes an outage worse.

**The webhook never grants a session.** It is observability, not authentication.

### 8.5 Configuration — all externalised

```bash
# WhatsApp Cloud API
WA_GRAPH_VERSION=v21.0            # pinned: Meta deprecates versions on a clock
WA_PHONE_NUMBER_ID=
WA_BUSINESS_ACCOUNT_ID=
WA_ACCESS_TOKEN=                  # System User token — SECRET, never expires
WA_APP_SECRET=                    # webhook signatures — SECRET
WA_WEBHOOK_VERIFY_TOKEN=          # your own random string

# OTP template
WA_TEMPLATE_OTP_NAME=login_otp
WA_TEMPLATE_OTP_LANG=en_US        # must match the template EXACTLY

# OTP behaviour
OTP_PEPPER=                       # SECRET
OTP_TTL_SECONDS=300               # keep in step with the template's expiry line
OTP_MAX_ATTEMPTS=5
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_MAX_PER_PHONE_15M=3
OTP_MAX_PER_IP_15M=10
OTP_DAILY_SEND_CAP=500            # cost circuit breaker — applies in ALL envs
```

Read in a `WHATSAPP` block in `src/config/config.js`, beside the existing `JWT`
and `RATE_LIMIT` sections. **Secrets get no default** — a missing one must stop
the server at boot with a clear message, not fail on the first person signing in
during a dinner rush.

**Only `whatsapp.client` reads the token.** One place it can leak from.

**No WhatsApp value ever gets a `REACT_APP_` prefix** — that compiles into the
browser bundle and is readable by anyone.

### 8.6 Not called, deliberately

No Embedded Signup, no Business Management API, no per-tenant WABAs. One number
sends every OTP platform-wide, keeping the integration to a single token and a
single webhook. Tenants bringing their own number is a different product
(Tech Provider status, App Review); nothing here forecloses it.

---

## 9. Security decisions

### 9.1 OTP handling

- Code from `crypto.randomInt(100000, 1000000)` — **never `Math.random`**, which
  is predictable from prior outputs.
- Compared with `crypto.timingSafeEqual`.
- Stored as `sha256(code + OTP_PEPPER)`; pepper in env, not in the row.
- Single-use: `consumed_at` stamped in the same transaction that issues the token,
  so concurrent verifies cannot both succeed.
- Five attempts, then the challenge is burned. Six digits against five tries is
  a 1-in-200,000 guess.
- A new request consumes any live challenge for that number.

### 9.2 Rate limits — three layers plus a ceiling

| Limit | Value | Purpose |
|---|---|---|
| Per number | 3 / 15 min | Stops one number being flooded with codes |
| Per IP | 10 / 15 min | Catches a script walking a number range |
| Per challenge | 5 attempts | Brute force |
| Daily cap | `OTP_DAILY_SEND_CAP` | **Cost circuit breaker** |

The existing `authLimiter` skips entirely when `NODE_ENV=development`. **The
daily cap must not**: development sends real messages and spends real money.

### 9.3 Recycled numbers — the residual risk with no clean fix

Indian operators reissue disconnected numbers. As the **primary identity key**
this means a stranger can inherit a membership with its roles and history.

This was the strongest argument against option A and it survives the
existing-data decision. Required mitigations:

- **Offboarding must deactivate the membership** (`is_active = 0` /
  `status = 'SUSPENDED'`), not merely stop inviting them.
- **Dormant memberships should lapse** — a number unused for a long stretch
  requires re-verification.
- These are process, not code, and they must be written into the offboarding
  runbook or the risk is unmitigated in practice.

### 9.4 What is *not* a risk in this model

The privilege-escalation path flagged during the credential-overlay design
(option B) **does not exist here**. There, a tenant admin could write another
person's identity onto a membership alongside their own phone. Here, possession
of the number is proven by OTP at every login, so an admin inviting an arbitrary
number gains nothing — only the holder of that handset can sign in.

Residual nuisance: an admin can enrol an unwitting person into their tenancy.
On first sign-in that person sees the tenancies they belong to. Minor; noted.

### 9.5 Single point of failure — accepted, and answered

With Google retired, every login depends on one Meta account staying in good
standing. A template rejection, policy strike, billing failure or WABA
suspension stops all access at every branch at once.

This was raised twice and accepted by the owner. The design answers it:

**Break-glass:** a server-side command minting a 15-minute super-admin token —
`npm run admin:token -- --phone +91…` — usable only by someone with shell access
to the host. Routes through no third party, needs no network.

**It ships in phase 1, and must be exercised successfully before the Google
route is deleted in phase 4.** That deletion is the point of no return.

### 9.6 Logging discipline

`validateGoogleToken()` currently writes the signing-in user's address to the
log at info level. Survivable for an email; carried into this design it means
every phone number, and potentially every OTP, in plaintext logs.

Three rules for the new module:

1. **Never log the code** — at any level, including development.
2. **Mask numbers** in application logs: `+9198••••3210`.
3. **Never log the token or app secret**, including inside error objects — an
   axios error serialises request headers by default, which is exactly how
   bearer tokens reach log aggregators.

---

## 10. The rename

Order matters: schema first, then the queries touching it, then callers outward.
Each step leaves the suite failing in a way that points at the next.

```
1  database/01-schema-definition.sql   columns, keys, indexes
2  src/config/constants.js             the 46 SQL statements
3  auth + invitation + onboarding      identity resolution
4  middleware                          authMiddleware, auditLogger
5  admin + user                        management backends
6  POS modules                         the 433, once nothing above is red
7  frontend                            services, context, then screens
```

### 10.1 Four traps a blind find-and-replace falls into

1. **Not every "email" is an identity.** `pos_customer.Email` is a *customer
   contact address* and stays. So does everything in `contactdetail`. This is the
   mistake most likely to survive review — it compiles, and the tests that would
   catch it may not exist.
2. **Column widths change.** `VARCHAR(255)` → `VARCHAR(20)`. Fixtures, validation
   schemas and seed scripts need looking at, not substituting.
3. **Validation must actually change.** Joi/Yup schemas assert email format.
   Renaming the field while leaving `.email()` produces a validator rejecting
   every real input, with an error message about an address that no longer exists.
4. **Case-insensitive comparison stops being right.** `normalizeEmail()`
   lower-cases; phone needs E.164 normalisation — a different operation with
   different failure modes.

### 10.2 The one function everything rests on

`toE164(input, defaultCountry = 'IN')`. All of these must collapse to
`+919876543210`:

```
9876543210      09876543210     +91 98765 43210
+91-98765-43210 0091 9876543210 " +919876543210 "
```

**Why it matters more than anything else in the change:** if two spellings of the
same number normalise differently, they become two accounts with two sets of
roles, and nobody notices until permissions look wrong. Small, pure, and tested
harder than anything else here.

---

## 11. Build order and status

| Phase | Contents | Status |
|---|---|---|
| **0** | Meta side: verification, `login_otp` APPROVED, number registered, System User token | ⬜ Not started |
| **1** | `utils/phone.js`, `utils/otp.js`, `WHATSAPP`/`OTP` config blocks, break-glass command | ✅ **Done** — 2026-09-05 |
| **2** | `whatsapp.client.js`, webhook route, boot-time template check | ✅ **Done** — 2026-09-05 |
| **3a** | Schema redefinition — `database/*.sql` | ✅ **Done** — 2026-09-05 |
| **3b** | The code rename (§10) | ✅ **Done** — 2026-09-05 |
| **4** | OTP auth routes; delete `POST /api/auth/google` and `validateGoogleToken` | ✅ **Done** — 2026-09-05 |
| **5** | Frontend: two-step login, invite screen, name-first lists, drop `@react-oauth/google` | ✅ **Done** — 2026-09-05 |
| **6** | Cutover: env vars, DB rebuild, seed the first super-admin number | ⬜ Not started |

Baseline to hold throughout, both measured 2026-09-05 after phase 1 landed:

| Suite | Tests | Suites |
|---|---|---|
| Backend | **4,177** | 103 |
| Frontend | **951** | 57 |

Phase 1 contributed 65 backend tests (41 `phone.js`, 24 `otp.js`) and touched no
frontend code, so the pre-phase-1 figures were 4,097 / 100 and 951 / 57. The
"947 frontend / 4,079 backend / 98 suites" quoted during planning was stale on
both counts — re-measure rather than trusting a remembered number.

### 11.1 Sequencing rules

- **Phase 2 before phase 3.** Prove WhatsApp against a real handset before the
  identity key moves. It is the only part depending on someone else's system.
- **Do not start phase 4 on a test number.** Five whitelisted recipients will not
  surface the failures that matter.
- **Break-glass exercised before the Google route is deleted.**
- **Seed the super-admin number first in phase 6**, and confirm that number
  receives WhatsApp. It provisions every other account and there is no longer a
  Google door if it fails.

---

### 11.2 The database is exactly two files

`database/` holds `01-schema-definition.sql` then `02-seed-data.sql`, and
nothing else. The old `03-owner-operator-role.sql` is merged in as PART 9 of the
seed. There is no migration directory and no third file: schema changes are made
in place and a rebuild is a drop-and-recreate.

```
mysql -u <user> -p <db> < database/01-schema-definition.sql
mysql -u <user> -p <db> < database/02-seed-data.sql
```

**Edit `@super_admin_phone` at the top of the seed before running it.** It is
the only way into a fresh database — there is no Google fallback and no other
account exists to provision one. Seed a number you cannot receive WhatsApp on
and the only way in is `npm run admin:token`.

### 11.5 Where configuration lives

| File | Status |
|---|---|
| `backend/.env.example` | Rewritten — Google block gone, WhatsApp + OTP documented with where each value comes from |
| `backend/.env` | `GOOGLE_CLIENT_ID` removed; WhatsApp keys added as empty placeholders |
| `tenant-auth-ui/.env.example` | Google block replaced with a note that the browser holds no auth credential; `AUTH_LOGIN` override replaced by the two OTP endpoints |
| `tenant-auth-ui/.env` | `REACT_APP_GOOGLE_CLIENT_ID` removed |

`GOOGLE_CLIENT_ID` was also still being imported in `auth.service.js` and
declared in `envConfig.js` after `validateGoogleToken` was deleted — dead in
both places, now removed.

**The frontend needs no WhatsApp configuration at all.** The OTP is sent
server-side, so the browser holds no third-party credential. Anything prefixed
`REACT_APP_` is compiled into the bundle and readable by anyone, which is
exactly where a WhatsApp token must never be.

### 11.6 Post-migration audit — 2026-09-05

Triggered by a 500 on `GET /api/admin/users`. Six defects found, all of the same
shape: code still referring to something the migration removed or renamed.

| # | Defect | Impact |
|---|---|---|
| 1 | `ADMIN_USERS.SELECT_ALL` and `SELECT_BY_TENANT` selected `ut.phone` | 500 on Access Control |
| 2 | `TenantUsersPanel` had an editable phone profile field | Saving a profile would fail |
| 3 | `tokenUtils.getUserFromToken` returned `email: payload.email` | `undefined` on every token |
| 4 | `CashSessions.js` read `s.CashierEmail` | Blank cashier column |
| 5 | **Logger redaction disabled ALL application logging** | Every 500 silent |
| 6 | **Break-glass token signed `email:`** | Reads worked, every write failed |

**#5 was mine, introduced in phase 3b.** `winston.format((info) => maskNumbers(info))`
rebuilt the info object with `Object.entries`, which does not copy symbols —
and winston carries the level and rendered message on `Symbol.for('level')` and
`Symbol.for('message')`. A rebuilt object loses them and the transport prints
nothing. Every log line in the application had been silently dropped since, and
it hid #6 for an afternoon. The format now mutates `info` in place.

**#6 is the one worth remembering.** `scripts/admin-token.js` was written in
phase 1 with a comment saying the claim "becomes a phone number at phase 3" —
and phase 3 never came back to it. The token authenticated fine and every read
worked, because reads only need `tid` and `scopes`. Writes all failed, because
`CreatedBy`, the audit actor and `invitedBy` resolved to `undefined` and mysql2
refuses undefined bind parameters. A GET-only sweep cannot find this.

Sweeps run, all clean afterwards:

| Check | Scope | Result |
|---|---|---|
| Every SELECT prepared against the live schema | 375 | 0 unknown columns |
| Every INSERT/UPDATE/DELETE prepared | 334 | 0 unknown columns |
| Query call sites, parameter count vs `?` count | 189 | 0 mismatches |
| Concrete GET routes hit with a real token | 97 | 0 responses ≥ 500 |
| Inline SQL outside `constants.js` | 1 | unaffected table |

**A caution about the parameter-count check:** its first version reported 92
mismatches, every one off by exactly one. That uniformity was the tell — the
checker was counting a trailing comma in the argument array as an extra
argument. Corrected, it reports zero. Worth recording because a tool that
confidently reports 92 defects is more dangerous than one that reports none.

### 11.7 Defect 7 — the membership insert had no name

Symptom: a fresh number signing in landed on `/onboarding` ("under review")
instead of joining the tenancy that invited it, or receiving its own.

Cause: `ADMIN_USERS.INSERT_USER_TENANT_FLAGS` wrote a `user_tenants` row without
`full_name`. §6.1 made that column NOT NULL with no default, so **every
membership insert failed** — `Field 'full_name' doesn't have a default value`.

One root cause, two visible failures:

- `acceptPendingTx` threw, so an invitation was never claimed. It is wrapped in
  a `try/catch` that logs and continues by design — a failed claim must not cost
  someone their login — so the sign-in proceeded to the unknown-user branch.
- `autoApproveOnboarding` hit the same insert, failed, and fell back to the
  manual PENDING flow. Which is also by design.

Both degradations worked exactly as intended. They just degraded around a defect
instead of an outage, and **defect 5 meant neither logged anything visible.**
This is what a silent logger costs: two deliberate safety nets turned a hard
failure into a plausible-looking wrong answer.

Fix: the query carries `full_name`, and all three callers supply one —
`invite.full_name` on the claim, the onboarding request's `name` on both manual
and automatic approval, each falling back to the number. A poor label beats a
refused login.

Verified after the fix: the invitation claim creates the membership with the
invited name and its POS_CASHIER role and marks the invitation ACCEPTED; a fresh
number resolves to `APPROVED` with a new tenancy, 30 scopes and
`setupCompleted: false`, which is what routes it to the setup wizard.

## 12. Open questions

| # | Question | Cheap until |
|---|---|---|
| 1 | JWT claim named `phone`, or neutral `sub`? Currently `phone`. See §3. | Phase 4 |
| 2 | Does offboarding have a written runbook that will actually deactivate memberships? §9.3 is unmitigated without it. | Before go-live |

---

### 11.3 Current state — the backend is complete; tests are behind

Phases 0-4 are in. `POST /api/auth/otp/request` and `/verify` work end to end;
Google is gone from the source entirely.

**Both suites are deliberately stale**, on an explicit instruction to do the
feature work first:

| | Passing | Failing suites | Why |
|---|---|---|---|
| Backend | 2,944 | 4 | They exercise `validateGoogleToken`, now deleted |
| Frontend | 901 | 6 | They mock `@react-oauth/google` and drive a Google button |

Neither is a discovered problem; both builds compile and the feature works end
to end. Rewriting those ten suites is the first task of the next session.

Still outstanding: **phase 6, the cutover** — which is yours, not mine: set the
environment variables, rebuild the database, and sign in.

### 11.4 Superseded — the gap that existed between phases 3 and 4

Phases 1 and 3 are in; phases 2 and 4 are not. That leaves a deliberate gap:

- The schema, every query and every identifier speak phone.
- `validateGoogleToken()` still returns `{ email, … }`, but
  `findAndGetPermissions()` now destructures `{ phone, … }`. **Google sign-in is
  therefore broken**, which is correct — it is being deleted in phase 4.
- The OTP routes that replace it do not exist yet.

So the API will start and the suite is green, but nobody can sign in through the
front door until phase 4 lands. `npm run admin:token` is the only way in
meanwhile, which is precisely the situation the break-glass tool was built for.

## 13. Decision log

Append here as implementation proceeds. Newest last.

### 2026-09-05 — Design agreed

- Option A chosen over B and C. Owner's call after full audit; alternatives
  documented in §3 rather than discarded.
- Existing data to be discarded. This is what makes A tractable — see §2.
- Google sign-in retired entirely. SPOF accepted (§9.5), break-glass required
  in phase 1 as the answer.
- Invitations stay claim-on-login with no delivery worker (§7.1) — the OTP
  already proves possession.
- `full_name` becomes NOT NULL (§6.1) — a phone number identifies nobody in a
  list, and 12 screens depended on the email carrying a name.
- JWT claim left as `phone`; neutral-`sub` hedge offered and not taken (§3).

### 2026-09-05 — Phase 1 landed

Shipped, all pure or read-only; nothing user-facing changed.

- `src/utils/phone.js` — `toE164`, `isE164`, `formatForDisplay`, `maskForLog`.
- `src/utils/otp.js` — `generateCode`, `hashCode`, `verifyCode`, `expiryFrom`.
- `src/config/config.js` — `WHATSAPP` and `OTP` blocks; secrets deliberately
  have no defaults.
- `scripts/admin-token.js` + `npm run admin:token` — break-glass.
- 65 new tests. Full backend suite green at 4,162 / 102.

Decisions made while building, not in the original design:

- **`toE164` rejects any input containing a letter** rather than stripping it.
  Found while exercising the function: `'98765 4321a0'` was silently becoming a
  valid number. Punctuation and whitespace are formatting; a letter is a typo,
  and silently cleaning one mints an identity the user never typed. Brackets,
  dots, dashes and spaces are still stripped.
- **Ten digits opening `91` are treated as national, not as a country code.**
  `9198765432` is a valid subscriber number. The check tests length before
  prefix, so a real user is not misread into a different identity.
- **Foreign numbers pass through if already E.164.** No numbering plan on hand
  to validate them; refusing a valid foreign number is worse than accepting one
  we cannot fully check. Indian rules apply only to Indian national formats.
- **The code is generated and compared as a string throughout.**
  `Number('012345')` would discard a leading zero and the user's code would stop
  matching what they were sent.
- **`getScopesForTenant` was exported from `auth.service.js`** so the break-glass
  tool reuses the canonical scope resolution instead of duplicating it. It is
  read-only; `findAndGetPermissions` was deliberately NOT reused because it
  claims invitations and can insert onboarding requests — side effects an
  emergency tool must not have on a mistyped identity.
- **Break-glass writes an audit row at WARN on every run.** Emergency access
  that leaves no trace is how an incident becomes an unanswerable question.
- **It refuses `--minutes` above 60**, refuses to run without `JWT_SECRET`, and
  grants nothing that does not already exist — an identity with no membership
  gets no token.
- The flag is `--identity`, not `--email` or `--phone`, so it does not need
  renaming when the schema does at phase 3.

Verified end-to-end against the live dev database: an identity belonging to two
tenancies resolved both, `--tenant` selected between them correctly (3 scopes as
a member, 30 as that tenancy's admin), a non-member tenancy was refused, and the
audit rows were written.

### 2026-09-05 — Phase 3a: the schema

`database/` reduced from three files to two, and the schema moved to phone
identity. Verified by building a throwaway database from both files and
inspecting the result — not by reading the diff.

Schema changes (15 edits to `01`, plus one new table):

- `user_tenants.user_email` → `user_phone VARCHAR(20)`; keys and `idx_user_lookup`
  follow. `full_name` is now NOT NULL. The old staff-profile `phone` column is
  **deleted** — it is the identity now, and two copies of one fact drift apart.
- `user_roles.user_email` → `user_phone`; `uq_user_role_tenant` follows.
- `tenant_invitations`: `email` dropped, the existing `phone` becomes the key,
  `full_name` NOT NULL, both indexes follow.
- `onboarding_requests`: `email` → `phone`, `google_sub` dropped.
- `audit_logs.user_email` → `user_phone`; index renamed `idx_audit_phone_ts`.
- `pos_cash_session.CashierEmail` → `CashierPhone`.
- `auth_otp_challenge` added to SECTION 1, with the DROP alongside the others.
- `features.scope` already carried APPROVE; no change needed.

Seed changes:

- Identity now sits in three variables at the top — `@super_admin_phone`,
  `@super_admin_name`, `@tenant_id` — so a fresh install has exactly one place
  to edit rather than five scattered literals. Placeholder is `+919999999999`
  under a banner that says to change it.
- PART 1 supplies `full_name`, now that the column is NOT NULL.
- `03-owner-operator-role.sql` merged verbatim as PART 9 and deleted. The merge
  was diffed statement-for-statement before removing the original.

**A bug the rebuild test caught that reading would not have:** MySQL user
variables take the *client's* collation, and mysql2 connects as
`utf8mb4_unicode_ci` while the tables take the server default
(`utf8mb4_0900_ai_ci` on 8.x). Every `WHERE col = @var` raised "Illegal mix of
collations". Fixed with `SET NAMES utf8mb4;` at the top of both files —
deliberately with no explicit COLLATE, since naming one would pin a collation
that differs between 5.7 and 8.x and reintroduce the same mismatch.

Verified on a fresh build: super admin seeded with number and name, SUPER_ADMIN
role assigned, 12 roles present including OWNER_OPERATOR with its 28 grants, all
eight identity columns `VARCHAR(20)`, and zero `user_email` / `CashierEmail` /
`google_sub` columns remaining. `pos_customer.Phone` was correctly left alone —
it is a customer contact detail, not an identity, and is the trap §10.1 warns
about.

**The application code does not match this schema yet.** Phase 3b is the code
rename; until it lands the API will not start against a rebuilt database.

### 2026-09-05 — Phase 3b: the code rename

Green at **4,177 tests / 103 suites**. Renames applied, each verified by the
suite rather than by reading:

| Change | Count |
|---|---|
| `userEmail` / `user_email` / `CashierEmail` identifiers | 1,139 across 112 files |
| `req.user.email` → `req.user.phone` | 75 across 36 files |
| destructured `const { email } = req.user` and its uses | 256 across 30 files |
| `email` below `validateGoogleToken` in `auth.service` | 22 |
| SQL statements in `constants.js` | 52 |

Decisions made while doing it:

- **The destructure was the trap, not the literal.** The first pass renamed
  `req.user.email` and looked complete; 30 controllers were destructuring
  `const { tid: tenantId, email } = req.user` and kept compiling, failing only
  at runtime with "Invalid parameters: contains undefined values". Every one was
  checked for a non-actor use of `email` before renaming — there were none.
- **Redaction moved into the logger, not the call sites.** Renaming the
  destructure meant 256 log calls would start writing full numbers at info
  level. Masking at each site needs an import in 30 files and a rule everyone
  remembers; a `winston.format` step covers all of them and anything added
  later. `maskNumbers` is exported so the security property has its own test.
- **`utils/phoneSchema.js` added.** Four Joi schemas still asserted `.email()`,
  including one on a field my own rename had turned into `CashierPhone` — the
  exact §10.1 trap. One shared `phoneField()` rule, which *normalises* as part
  of validating so a value cannot pass validation and then miss every lookup.
- **`captureAudit`'s actor parameter renamed.** It was already being handed a
  number; only the parameter name lied.
- **Test fixtures were unified per file, not per occurrence.** A first pass gave
  each `email:` literal its own number, which broke every test where a fixture
  and its expectation had to be the same person. Identity constants
  (`USER_EMAIL` → `USER_PHONE`) were renamed across 33 test files so no fixture
  claims to be an address.

Deliberately left alone, and correct: `pos_customer.Email`, `contactdetail`, and
every `data.Email` on a customer record. Those are contact details, not
identities.

**Pre-existing bug found, not introduced and not fixed:** `swagger.js` declares
`'/api/admin/users/{phone}'` twice (lines 4310 and 4751). JS keeps the last
literal, so the `delete` operation documented in the first block has been
invisible in the API docs since before this migration. Verified against `HEAD`.
`npm run lint` reports it as the only error. Merging the two blocks is a real
fix but unrelated to identity, so it is left for a decision rather than folded
in here.

### 2026-09-05 — Phases 2 and 4: WhatsApp transport and OTP sign-in

Shipped: `whatsapp.client.js`, `whatsapp.webhook.controller.js`,
`whatsapp.routes.js`, `whatsapp.health.js`, `auth/otp.service.js`, a rewritten
`auth.controller.js` and `auth.routes.js`, 12 `AUTH_OTP` queries, 8 user-facing
OTP messages. `validateGoogleToken` and every `googleSub` reference deleted.

Verified end to end against a throwaway database built from the two SQL files —
server booted, real HTTP requests, tokens decoded:

| Check | Result |
|---|---|
| Webhook subscription, correct token | `CHALLENGE123`, 200, plain text |
| Webhook subscription, wrong token | 403 |
| Webhook POST, valid HMAC | 200 |
| Webhook POST, forged / absent HMAC | 401 |
| OTP request, malformed number | 400 with a readable message |
| OTP request, unknown number | 200, challenge recorded, **nothing sent** |
| OTP verify, wrong code | 400 |
| OTP verify, correct code | 200 + JWT carrying `phone` and 31 scopes |
| OTP verify, replay | 410 — single-use holds |
| OTP-issued token on `/api/uom` | 200 |
| No token | 401 |
| Audit trail actor | the number |

**Three bugs found by running it that reading would not have caught:**

1. **The global body parser silently disabled every webhook signature.**
   `server.js` had `app.use(express.json())` before the routers. A second
   `express.json({ verify })` sees `req._body` already set and short-circuits,
   so `req.rawBody` is never populated — proved with a five-line Express
   harness. This affects the **pre-existing portal webhook too**, which reads
   the same field. It fails closed there (`if (!raw) return false`), so it is a
   rejects-everything bug rather than a hole, but it is still a bug. Fixed by
   scoping the global parser to skip `/api/webhooks/` and
   `/api/pos/portal-webhooks`, so each webhook router parses its own body.

2. **The boot failure was silent.** `whatsapp.health` called `logger.error` then
   `process.exit(1)`. Winston's console transport writes asynchronously and the
   exit tore the process down first — exit code 1, empty log. A fail-loud check
   that fails silently is worse than none, so the fatal message now goes
   straight to `process.stderr.write`.

3. **A duplicate Joi key disabled phone validation entirely.**
   `invitation.schemas.js` ended up with `phone` declared twice: my renamed
   identity field, and the old staff-profile one beside it. Joi keeps the LAST
   definition, so `phoneField()` was silently replaced by a plain
   `Joi.string().max(20)` — invitations would have stored un-normalised numbers
   and every claim-at-login lookup would have missed. Found via the `no-dupe-keys`
   lint error, which is the argument for keeping lint clean.

Design decisions made while building:

- **The client returns results, never exceptions, for anything Meta says.** A
  failed send is an ordinary outcome with several distinct meanings — no
  WhatsApp account, paused template, rate limit — and throwing collapses them
  into one. Only missing configuration throws.
- **`131026` is the only user-facing send failure.** Everything else is
  infrastructure and must not reach someone as "wrong number".
- **The boot check is strict in production only.** A developer without Meta
  credentials still needs a server; `npm run admin:token` is how they get in.
- **The token's `name` comes from the membership, not the request.**
  `USER_TENANTS.SELECT` now carries `full_name`. Without this the navbar showed
  a phone number where a name belongs — the §6.1 problem, live.
- **`fullName` is required on an invitation.** `user_tenants.full_name` is
  NOT NULL; allowing null in Joi just moves the failure to the INSERT.
- **The webhook answers 200 before processing, and never grants anything.**

### 2026-09-05 — Phase 5: the front end

`@react-oauth/google` removed from `package.json`, `GoogleOAuthProvider` from
`App.js`, `REACT_APP_GOOGLE_CLIENT_ID` from `.env` and `config.js`. The browser
now holds no third-party auth credential at all — the OTP is sent server-side.

Shipped: `utils/phone.js`, a two-step `Login.js`, new controls in `login.css`,
`authService` rewritten around `requestOtp`/`verifyOtp`, `AuthContext.login`
now spending a code, `InvitePanel` rebuilt around a number, and name-first
identity on eight screens.

Decisions:

- **One code input, not six boxes.** The canvas drew six. WhatsApp's
  Authentication template carries a native *Copy code* button, so the common
  interaction is a PASTE — which a single field plus
  `autoComplete="one-time-code"` handles natively, and six boxes would need
  hand-written paste, focus and backspace behaviour to match. The field is
  styled to read as segmented.
- **`digitsOnly` strips country codes before truncating.** People paste whole
  numbers from a contact card or a chat. Slicing blindly turned
  `+91 98765 43210` into `98765 43210`'s neighbour `91987 65432` — a different
  number that still looks plausible. Length is tested before prefix so a
  genuine ten-digit number opening `91` survives.
- **The browser never normalises for storage.** `utils/phone.js` formats and
  keeps the field pleasant; the server's `toE164` remains the only authority.
  Two implementations of "the same number" is how a client and a server end up
  disagreeing about who somebody is.
- **The dial code is fixed text, not a picker.** India-only today, and a select
  implying otherwise would be a promise the backend does not keep.
- **16px on the inputs, not 15.** iOS Safari zooms the page for anything
  smaller, so on a tablet till the layout jumps every time a field is tapped.
- **A 410 or 429 on verify sends the user back to step one** rather than
  leaving them typing into a challenge that can no longer be spent.
- **`fullName` is required on the invite form**, matching the NOT NULL column
  and the reason for it.

Pre-existing warnings confirmed against `HEAD` and left alone: `ProtectedRoute`
in `App.js` and `getUserFromToken` in `AuthContext.js` were both already
imported-but-unused. `CI=1` still fails the build on the project's existing
warning set; `CI=false` compiles clean, which is what `vercel.json` uses.


