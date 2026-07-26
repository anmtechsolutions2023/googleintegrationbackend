# Database Constraint Audit — tenant isolation & uniqueness

Systematic review of all 53 UNIQUE constraints and 61 foreign keys in
`database/01-schema-definition.sql`, prompted by the `uk_ttc_tagname` failure
that blocked the first-time setup wizard.

Extracted mechanically (parse every `CREATE TABLE`, cross-reference each key
column against its declared nullability), not by eye.

---

## P0 — Missing `TenantId` in a UNIQUE key · **RESOLVED, none remaining**

The original defect class: a business key that omits `TenantId` becomes a
*global* namespace, so one tenant's row blocks every other tenant.

| Table | Key | Status |
|---|---|---|
| `transactiontypeconfig` | `uk_ttc_tagname` | ✅ fixed → `(TagName, TenantId)` |
| `mapproviderlocationmapper` | `uk_mplm_tagname` | ✅ fixed → `(TagName, TenantId)` |
| `addressdetail` | `uk_ad_tagname` | ✅ fixed → `(TagName, TenantId)` |

**Audit result: those three were the only occurrences.** Every other UNIQUE on a
table that has a `TenantId` column already includes it.

One constraint is unscoped *by design* and should stay that way:

- `onboarding_requests.uq_onboarding_email (email)` — one pending request per
  email address system-wide. Its `tenant_id` is nullable precisely because the
  email is not yet assigned to a tenant. **No action.**

---

## P1 — Constraint silently disabled by a NULLable key column

MySQL treats `NULL` as distinct inside a UNIQUE index, so **any row with `NULL`
in a key column can never collide with anything**. Where the nullable column is a
*scoping* column rather than an optional identifier, the constraint is
effectively switched off for a large share of real rows.

These are ranked by how often the null path is actually taken.

### 1. `contactdetail.uk_contact_name_mobile` — **confirmed live**

```sql
CONSTRAINT uk_contact_name_mobile UNIQUE (FirstName, LastName, MobileNo, TenantId)
--                                                             ^^^^^^^^ nullable
```

The setup wizard does not collect `MobileNo` at all (verified in
`mastersetup.schemas.js`), and your own run proves it:

```
contactdetail params: [..., "Animesh", "Malhotra", null, ...]
```

Every contact created without a mobile number bypasses the key entirely —
unlimited "Animesh Malhotra" duplicates are accepted. The constraint only
protects contacts that happen to have a phone number.

### 2. `addressdetail` composite — **confirmed live**

```sql
UNIQUE (AddressLine1, City, ContactAddressTypeId, TenantId)
--                    ^^^^ nullable, and never collected by the wizard
```

Your run again:

```
addressdetail params: [..., "Balegere", null, null, null, null, ...]
--                          AddressLine1  A2   City  State Pincode
```

`City` is null on every wizard-created address, so the key never fires.

### 3. Nullable FK as the scoping column

Same mechanism, narrower blast radius — these only misbehave when the parent is
left unset:

| Table | Key | Nullable column |
|---|---|---|
| `batchdetail` | `(BatchNo, BranchDetailId, TenantId)` | `BranchDetailId` |
| `pos_floor` | `(Name, BranchDetailId, TenantId)` | `BranchDetailId` |
| `pos_table` | `(Name, FloorId, TenantId)` | `FloorId` |
| `pos_token` | `(TokenNumber, BranchDetailId, TenantId)` | `BranchDetailId` |

`pos_token` is the one to watch — duplicate queue numbers within a branch are a
visible operational bug, and `BranchDetailId` is nullable on that table.

> **Note on your "never relax the DB" rule:** every fix here is a *tightening*
> — either make the column `NOT NULL`, or drop it from the key so the remaining
> columns bind more strictly. Neither direction weakens a guarantee, so this
> class does not conflict with that rule.

---

## P2 — NULLable by design · no action

Same mechanism, but repeated NULLs are the desired behaviour: the column is an
*optional identifier*, and many rows legitimately lack one.

| Table | Key | Why it's fine |
|---|---|---|
| `transactiontypeconfig` | `uk_ttc_tagname` | `TagName` optional; untagged configs should coexist |
| `mapproviderlocationmapper` | `uk_mplm_tagname` | same |
| `addressdetail` | `uk_ad_tagname` | same |
| `transactiontypebaseconversion` | `uk_ttbc_tag_tenant` | `Tag` optional |
| `pos_customer` | `(Phone, TenantId)` | walk-ins without a phone must be allowed |
| `pos_staff` | `(Email, TenantId)` | staff without an email must be allowed |
| `pos_online_order` | `(Platform, ExternalRef, TenantId)` | `ExternalRef` absent for manual entries |

---

## P3 — Structural observations

### 3.1 No foreign key is tenant-aware — 61 of 61

Every FK references the parent's `Id` alone:

```sql
FOREIGN KEY (TransactionTypeConfigId) REFERENCES transactiontypeconfig(Id)
```

Nothing at the database level stops a row in tenant A from referencing a row
owned by tenant B. Today this is contained by application-layer scoping (every
service filters on `TenantId`) and by IDs being UUIDs, so it needs a bug or
deliberate action to trigger — but it is the same class of gap as the P0 issue,
just at the referential layer rather than the uniqueness layer.

Closing it properly means composite `(Id, TenantId)` uniques on parents and
composite FKs on children — 61 constraints across ~40 tables. That is a large,
invasive change; flagging it as a known risk rather than recommending it now.

### 3.2 Six tenant tables have no business key at all

`transactiondetaillog`, `paymentmodetransactiondetail`, `paymentdetail`,
`paymentbreakup`, `pos_feedback`, `pos_expense`.

Only a PK on a generated UUID, so nothing prevents byte-identical duplicate
rows. For append-only ledger/log tables that is often intentional — but
`transactiondetaillog.TransactionNo` in particular looks like it was meant to be
unique per tenant. **Worth confirming.**

### 3.3 One redundant constraint

```sql
-- costinfo
PRIMARY KEY (Id),
UNIQUE (Id, TenantId),   -- Id is already unique on its own; adds nothing
```

Harmless, costs an extra index. Also means `costinfo` has no real business key —
duplicate cost rows with identical `Amount`/`TaxGroupId` are permitted.

### 3.4 GAP #4 in the schema file is still open

The file's own gap analysis notes there are **no indexes on `TenantId`** across
the business tables, while every query filters on it. Unrelated to correctness,
but it will become the dominant performance problem as data grows.

---

## Summary

| Priority | Finding | Count | Action |
|---|---|---|---|
| **P0** | Missing `TenantId` in UNIQUE | 3 | ✅ **Fixed** — audit confirms none remain |
| **P1** | Key disabled by nullable column | 6 | Review — 2 confirmed live, all fixes are tightenings |
| **P2** | Nullable by design | 7 | None |
| **P3** | Non-tenant-aware FKs | 61 | Known risk, contained by app layer |
| **P3** | Tables with no business key | 6 | Confirm intent (esp. `transactiondetaillog`) |
| **P3** | Redundant `costinfo` unique | 1 | Optional cleanup |

**Nothing in P1–P3 blocks your fresh deploy.** P0 was the only thing breaking the
setup wizard, and it is fixed. The rest is a correctness backlog to work through
deliberately.
