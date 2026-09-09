# Local Development Guide

Rebuilding the database, and running the whole application locally **with no
internet and no WhatsApp spend**.

Sign-in is WhatsApp one-time codes and nothing else, and every code is a billed
authentication conversation. Without the setup below, testing a login flow costs
real money and needs a working connection to Meta — which makes the application
unusable on a train.

- **Backend** `http://localhost:3001` (`PORT` in `.env`)
- **Frontend** `http://localhost:3000`
- **Mock Graph API** `http://localhost:4000` (local only, see §2)

---

## 1. Rebuilding the database

```bash
npm run db:reset -- --yes
```

Drops the database named by `DB_NAME`, recreates it, and applies
`database/01-schema-definition.sql` then `02-seed-data.sql` in that order — the
exact sequence `01`'s own header documents. Ends with a schema check, so you
know the files match the code rather than assuming it.

Expected:

```
Target: root@localhost:3306/masterdatabase

Dropping "masterdatabase" … ok
Creating "masterdatabase" … ok
Applying database/01-schema-definition.sql … ok
Applying database/02-seed-data.sql … ok

"masterdatabase" rebuilt — 91 tables.
Schema check passed. Log in with the seeded number to run first-time setup.
```

**The `--` is required.** `npm run db:reset --yes` is swallowed by npm and the
script refuses — that is the guard working, not a failure. To see what it would
do without touching anything, leave the flag off entirely.

### Why it drops the DATABASE, not just the tables

`01-schema-definition.sql` drops the tables it knows about. It cannot drop what
it has never heard of — a table from an abandoned branch, a view added by hand,
a leftover from a rename. Those survive a table-level reset and then serve stale
data or hold a foreign key that blocks the next rebuild.

### Guards

| Guard | Behaviour |
|---|---|
| No `--yes` | Prints what it would destroy and exits |
| `NODE_ENV=production` | Refuses outright |
| `DB_NAME` not a plain identifier | Refuses — the name is interpolated into DDL, where a placeholder is not legal |

### Targeting a different database

```bash
DB_NAME=scratchdb npm run db:reset -- --yes
```

Useful for trying something destructive without touching your working data.

### Back up first, if you care about what is in there

```bash
mysqldump -u root -p masterdatabase > ~/masterdatabase-backup-$(date +%F).sql
```

`mysqldump` ships with the MySQL server, so you have it even if the `mysql`
client is not on your `PATH`.

---

## 2. Running with no internet

### 2.1 One-time setup

Add to your **local `.env` only**:

```
WA_GRAPH_BASE_URL=http://localhost:4000
```

**Never set this on a deployed environment.** `config.js` ignores it whenever
`NODE_ENV=production`, so a copied `.env` cannot redirect the channel that
carries every login code — but leaving it out of deployed config is still the
first line of defence.

### 2.2 Every session — two terminals

```bash
# Terminal 1 — the stand-in Graph API
npm run mock:graph

# Terminal 2 — the application
node server.js
```

Boot should report the mock answering, not Meta:

```
info: OTP template confirmed APPROVED   {"template":"login_otp"}
info: WhatsApp number health            {"name":"Local Mock Number","quality":"GREEN"}
```

`Local Mock Number` is how you know the redirect took effect.

### 2.3 Signing in

Log in normally at `http://localhost:3000/login`. The code prints in terminal 1:

```
  ┌──────────────────────────────────┐
  │  to    +918861268683
  │  CODE  994716
  └──────────────────────────────────┘
```

The seeded super admin is **`+918861268683`** — set in `02-seed-data.sql` PART 1.
On a freshly reset database it has no organisation or branch, so it lands in the
first-time setup wizard.

### 2.4 What the mock is, and is not

It answers the three endpoints `whatsapp.client.js` calls, in the shapes it
parses. It is **not a bypass**: the application's send path is untouched — real
HTTP, real `AbortSignal` timeout, real Meta error parsing. Nothing in `src/`
branches on `NODE_ENV` to skip a send. The only difference is *where* the
request goes.

### 2.5 Testing failure paths

```bash
MOCK_GRAPH_FAIL=131026 npm run mock:graph
```

Sends are then refused with that Meta error code. `131026` is "this number has
no WhatsApp account", which the OTP service turns into a 400 rather than a
retryable 502. These branches otherwise only ever run in production.

---

## 3. Signing in without the login screen

For when you only need to *be* logged in — and the one path that works with no
internet **and** no mock running, since it touches nothing but MySQL:

```bash
npm run admin:token -- --identity +918861268683 --minutes 60
```

Then in the browser on `http://localhost:3000`: DevTools → **Application** →
**Cookies** → add a cookie named **`app_token`** with the `eyJ...` value, and
refresh.

**60 minutes is the hard cap** — the script refuses more. Break-glass access is
meant to be short, and that token carries every scope the holder has. Re-run it
and replace the cookie when it expires.

It never creates or elevates anything: it reads existing memberships and signs
what is already true, so a number with no membership gets no token.

---

## 4. Creating a tenant admin locally

A brand-new number gets **no code** unless self-signup is on — `shouldSend` in
`otp.service.js` requires a known number, `purpose: SIGNUP`, or the
auto-approval flag. The login screen never sends `SIGNUP`, so the flag is the
route.

**Step 1 — turn on self-signup** as the super admin, from
Application Configuration, or directly:

```bash
TOKEN=$(npm run admin:token -- --identity +918861268683 --minutes 60 2>/dev/null \
  | grep -oE '^eyJ[A-Za-z0-9._-]+$' | head -1)

curl -X PATCH http://localhost:3001/api/admin/app-config \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"autoApproveOnboarding":true}'
```

**Step 2 — sign up.** Enter any new number at `/login`, read the code from the
mock's terminal, and submit. The number is provisioned into a brand-new tenant
as its `TENANT_ADMIN`, and lands in the setup wizard.

**Step 3 — turn it back off** when you are done, unless you want every number
that reaches your machine to create a tenancy:

```bash
curl -X PATCH http://localhost:3001/api/admin/app-config \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"autoApproveOnboarding":false}'
```

> **Known issue.** A *retried* signup for the same number creates another new
> tenant and moves the user into it, rather than reusing the first. Not fixed as
> of 9 Sep 2026.

---

## 5. Useful environment overrides

All read from `.env`; none are needed for a normal session.

| Variable | Default | Why you might set it locally |
|---|---|---|
| `WA_GRAPH_BASE_URL` | Meta | Point at the mock (§2). Ignored in production. |
| `WA_SEND_TIMEOUT_MS` | `10000` | Drop to `1000` so failed WhatsApp calls fail fast |
| `DB_CONNECTION_LIMIT` | `4` | Raise while debugging; 4 is deliberate for serverless |
| `DB_MAX_IDLE` | `1` | Disables the idle sweeper when equal to the connection limit |
| `MOCK_GRAPH_PORT` | `4000` | If 4000 is taken |
| `MOCK_GRAPH_FAIL` | unset | A Meta error code to force (§2.5) |

---

## 6. Troubleshooting

**Every request hangs, `/api-docs` still answers.**
The connection pool is starved — some request took a second connection while
holding its first. Restart the server to clear it, then find the nesting; the
rule is one connection per request, and `withConnection(cb, existingConn)`
exists so a helper can borrow the caller's.

**`OTP requested for an unknown number — nothing sent`.**
Working as designed: the response is identical whether or not a number is
registered, so the endpoint cannot be used to discover who has an account. Either
the number has no membership and no invitation, or self-signup is off (§4).

**Codes are not printing.**
Check `WA_GRAPH_BASE_URL` is set in `.env`, that the boot log says
`Local Mock Number`, and that you are reading the terminal running
`npm run mock:graph` — not a stale log file.

**`"id" must be a valid record id`.**
The id does not match the shape every id in this database uses. Seeded ids are
mnemonic (`f0000001-ftyp-…`) rather than true UUIDs, which is why `entityId` in
`src/utils/idSchema.js` exists instead of `Joi.string().uuid()`.

**Delivery receipts disabled at boot.**
`WA_APP_SECRET` and `WA_WEBHOOK_VERIFY_TOKEN` are blank locally. Harmless — you
just cannot tell a failed send from an unread one, and the webhook would need a
public HTTPS tunnel nobody wants in development.

---

## 7. From nothing to signed in

```bash
# 1. Rebuild
npm run db:reset -- --yes

# 2. Terminal 1
npm run mock:graph

# 3. Terminal 2
node server.js

# 4. Terminal 3 (frontend repo)
npm start

# 5. Open http://localhost:3000/login, enter +918861268683,
#    read the code from terminal 1, sign in.
```
