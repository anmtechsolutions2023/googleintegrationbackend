# Payment Methods — Backend Plan

Configurable tender types, per outlet. Cash and UPI on out of the box; everything
else a toggle away.

Frontend half: `tenant-auth-ui/PAYMENT_METHODS_FRONTEND_PLAN.md`.

---

## 1. Where we are today

`paymentmode` already exists and is already tenant-scoped, with a
`DefaultAccountTypeBaseId` pointing at the ledger account a tender lands in. The
till already reads the list from the database. So this is **not** a new concept —
it is an existing one with four specific holes.

| # | Hole | Where | Consequence |
|---|---|---|---|
| 1 | The CRUD never writes `DefaultAccountTypeBaseId` | `paymentmode.service.js` `prepareInsertParams` / `prepareUpdateParams`, and `QUERIES.PAYMENT_MODE.INSERT` / `UPDATE` | A method added through the UI books to **no account**. The SELECT joins `AccountName` and the till displays it, so the column looks supported. It is not writable at all. |
| 2 | "Needs a reference number" is a name match | `Billing.js` — `['card','upi','wallet'].includes(modeName(id).toLowerCase())` | Rename *Card* to *Credit Card* and reference numbers silently stop being required. The same list is duplicated in `constants.js` as `REF_REQUIRED_MODES`. |
| 3 | `ORDER BY pm.CreatedOn DESC` | `QUERIES.PAYMENT_MODE.SELECT_ALL` | The till's `addTender` takes `paymentModes[0]`, so the **default tender is whatever was created most recently** — not Cash. |
| 4 | The till never filters on `Active` | `Billing.js` — `paymentModes.map(...)` | Deactivating a method does nothing. It still appears at the counter. |

There is no per-branch concept at all, and nothing seeds a sensible starting
state: a new tenant gets Cash, Card, UPI, Wallet and three portal settlement
tenders, all equally present, all shown at the counter.

## 2. The model

Two levels: a tenant **catalogue**, and a per-branch **override**.

### 2.1 `paymentmode` — two new columns

Edit the `CREATE TABLE` in `database/01-schema-definition.sql` in place (this repo
deploys by recreating, never by migration).

```sql
-- Whether this tender needs a reference number to be reconcilable. Replaces a
-- hardcoded ['card','upi','wallet'] name match in the till, which stopped
-- working the moment anybody renamed a method.
RequiresReference TINYINT(1) NOT NULL DEFAULT 0,
-- What a branch that has never been configured does with this method. See §2.3:
-- absence of a branch row means "inherit this", which is what lets a method
-- added next year govern every existing branch with no backfill.
EnabledByDefault  TINYINT(1) NOT NULL DEFAULT 1,
```

`DefaultAccountTypeBaseId` needs no schema change — only the queries and the
service, which ignore it today (hole 1).

### 2.2 `pos_branch_payment_method` — new

```sql
CREATE TABLE pos_branch_payment_method (
    Id              VARCHAR(50) NOT NULL,
    TenantId        VARCHAR(50) NOT NULL,
    BranchDetailId  VARCHAR(50) NOT NULL,
    PaymentModeId   VARCHAR(50) NOT NULL,
    Enabled         TINYINT(1)  NOT NULL,
    Active          TINYINT(1)  NOT NULL DEFAULT 1,
    CreatedOn       DATETIME,
    CreatedBy       VARCHAR(50),
    UpdatedOn       DATETIME,
    UpdatedBy       VARCHAR(50),
    PRIMARY KEY (Id),
    -- One decision per method per branch. This is what makes a save an upsert.
    UNIQUE KEY uk_branch_paymode (TenantId, BranchDetailId, PaymentModeId),
    INDEX idx_bpm_branch (TenantId, BranchDetailId),
    -- Deleting a method takes its overrides with it; an orphan override would
    -- re-enable nothing and confuse the resolve query.
    FOREIGN KEY (PaymentModeId) REFERENCES paymentmode(Id) ON DELETE CASCADE
);
```

No FK onto `branchdetail`, matching `pos_branch_media` and `user_tenants`:
retiring a branch must not be blocked by a settings row.

Also required, or the schema is inconsistent with itself:

- `DROP TABLE IF EXISTS pos_branch_payment_method;` in the Section 4 drop block
  (every table in 01 has a matching drop — keep it that way).
- Add the table to the tenant-deletion sweep in `constants.js` (~line 2810,
  beside `pos_branch_media`), **before** `paymentmode` in the FK order.
- Add to `src/config/schemaCheck.js`:
  `pos_branch_payment_method: ['PaymentModeId', 'Enabled']`, and
  `paymentmode: ['RequiresReference', 'EnabledByDefault']`.

### 2.3 The resolve rule — absence means inherit

**No row in `pos_branch_payment_method` = use `paymentmode.EnabledByDefault`.**

This is the load-bearing decision of the whole design. The obvious alternative —
provision a row per branch per method — fails twice:

- A method added later would be invisible at every existing branch until someone
  backfilled rows for it.
- Every new branch would need a provisioning pass, and a branch created by a path
  that forgot it would take no payments at all.

With inherit-on-absence, a brand-new branch shows Cash and UPI having written
nothing, and a new method is governed by its own default everywhere the moment it
exists. Only a deliberate per-branch decision writes a row.

The corollary, which the save path must honour: **setting a branch back to the
tenant default deletes the override row** rather than storing it. Inheritance
stays the resting state, and the table only ever holds genuine exceptions.

```
enabled(branch, method) =
    branch override row exists ? row.Enabled
                               : method.EnabledByDefault
```

### 2.4 Portal settlement is not affected

Portal orders settle through `pos_portal.SettlementPaymentModeId` — a direct FK
to the tender, resolved in `posonlineorder.settle.js`. It does **not** consult the
counter's enabled list. So shipping the three `* Settlement` tenders disabled
keeps them off the counter's payment radios while portal settlement keeps working
untouched. Verify this stays true if that lookup is ever refactored.

## 3. Seeding

`src/modules/mastersetup/posMasters.provision.js`. Widen `MODES` to carry the two
new flags, and **reorder so UPI precedes Card** — seeded `CreatedOn` order is what
the till will order by (§5), so this is what puts Cash and UPI first.

```js
// [Type, account, enabledByDefault, requiresReference]
const MODES = [
  ['Cash',   'Cash',   1, 0],
  ['UPI',    'Bank',   1, 1],
  ['Card',   'Bank',   0, 1],
  ['Wallet', 'Wallet', 0, 1],
];
```

Portal settlement tenders (the `PORTALS` loop below it) get
`EnabledByDefault = 0`, `RequiresReference = 0` — a payout statement reconciles
against the portal, not a per-transaction reference.

Both `INSERT` statements in that file need the two new columns.

`database/02-seed-data.sql` has two `INSERT IGNORE INTO paymentmode` statements
(~lines 827, 880) — same treatment, same values.

## 4. Endpoints

New module `src/modules/pospaymentmethod/`, following the `pos*` per-branch
convention (`?branchId=`, controller-as-array, `BaseCRUDService` not used — this
is a resolve-and-upsert, not CRUD).

### `GET /api/pos/payment-methods?branchId=`

The resolved list for one branch — every catalogue method with its effective
state. One call serves both the config screen and the till.

```json
{ "success": true, "message": "Payment methods retrieved successfully",
  "data": { "branchId": "…", "methods": [
    { "paymentModeId": "…", "type": "Cash", "accountId": "…",
      "accountName": "Cash", "accountKind": "ASSET",
      "requiresReference": false, "active": true,
      "enabled": true, "enabledByDefault": true, "source": "default" },
    { "…": "…", "type": "Card", "enabled": false,
      "enabledByDefault": false, "source": "default" }
  ]}}
```

`source` (`"branch"` | `"default"`) is what lets the UI show "inherited" versus
"overridden here", and lets a Reset control know there is something to clear.

Resolve in **one** query — left join the override, `COALESCE` the flag:

```sql
SELECT pm.Id, pm.Type, pm.Active, pm.RequiresReference, pm.EnabledByDefault,
       pm.DefaultAccountTypeBaseId AS AccountId,
       a.Name AS AccountName, a.Kind AS AccountKind,
       bpm.Enabled AS BranchEnabled
  FROM paymentmode pm
  LEFT JOIN accounttypebase a
    ON a.Id = pm.DefaultAccountTypeBaseId AND a.TenantId = pm.TenantId
  LEFT JOIN pos_branch_payment_method bpm
    ON bpm.PaymentModeId = pm.Id AND bpm.TenantId = pm.TenantId
   AND bpm.BranchDetailId = ? AND bpm.Active = 1
 WHERE pm.TenantId = ?
 ORDER BY pm.CreatedOn ASC
```

`enabled = BranchEnabled ?? EnabledByDefault`, `source = BranchEnabled === null ? 'default' : 'branch'`.

**Scopes (READ):** the same broad set `paymentmode.routes.js` already admits —
`TENANT_ADMIN`, `TENANT_SUPER_ADMIN`, `MASTER_DATA_READ/WRITE`,
`POS_BILLING_READ/WRITE`, `POS_ORDER_READ/WRITE`, `POS_OPS_READ/WRITE`. A cashier
must reach this to take money; gating it on a config scope would mean granting the
counter the whole Master Data section to read one list.

### `PUT /api/pos/payment-methods?branchId=`

```json
{ "methods": [ { "paymentModeId": "…", "enabled": true }, … ] }
```

One transaction. Per entry: if `enabled` equals that method's `EnabledByDefault`,
**delete** any override row; otherwise upsert one (`INSERT … ON DUPLICATE KEY
UPDATE Enabled = VALUES(Enabled), UpdatedOn = NOW(), UpdatedBy = ?`). Partial
lists are legal — a method not mentioned is left exactly as it was, so the screen
can save one toggle without restating the rest.

Reject the save if it would leave the branch with **zero** enabled methods: a till
that can take no money is not a state worth persisting, and the error is far
cheaper here than at the counter mid-sale.

**Scopes (WRITE):** `TENANT_ADMIN`, `TENANT_SUPER_ADMIN`, `POS_CONFIG_WRITE`,
`MASTER_DATA_WRITE`. Audit: `AUDIT_CATEGORIES.POS`, `'INFO'`,
`'Branch payment methods updated'`.

### `/api/paymentmodes` — extend the existing catalogue CRUD

The tenant-level list (create / rename / delete a method) stays where it is. Three
fields become writable, which closes hole 1:

- `DefaultAccountTypeBaseId` — add to `INSERT`, `UPDATE`, both `prepare*Params`,
  and both Joi schemas (`optionalEntityId`).
- `RequiresReference` — `Joi.boolean().default(false)`.
- `EnabledByDefault` — `Joi.boolean().default(true)`.

`DefaultAccountTypeBaseId` should be **required on create** at the Joi layer. A
tender with no account books nowhere, and every method the provisioner makes has
one — letting the UI create the one kind that does not is how hole 1 stays open
under a new name.

## 5. The two query fixes

`QUERIES.PAYMENT_MODE.SELECT_ALL`: `ORDER BY pm.CreatedOn DESC` → **`ORDER BY
pm.SortOrder ASC, pm.Id ASC`**.

> **Changed during implementation.** This section originally said `CreatedOn
> ASC`, which does not work: `CreatedOn` is a `DATETIME` (one-second resolution)
> and provisioning inserts every mode inside the same second, so the order was
> whatever the server felt like returning. A `SortOrder INT` column was added to
> `paymentmode` to make it deterministic. It is **not** user-editable — no UI, and
> the API strips it — so the "no display order" decision stands; it is assigned
> `MAX(SortOrder) + 1` on create so a new method lands at the end.

With the seed order in §3 this makes Cash the first row, which is what the till
defaults the first tender to. Before, it defaulted to the most recently created
method — for most tenants, *District Settlement*.

`REF_REQUIRED_MODES` in `constants.js` becomes dead once the column lands.
Delete it rather than leaving a second, diverging source of the same truth.

> **Found during implementation.** It was not dead — `ledger.service.js`
> `resolveTenderMode` enforced the reference rule server-side from that same
> hardcoded list. So the till was not the only place that broke on a rename; the
> ledger did too, and a tenant adding *Amex* got no enforcement anywhere.
> `QUERIES.LEDGER.SELECT_PAYMENT_MODE` now selects `RequiresReference` and the
> guard reads the column, so both layers enforce one rule.

## 6. Tests

`src/__tests__/modules/pospaymentmethod.test.js`:

- resolves to the tenant default when the branch has no row — **Cash and UPI
  enabled, Card and Wallet not**, for a freshly provisioned tenant
- a branch override wins over the default, both directions, and reports
  `source: 'branch'`
- saving a value equal to the default **removes** the row (inherit is the resting
  state, §2.3)
- a partial list leaves unmentioned methods untouched
- a save that would disable every method is refused
- two branches of one tenant resolve independently
- portal settlement tenders resolve `enabled: false` by default and are still
  reachable by `pos_portal.SettlementPaymentModeId`

Extend `src/__tests__/modules/paymentmode.*`:

- create persists `DefaultAccountTypeBaseId` (**fails today** — hole 1)
- create without an account is rejected
- `RequiresReference` round-trips

## 7. Order of work

1. Schema — `paymentmode` columns, new table, its `DROP`, delete sweep, `schemaCheck`
2. Seeding — `posMasters.provision.js` + `02-seed-data.sql`
3. Catalogue CRUD — queries, service, schemas (closes hole 1)
4. `SELECT_ALL` ordering; drop `REF_REQUIRED_MODES` (holes 2, 3)
5. New `pospaymentmethod` module — resolve + save
6. Route registration in `src/config/routes.js`
7. Tests
8. `npm run db:reset -- --yes`, then the frontend plan

Steps 1–4 are independently useful and ship without any UI: they fix a method
that books to no account, a reference rule that breaks on rename, and a default
tender nobody chose.
