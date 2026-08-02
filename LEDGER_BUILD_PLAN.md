# Accounting Ledger — Build Plan

Settling a POS bill writes a **real accounting document**: a numbered, immutable
sale with lines, tax, a customer, and a tender-by-tender settlement, reversible
only by an audited status transition.

Companion to `POS_LEDGER_INTEGRATION_PLAN.md` (analysis). This is the build.

Status: **plan for review. Nothing implemented.**

---

## 0. Decisions taken

Following "make this an accounting ledger and do all linking", the open items are
resolved the way a real ledger requires:

| # | Decision | Why |
|---|---|---|
| Numbering | `CurrentCounterNo` + `UNIQUE(TransactionNo, TenantId)` | A ledger needs a gap-free, non-duplicable sequence. Reusing `BillNo` gives neither |
| Document type | Add `TransactionTypeId` to `transactiondetaillog` | "Is this a Sale or a Purchase" must be readable from the header, not inferred |
| Customer | Via `contactdetail`, FK + snapshot | §9 of the analysis — correct layer, historically accurate reprints |
| Walk-in promotion | Create a `contactdetail` **only when a phone exists**, match on phone | Otherwise `uk_contact_name_mobile` silently duplicates (nullable `MobileNo`) |
| Partial settlement | **Supported.** Document totals live on the log; payments accumulate | Without it "paid" is the only state a ledger can express, which is not true of real trade |
| Money types | `paymentdetail` `VARCHAR` → `DECIMAL(18,4)` | String money in an accounting ledger is indefensible. A tightening, so consistent with the never-relax rule |

---

## 1. What makes this a ledger rather than a table dump

Four properties. Everything below exists to deliver them.

1. **Numbered** — every document gets a gap-free sequence number, issued under a
   row lock, protected by a unique key.
2. **Immutable once settled** — a settled document's header, lines and payments
   cannot be edited. Corrections happen by reversal, not by overwrite.
3. **Auditable** — every status change is recorded in
   `transactiontypeconversionmapper` against a permitted transition. You can
   always answer "who moved this, when, and was it allowed".
4. **Balanced** — the document's own totals (what was invoiced) are separate from
   the payments against it (what was collected). Partial payment is expressible;
   over-payment is not.

---

## 2. Schema changes

### 2.1 `transactionitemdetail` — lines with variants *(analysis §8)*

```sql
ALTER TABLE transactionitemdetail
  ADD COLUMN LineNo        INT           NOT NULL DEFAULT 1 AFTER TransactionDetailLogId,
  ADD COLUMN BasePrice     DECIMAL(18,4) NULL               AFTER UnitPrice,
  ADD COLUMN VariantAmount DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER BasePrice,
  ADD COLUMN Variants      JSON          NULL               AFTER TaxComponents;

ALTER TABLE transactionitemdetail
  DROP INDEX TransactionDetailLogId,
  ADD UNIQUE KEY uk_tid_log_line (TransactionDetailLogId, LineNo, TenantId);
```

### 2.2 `transactiontypeconfig` — the counter

```sql
ALTER TABLE transactiontypeconfig
  ADD COLUMN CurrentCounterNo BIGINT NOT NULL DEFAULT 0 AFTER StartCounterNo;
```

### 2.3 `transactiondetaillog` — header, totals, customer, type

```sql
ALTER TABLE transactiondetaillog
  ADD COLUMN TransactionTypeId VARCHAR(50)   NULL AFTER TransactionTypeConfigId,
  -- Document totals: what was INVOICED. Distinct from what was collected.
  ADD COLUMN NetAmount      DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN TaxAmount      DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN DiscountAmount DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN RoundOff       DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN GrossAmount    DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN TaxByComponent JSON          NULL,
  -- Customer: FK for analytics, snapshot for faithful reprints
  ADD COLUMN ContactDetailId VARCHAR(50)  NULL,
  ADD COLUMN CustomerName    VARCHAR(150) NULL,
  ADD COLUMN CustomerMobile  VARCHAR(50)  NULL,
  ADD COLUMN SettledAt       DATETIME     NULL,
  ADD UNIQUE KEY uk_tdl_txnno_tenant (TransactionNo, TenantId),
  ADD CONSTRAINT fk_tdl_txntype FOREIGN KEY (TransactionTypeId) REFERENCES transactiontype(Id),
  ADD CONSTRAINT fk_tdl_contact FOREIGN KEY (ContactDetailId)   REFERENCES contactdetail(Id);
```

> **Why totals on the log.** `paymentdetail` currently conflates two things —
> `TaxesAmount` is a property of the *document*, not of a *payment*. An unpaid
> invoice still has a value. Putting invoice totals on the log and leaving
> `paymentdetail` as the settlement record is what makes partial payment
> expressible at all.

### 2.4 `paymentdetail` — real money types

```sql
ALTER TABLE paymentdetail
  MODIFY COLUMN DiscountAmount DECIMAL(18,4) NULL,
  MODIFY COLUMN RoundOff       DECIMAL(18,4) NULL,
  MODIFY COLUMN TotalAmount    DECIMAL(18,4) NOT NULL,
  MODIFY COLUMN TaxesAmount    DECIMAL(18,4) NULL,
  MODIFY COLUMN GrossAmount    DECIMAL(18,4) NOT NULL;
```

### 2.5 Linking columns

```sql
ALTER TABLE pos_customer
  ADD COLUMN ContactDetailId VARCHAR(50) NULL,
  ADD CONSTRAINT fk_poscust_contact FOREIGN KEY (ContactDetailId) REFERENCES contactdetail(Id);

ALTER TABLE pos_bill
  ADD COLUMN TransactionDetailLogId VARCHAR(50) NULL,
  ADD CONSTRAINT fk_posbill_tdl FOREIGN KEY (TransactionDetailLogId) REFERENCES transactiondetaillog(Id);
```

`pos_bill.TransactionDetailLogId` doubles as the **idempotency guard**: non-null
means already posted to the ledger; a second settle is a 409.

---

## 3. Seed data

Without this the ledger cannot function — `accounttypebase` is `NOT NULL` on both
payment tables and currently has no rows.

| Table | Rows |
|---|---|
| `transactiontypestatus` | `DRAFT`, `PARTIALLY_PAID`, `SETTLED`, `CANCELLED`, `REFUNDED` |
| `transactiontype` | `POS Sale` → the sales config |
| `accounttypebase` | `Sales` (revenue), `Cash`, `Bank`, `Wallet` |
| `paymentmode` | `Cash`, `Card`, `UPI`, `Wallet` |
| `paymentreceivedtype` | `Full`, `Partial`, `Advance`, `Refund` |
| `transactiontypebaseconversion` | the transition whitelist below |

**Permitted transitions** (each a `transactiontypebaseconversion` row with a `Tag`):

```
DRAFT           → PARTIALLY_PAID   POS_SALE_PART_PAY
DRAFT           → SETTLED          POS_SALE_SETTLE
PARTIALLY_PAID  → SETTLED          POS_SALE_SETTLE_REMAINDER
DRAFT           → CANCELLED        POS_SALE_VOID
SETTLED         → REFUNDED         POS_SALE_REFUND
```

Note `SETTLED → CANCELLED` is deliberately **absent**: a settled sale is
reversed by `REFUNDED`, never voided. That is the state machine doing its job.

---

## 4. Services

### 4.1 `transactionNumber.service` — gap-free numbering

```js
issueNumber(conn, transactionTypeConfigId, tenantId) → 'INV-0042'
```

- `SELECT … FOR UPDATE` on the config row, increment, format `Prefix` + `Format`
- Runs **inside the caller's transaction** so a rollback returns the number
- `{0000}` in `Format` is the zero-padded counter; unknown formats fall back to
  `Prefix + counter`
- `UNIQUE(TransactionNo, TenantId)` is the backstop if two tills ever race

### 4.2 `contactResolver.service` — the customer merge

```js
resolveContactForPosCustomer(conn, posCustomerId, tenantId, userEmail)
  → { contactDetailId, name, mobile } | null
```

1. no POS customer → `null` (walk-in; the ledger records no customer)
2. `pos_customer.ContactDetailId` set → use it
3. **no phone → `null`** — never create a phoneless contact (nullable `MobileNo`
   makes `uk_contact_name_mobile` silently non-unique)
4. phone present → find `contactdetail` **by mobile**, else create
   (`Name` split on first space; `LastName = ''` when absent)
5. write the id back to `pos_customer.ContactDetailId`

### 4.3 `ledger.service` — the orchestrator

```js
postSaleFromBill(conn, { billId, tenders, discount, roundOff }, tenantId, userEmail)
  → { transactionDetailLogId, transactionNo, status }
```

Sequence, all inside the settle transaction:

```
 1. guard: pos_bill.TransactionDetailLogId is null      else 409
 2. recompute bill from its rounds                      (existing, discount-before-tax)
 3. resolve customer                                    §4.2
 4. issue TransactionNo                                 §4.1
 5. INSERT transactiondetaillog        status=DRAFT, totals, customer FK + snapshot
 6. INSERT transactionitemdetail × N   LineNo 1..N, variants, priced snapshot
 7. INSERT paymentdetail               settlement summary
 8. per tender:
      INSERT paymentmodetransactiondetail   mode + RefNo
      INSERT paymentbreakup                 amount + receivedType + account
 9. transition DRAFT → SETTLED | PARTIALLY_PAID
      lookup the permitted transactiontypebaseconversion
      INSERT transactiontypeconversionmapper
      UPDATE log status + SettledAt
10. UPDATE pos_bill  Status, TransactionDetailLogId
```

Step 6 reads the **stored** line snapshots from the orders — never live rates.

### 4.4 Immutability guard

A shared check used by `transactiondetaillog`, `transactionitemdetail`,
`paymentdetail` and `paymentbreakup` update/delete paths:

```js
assertMutable(log)   // throws 409 when status is SETTLED / REFUNDED / CANCELLED
```

This is the difference between a ledger and a table you can quietly edit.

### 4.5 Reversal

```js
refundSale(conn, logId, reason, tenantId, userEmail)
```

Transitions `SETTLED → REFUNDED`, writes the conversion-mapper row, and records a
negative `paymentbreakup` with `paymentreceivedtype = Refund`. **Nothing is
deleted or overwritten** — the original document stands and the reversal sits
next to it.

---

## 5. API

| Endpoint | Change |
|---|---|
| `POST /api/pos/bills/:id/settle` | body gains `Tenders[]` (`{ paymentModeId, amount, refNo?, receivedTypeId? }`), `RoundOff`; response gains `TransactionNo`, `TransactionDetailLogId`, `Status`, `BalanceDue` |
| `GET /api/pos/bills/:id` | gains `TransactionNo` |
| `GET /api/ledger/documents` | new — list documents (filters: date, status, type, branch, customer) |
| `GET /api/ledger/documents/:id` | new — full document: header, lines with variants + tax, tenders, transition history |
| `POST /api/ledger/documents/:id/refund` | new — §4.5 |

**Settle validation**

- tendered **must be ≥** payable, or the bill stays `PARTIALLY_PAID`
- over-tender is change, not revenue: `paymentbreakup` records the payable share
- `RefNo` **required** for non-cash modes
- legacy `Payments` JSON still accepted → mapped to a single Cash tender, so
  existing callers keep working

---

## 6. UI/UX

### 6.1 Settle screen — the tender ledger

```
┌─ Settle Bill — Table 4 ─────────────────────────────┐
│  Customer   [ 98765 43210        ] 🔍  Rahul Verma  │
│             ✓ linked · 12 visits                     │
│  ─────────────────────────────────────────────────  │
│  Sub Total                              ₹ 919.97    │
│    CGST 9%                              ₹  75.00    │
│    SGST 9%                              ₹  74.99    │
│  Discount     [  30.00 ] before tax     −₹ 30.00    │
│  Round Off                              ₹   0.04    │
│  ═════════════════════════════════════════════════  │
│  PAYABLE                                ₹1039.96    │
│                                                     │
│  Tenders                            [+ Add tender]  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Cash ▾  ₹ 500.00                          [×] │  │
│  │ Card ▾  ₹ 539.96   Ref [ 004521        ]  [×] │  │
│  └───────────────────────────────────────────────┘  │
│  Tendered ₹1039.96        BALANCE DUE  ₹  0.00 ✓    │
│  [ Cash exact ] [ ₹1100 ] [ ₹1500 ]                 │
│                                                     │
│        [ Settle & Post to Ledger ]   [ Cancel ]     │
└─────────────────────────────────────────────────────┘
```

Reasoning:

- **Balance due is the hero number** — red while short, green at zero. Cashiers
  work to that figure.
- **One row = one `paymentbreakup`.** The UI mirrors the table, so there is no
  translation layer to get wrong.
- **`Ref No` only for non-cash** — keeps the cash path at two taps while still
  capturing what reconciliation needs.
- **Customer lookup by phone**, matching the "phone is identity" rule. Shows the
  link state so staff know whether this sale will be attributable.
- **Quick tender + change** — the biggest speed win on a real till.
- **Settle disabled until balance ≤ 0**, with the reason shown, not a mute
  disabled button.
- Partial tender offers **"Save as partially paid"** instead of blocking.

### 6.2 After settle

```
✓ Posted to ledger        INVOICE  INV-0042
  Table 4 · 3 rounds · ₹1039.96 · Rahul Verma
  Cash ₹500.00 · Card ₹539.96 (ref 004521)
                [ Print ] [ View Invoice ] [ New Order ]
```

The invoice number is the customer-facing artefact, so it is the headline.

### 6.3 Invoice view (new, read-only)

Header (no., date, branch, customer) · lines showing
`Masala Dosa (Large, Extra cheese) 2 × 130.00` · per-line tax · CGST/SGST footer
· tender breakdown · status chip · transition history.

Read-only **by design** — it visibly reflects the immutability rule, and the only
action offered on a settled document is **Refund**.

### 6.4 Where the ledger surfaces

- **Bill list** — `TransactionNo` beside `BillNo`; a bill without one is visibly
  not yet posted.
- **Ledger screen** (new) — documents by date/status/customer, the accountant's view.
- **Customer detail** — purchase history straight from the ledger by
  `ContactDetailId`.
- **Reports** — aggregate from the ledger instead of POS JSON.

---

## 7. Phasing

| Phase | Scope | Schema | Behaviour change |
|---|---|---|---|
| **L1** | Seed masters + transitions (§3) | — | none |
| **L2** | `transactionitemdetail` LineNo/variants (§2.1) | 1 | none |
| **L3** | Numbering: counter, unique, `transactionNumber.service` (§2.2, §4.1) | 2 | none |
| **L4** | Log header: totals, type, customer cols (§2.3); `paymentdetail` money types (§2.4) | 2 | none |
| **L5** | `contactResolver` + `pos_customer.ContactDetailId` (§2.5, §4.2) | 1 | none |
| **L6** | `ledger.service` + settle posts the document (§4.3), `pos_bill` link | 1 | **yes** |
| **L7** | Immutability guard + refund (§4.4, §4.5) | — | yes |
| **L8** | Ledger read APIs (§5) | — | none |
| **L9** | Settle UI with tenders + customer (§6.1) | — | yes |
| **L10** | Invoice view + ledger screen (§6.3, §6.4) | — | none |

L1–L5 are additive and independently shippable. **L6 is the pivot.**

---

## 8. Testing

**Unit**
- number generator: format padding, increment, concurrent `FOR UPDATE`, fallback
- contact resolver: no customer → null; **no phone → null**; existing link
  reused; find-by-mobile before create; name split
- transition guard: permitted move succeeds, unpermitted throws, mapper row written
- immutability: update/delete on a settled document → 409

**Integration**
- settle posts exactly one document with N lines and M tenders
- **same item twice with different variants → two lines** (the `LineNo` case)
- tender sum < payable → `PARTIALLY_PAID`, bill not closed
- settling twice → 409, no second document
- rollback: a failure at any step leaves **no** log, lines, payments or bill link
- legacy `Payments` JSON body still settles
- refund leaves the original intact and adds a reversal

**Invariants**
- `Σ paymentbreakup.Amount` = `paymentdetail.TotalAmount`
- log `GrossAmount` = `NetAmount + TaxAmount − DiscountAmount + RoundOff`
- `Σ transactionitemdetail.GrossAmount` reconciles to the log total

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Number collision under concurrent tills | `FOR UPDATE` + unique key |
| Partial ledger on failure | One transaction; rollback test |
| Double posting | `pos_bill.TransactionDetailLogId` guard → 409 |
| Walk-in contact duplication | Phone-only promotion rule (§4.2) |
| Existing bills have no ledger row | Nullable link; not backfilled, per your earlier call |
| `paymentdetail` type change | `VARCHAR`→`DECIMAL` is a tightening; values are numeric strings today |

---

## 10. Still worth confirming

1. **Refund granularity** — whole document only, or line-level partial refunds?
   Line-level is materially more work and needs its own document type.
2. **`RoundOff`** — automatic to the nearest rupee on cash tenders, or manual?
3. **Ledger visibility** — which scope gates `/api/ledger/*`? New `LEDGER:READ`,
   or reuse `TRANSACTIONS:READ`?
