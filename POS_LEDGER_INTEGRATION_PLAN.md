# POS ↔ Transaction & Payment Ledger — Analysis and Integration Plan

How the transaction and payment sections are modelled, why they exist, and what
it takes to make "Settle Bill" write a real accounting document instead of a
JSON blob.

Status: **analysis + proposal. Nothing implemented.**

---

## PART 1 — The transaction section

Seven tables. Together they are a **generic document ledger with a state
machine** — not a sales-specific design. A POS bill, a purchase, a stock
transfer and a return are all "a document with numbered lines that moves through
statuses".

### 1.1 The tables

| Table | Role | Key relationships |
|---|---|---|
| `transactiontypeconfig` | **Document numbering rule.** `StartCounterNo`, `Prefix`, `Format` (`INV-{0000}`), `TagName` | referenced by everything below |
| `transactiontype` | Named document type ("Sale", "Purchase") | → `transactiontypeconfig` |
| `transactiontypestatus` | Status master (Draft / Settled / Cancelled …) | standalone |
| `transactiontypebaseconversion` | **Allowed transitions** — `(config, fromStatus, toStatus)` + `Tag` | → config, → status ×2 |
| `transactiontypeconversionmapper` | **Transitions that actually happened** — `(baseConversion, log, status)` | → baseconversion, → log, → status |
| `transactiondetaillog` | **Document header** — `TransactionNo`, config, status, branch, date, remarks | → config, → status, → branchdetail |
| `transactionitemdetail` | **Document lines** — item, qty, priced snapshot | → log, → itemdetail, → costinfo |

### 1.2 The state machine — the part worth understanding

This is the cleverest piece of the design, and the easiest to miss:

```
transactiontypebaseconversion   =  the RULE      "Draft may become Settled"
transactiontypeconversionmapper =  the EVENT     "log #123 went Draft → Settled"
```

`baseconversion` is a **whitelist of legal moves** per config; `conversionmapper`
is the **audit trail** of moves taken, with its own unique key
`(baseConversion, log, status)` so the same transition cannot be logged twice.

Practical consequence: you cannot legally move a document to a status unless a
`baseconversion` row permits it. **Nothing is seeded**, so today no transition is
legal at all.

### 1.3 Document numbering

`transactiontypeconfig` defines `Prefix` + `Format` + `StartCounterNo`. The
wizard seeds one row tagged `Onboarding` with `Format = INV-{0000}`.

**There is no current-counter column and no code that generates a number.**
`TransactionNo` is whatever the caller sends. See §4.2 — this is a blocker.

### 1.4 Gaps found in this section

| # | Finding | Impact |
|---|---|---|
| T1 | **`transactiondetaillog.TransactionNo` has no UNIQUE constraint** | Duplicate invoice numbers are accepted silently |
| T2 | **No current-counter column** on `transactiontypeconfig` | Sequential numbering cannot be generated safely |
| T3 | **`transactiondetaillog` has no link to `transactiontype`** — only to `transactiontypeconfig` | Cannot tell a Sale from a Purchase from the header alone |
| T4 | **No customer column** on `transactiondetaillog` | `pos_order.CustomerId` has nowhere to land in the ledger |
| T5 | **`transactionitemdetail` UNIQUE `(LogId, ItemId, TenantId)`** | **Blocker** — see §4.1 |
| T6 | No status/transition/type master data seeded | Ledger is unusable out of the box |

---

## PART 2 — The payment section

Five tables plus `accounttypebase`. This is a **settlement hierarchy** built for
split tenders — exactly what a restaurant till needs.

### 2.1 The intended shape

```
transactiondetaillog                  the sale document
   └── paymentdetail                  ONE settlement
         │   DiscountAmount, RoundOff, GrossAmount, TaxesAmount, TotalAmount
         │   AccountTypeBaseId  → which ledger account
         │
         └── paymentbreakup            ONE ROW PER TENDER
               │   Amount, Timestamp, UserId
               ├── paymentmodetransactiondetail   the instrument
               │        PaymentModeId → Cash / Card / UPI
               │        RefNo, Comment, CF1–CF4
               ├── paymentreceivedtype            Full / Partial / Advance
               └── accounttypebase                account it lands in
```

"₹500 cash + ₹300 card" is **two `paymentbreakup` rows** under one
`paymentdetail`, each pointing at its own
`paymentmodetransactiondetail` carrying the card's `RefNo`.

### 2.2 What each piece is actually for

- **`paymentmode`** — the tender type master (Cash, Card, UPI, Wallet).
- **`paymentmodetransactiondetail`** — one row per *use* of an instrument. This
  is where a card approval code or UPI reference goes (`RefNo`), plus four
  custom fields. Reconciliation depends on this.
- **`paymentreceivedtype`** — classifies the receipt (Full / Partial / Advance),
  which is how partial settlement is expressed.
- **`accounttypebase`** — the account the money is attributed to. `NOT NULL` on
  **both** `paymentdetail` and `paymentbreakup`.
- **`RoundOff`** on `paymentdetail` — cash rounding, currently unused by POS.

### 2.3 Gaps found in this section

| # | Finding | Impact |
|---|---|---|
| P1 | **`accounttypebase` is NOT NULL on both payment tables and nothing is seeded** | Any settle attempt fails on FK today |
| P2 | Money columns are `VARCHAR(50)` while POS uses `DECIMAL(12,2)` | Parse-at-boundary required (engine already does this) |
| P3 | `paymentdetail.TransactionDetailLogId` has no unique constraint | Several settlements per document are possible — correct for partials, ambiguous otherwise |
| P4 | No `paymentmode` / `paymentreceivedtype` seeded | Settle has no tender types to choose from |

---

## PART 3 — How POS relates to this today

**It doesn't.** A grep for `transactiondetaillog|paymentdetail|paymentbreakup`
across `posbill` and `posorder` returns nothing. Two parallel worlds:

```
POS world                          Ledger world
─────────                          ────────────
pos_order  (rounds)                transactiondetaillog
pos_bill   (+ pos_bill_order)      transactionitemdetail
pos_bill.Payments  ← JSON blob     paymentdetail → paymentbreakup
```

The POS side is fully priced (net/tax/gross + CGST-SGST split per line, snapshot
on write). The ledger side has the structure to receive it and is empty.

**The mapping is one-to-one and obvious:**

| POS | Ledger |
|---|---|
| `pos_bill` (settled) | `transactiondetaillog` — one Sale document |
| `pos_order.Items[]` across `pos_bill_order` | `transactionitemdetail` rows |
| bill `SubTotal` / `TaxAmount` / `Discount` / `Total` | `paymentdetail` amounts |
| each tender | `paymentbreakup` + `paymentmodetransactiondetail` |
| `pos_bill.Status = paid` | status transition recorded in `conversionmapper` |

---

## PART 4 — Blockers to resolve first

### 4.1 `transactionitemdetail` cannot hold the same item twice — **hard blocker**

```sql
UNIQUE (TransactionDetailLogId, ItemId, TenantId)
```

One item may appear **once per document**. But we just shipped variants: a bill
can legitimately contain

```
Masala Dosa (Large, Extra cheese)   ₹150
Masala Dosa                         ₹100
```

Both are `ItemId = dosa` → the second insert violates the constraint.

Options:

| | Approach | Trade-off |
|---|---|---|
| **A** | Add `LineNo` to the key → `(LogId, ItemId, LineNo, TenantId)` | Correct; a document is an ordered list of lines. Tightens nothing, adds a column |
| **B** | Aggregate same-item lines before writing | Loses the variant distinction on the invoice — a customer cannot see what they ordered |
| **C** | Drop the constraint | Removes duplicate protection entirely |

**Recommended: A.** It matches how every invoice system models lines, and keeps
a uniqueness guarantee rather than removing one.

### 4.2 Sequential invoice numbers cannot be generated safely

`transactiontypeconfig` has `StartCounterNo` but no *current* counter, and
`TransactionNo` has no unique constraint (T1).

Proposed:

```sql
ALTER TABLE transactiontypeconfig
  ADD COLUMN CurrentCounterNo BIGINT NOT NULL DEFAULT 0;

ALTER TABLE transactiondetaillog
  ADD UNIQUE KEY uk_tdl_txnno_tenant (TransactionNo, TenantId);
```

Generation inside the settle transaction:

```sql
SELECT CurrentCounterNo FROM transactiontypeconfig
 WHERE Id = ? AND TenantId = ? FOR UPDATE;     -- row lock, no double-issue
UPDATE transactiontypeconfig SET CurrentCounterNo = CurrentCounterNo + 1 ...
```

then format `Prefix` + `Format` (`INV-{0000}` → `INV-0042`). The unique key is
the safety net if two tills ever race.

### 4.3 Master data must be seeded

Nothing works until these exist:

| Table | Seed |
|---|---|
| `transactiontypestatus` | `DRAFT`, `SETTLED`, `CANCELLED`, `REFUNDED` |
| `transactiontype` | `POS Sale` → the sales config |
| `transactiontypebaseconversion` | `DRAFT→SETTLED` (tag `POS_SALE_SETTLE`), `SETTLED→CANCELLED`, `SETTLED→REFUNDED` |
| `paymentmode` | `Cash`, `Card`, `UPI`, `Wallet` |
| `paymentreceivedtype` | `Full`, `Partial`, `Advance` |
| `accounttypebase` | `Sales`, `Cash`, `Bank` |

---

## PART 5 — Integration design

### 5.1 What happens on settle

One transaction. Either the whole document exists or none of it does.

```
POST /api/pos/bills/:id/settle
  { Payments: [ { modeId, amount, refNo? }, … ], Discount, RoundOff? }

 1. Recompute the bill from its rounds        (already built — discount before tax)
 2. Reserve TransactionNo                     FOR UPDATE on the config counter
 3. INSERT transactiondetaillog               status = DRAFT
 4. INSERT transactionitemdetail × N          from the bill's priced line snapshots
 5. INSERT paymentdetail                      totals + discount + roundoff
 6. per tender:
      INSERT paymentmodetransactiondetail     mode + RefNo
      INSERT paymentbreakup                   amount + receivedType + account
 7. Transition log to SETTLED
      INSERT transactiontypeconversionmapper  the audit trail
      UPDATE transactiondetaillog.status
 8. UPDATE pos_bill                           Status=paid, + TransactionDetailLogId
 9. Close rounds, free the table
```

Step 4 reads the **stored** line snapshots — never live rates — consistent with
the rule already in force elsewhere.

### 5.2 One new link column

```sql
ALTER TABLE pos_bill
  ADD COLUMN TransactionDetailLogId VARCHAR(50) NULL,
  ADD CONSTRAINT fk_posbill_tdl FOREIGN KEY (TransactionDetailLogId)
      REFERENCES transactiondetaillog(Id);
```

Nullable, so bills settled before this keep working. This is what lets the POS
screen show the invoice number and lets the ledger be traced back to the till.

### 5.3 Validation the settle endpoint gains

- tendered total **must equal** payable (or exceed it, with change) — no silent
  under-settlement
- `RefNo` **required** for non-cash modes, so card/UPI stays reconcilable
- partial settlement → `paymentreceivedtype = Partial`, bill stays `unpaid`

---

## PART 6 — UI/UX

### 6.1 The settle modal today

A payment-method dropdown and a discount box. It cannot express a split tender,
capture a card reference, or show change — so it cannot drive the payment tables
at all. It needs to become a tender screen.

### 6.2 Proposed settle screen

```
┌─ Settle Bill — Table 4 ─────────────────────────────┐
│  Sub Total                              ₹ 919.97    │
│    CGST 9%                              ₹  75.00    │
│    SGST 9%                              ₹  74.99    │
│  Discount        [  30.00 ]  before tax  −₹ 30.00   │
│  Round Off                              ₹   0.04    │
│  ─────────────────────────────────────────────────  │
│  PAYABLE                                ₹1039.96    │
│                                                     │
│  Tenders                            [+ Add tender]  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Cash  ▾   ₹ 500.00                        [×] │  │
│  │ Card  ▾   ₹ 539.96   Ref [ 004521      ]  [×] │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Tendered  ₹1039.96      BALANCE DUE   ₹   0.00 ✓   │
│                                                     │
│  [ Cash exact ] [ ₹1100 ] [ ₹1500 ]                 │
│                                                     │
│           [ Settle & Print ]   [ Cancel ]           │
└─────────────────────────────────────────────────────┘
```

Design decisions and why:

- **Balance due is the hero number.** Large, red while short, green at zero.
  Cashiers work to that figure; everything else is supporting detail.
- **Tender rows, not a single dropdown.** Each row *is* one `paymentbreakup`, so
  the UI mirrors the data model exactly — no translation layer to get wrong.
- **`Ref No` appears only for non-cash modes.** Conditional fields keep the fast
  path (cash) at two taps while still capturing what reconciliation needs.
- **Quick-tender buttons** with automatic change — the single biggest speed win
  on a real till.
- **Settle disabled until balance ≤ 0**, with the reason shown rather than a
  silent disabled button.
- **Discount labelled "before tax"** — it changes the tax owed, so the behaviour
  should be visible, not surprising.

### 6.3 After settle — the invoice

The generated `TransactionNo` is the customer-facing artefact and should be the
confirmation screen's headline:

```
✓ Settled            Invoice  INV-0042
  Table 4 · 3 rounds · ₹1039.96
  Cash ₹500.00 · Card ₹539.96 (ref 004521)
                     [ Print ] [ New Order ]
```

### 6.4 Where the ledger becomes visible

- **Bill list** — show `TransactionNo` beside `BillNo`; a bill with no invoice
  number is visibly not yet in the ledger.
- **Invoice view** (new, read-only) — header, lines with per-line tax, the
  CGST/SGST footer, and the tender breakdown. This is the printable document.
- **Status chip** driven by `transactiontypestatus`, so Cancelled/Refunded read
  the same everywhere.
- **Reports** can finally aggregate from the ledger rather than from POS JSON.

---

## PART 7 — Phasing

| Phase | Scope | Schema |
|---|---|---|
| **L1** | Seed masters (§4.3); no code change | none |
| **L2** | Numbering: `CurrentCounterNo`, `UNIQUE(TransactionNo, TenantId)`, generator service + tests | 2 changes |
| **L3** | `LineNo` on `transactionitemdetail` (§4.1) | 1 change |
| **L4** | Settle writes the ledger (§5.1) behind `pos_bill.TransactionDetailLogId` | 1 change |
| **L5** | Settle UI: split tenders, balance due, ref no (§6.2) | none |
| **L6** | Invoice view + `TransactionNo` in bill list (§6.4) | none |

L1–L3 are safe and independent. L4 is the behavioural step.

---

## PART 8 — Line identity and variants on the invoice line *(decided)*

**Decision: add `LineNo`, and carry the variant detail on the line itself.**

`transactionitemdetail` today has `TaxComponents` and a free-text `Comment`, and
**nothing that records which options were sold**. So even with `LineNo`, an
invoice could show two "Masala Dosa" lines at different prices with no
explanation of why. The variant detail has to travel with the line.

```sql
ALTER TABLE transactionitemdetail
  ADD COLUMN LineNo    INT           NOT NULL DEFAULT 1  AFTER TransactionDetailLogId,
  ADD COLUMN Variants  JSON          NULL                AFTER TaxComponents,
  ADD COLUMN BasePrice DECIMAL(18,4) NULL                AFTER UnitPrice,
  ADD COLUMN VariantAmount DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER BasePrice;

-- the key moves from "one row per item" to "one row per line"
ALTER TABLE transactionitemdetail
  DROP INDEX  TransactionDetailLogId,          -- (LogId, ItemId, TenantId)
  ADD UNIQUE KEY uk_tid_log_line (TransactionDetailLogId, LineNo, TenantId);
```

Why these four columns:

- **`LineNo`** — a document is an *ordered list of lines*, not a set of items.
  Also gives print order for free.
- **`Variants` JSON** — `[{id, name, price}]` **as sold**. Names are snapshotted,
  so renaming "Large" to "Regular" next year does not rewrite an old invoice.
- **`BasePrice` / `VariantAmount`** — lets the invoice print
  `Masala Dosa 100.00 + Large 30.00 = 130.00` instead of an unexplained 130. It
  mirrors `baseAmount`/`addOnAmount` the pricing engine already returns, so this
  is a straight copy, not a new calculation.

**Honest note on the key change.** This is not a tightening. The guarantee moves
from *"an item appears at most once per document"* to *"line numbers are unique
within a document"*. Neither is strictly stronger — it is a change of intent, and
the new invariant is the correct one for a document with lines. Flagging it
explicitly because it is a deliberate departure from the never-relax-the-DB rule
rather than an oversight.

---

## PART 9 — Merging the customer *(the layering trap)*

### 9.1 The trap

The obvious move is `transactiondetaillog.CustomerId → pos_customer`. **Don't.**

I checked the direction of every cross-section foreign key:

```
POS → business domain :  4 FKs
business domain → POS :  0 FKs
```

Dependency flows **one way**. POS builds on master data; master data knows
nothing about POS. Pointing the ledger at `pos_customer` would be the first
reversal, and it makes no sense on a document that is not a POS sale — a
purchase invoice with a `pos_customer` link is nonsense.

### 9.2 There are already two "customer" concepts

| | `pos_customer` | `contactdetail` |
|---|---|---|
| Layer | POS (§4) | Business domain (§3) |
| Identity | `Name` (one field), `Phone`, `Email` | `FirstName` + `LastName` (**both NOT NULL**), `MobileNo` |
| Unique | `(Phone, TenantId)` | `(FirstName, LastName, MobileNo, TenantId)` |
| Carries | Visits, TotalSpent, LoyaltyPoints, Branch | address link, landlines |
| Used by | `pos_order`, `pos_feedback` | `branchdetail` (branch's own contact) |

`contactdetail` is already the generic party table. That is the correct target
for the ledger.

### 9.3 The merge

**`contactdetail` is the person. `pos_customer` becomes the POS-facing CRM
projection of that person.**

```sql
ALTER TABLE pos_customer
  ADD COLUMN ContactDetailId VARCHAR(50) NULL,
  ADD CONSTRAINT fk_poscust_contact
      FOREIGN KEY (ContactDetailId) REFERENCES contactdetail(Id);

ALTER TABLE transactiondetaillog
  ADD COLUMN ContactDetailId VARCHAR(50) NULL,
  ADD COLUMN CustomerName    VARCHAR(150) NULL,   -- snapshot, as at the sale
  ADD COLUMN CustomerMobile  VARCHAR(50)  NULL,   -- snapshot
  ADD CONSTRAINT fk_tdl_contact
      FOREIGN KEY (ContactDetailId) REFERENCES contactdetail(Id);
```

Resolution at settle: `pos_order.CustomerId → pos_customer.ContactDetailId → contactdetail`.

**Why FK *and* snapshot.** They answer different questions, and an invoicing
system needs both:

- the **FK** answers *"show me everything this person bought"* — CRM, analytics
- the **snapshot** answers *"what did this invoice say when we issued it"* — if a
  customer later corrects their name, a reprinted 2026 invoice must still read
  what was printed then

Every column is nullable, so walk-ins stay walk-ins: a `pos_customer` with no
contact link, a ledger row with no customer. Most covers are anonymous and
forcing a contact per sale would just manufacture junk rows.

### 9.4 Three frictions worth knowing before building this

**1. Name shape.** `pos_customer.Name` is one field; `contactdetail` needs
`FirstName` **and** `LastName`, both `NOT NULL`. A walk-in typed as "Rahul" has
no surname. Splitting on the first space and storing `LastName = ''` works
(empty string is not NULL) but is a fudge — worth deciding rather than
discovering.

**2. Promoting walk-ins would silently duplicate.** `uk_contact_name_mobile` is
`(FirstName, LastName, MobileNo, TenantId)` and **`MobileNo` is nullable**. MySQL
treats NULLs as distinct in a unique index, so every phoneless "Rahul" creates a
*new* `contactdetail` and the constraint never fires. This is finding **P1** from
the earlier constraint audit, and it lands squarely on this feature. Practical
rule: **only promote a POS customer to a `contactdetail` when a phone number
exists**, and match on phone.

**3. Identity keys disagree.** `pos_customer` is unique on phone;
`contactdetail` on name+mobile. Someone who changes their number is a new POS
customer but may match an existing contact. Proposed canonical rule: **phone is
identity**; name is descriptive.

### 9.5 Suggested flow

```
Walk-in            → no pos_customer, no ledger customer
Phone captured     → pos_customer created (unique on phone)
Settle with phone  → find-or-create contactdetail BY MOBILE
                     link pos_customer.ContactDetailId
                     stamp ledger ContactDetailId + name/mobile snapshot
Loyalty            → stays on pos_customer (POS concern)
Sales history      → query the ledger by ContactDetailId (accounting concern)
```

Each side keeps what it is good at: POS owns loyalty and visit counts, the ledger
owns what was sold and to whom.

### 9.6 Phasing addition

| Phase | Scope | Schema |
|---|---|---|
| **L3** | `LineNo` + `Variants` + `BasePrice`/`VariantAmount` on `transactionitemdetail`, key change | §8 |
| **L4a** | `pos_customer.ContactDetailId` + find-or-create-by-mobile service | §9.3 |
| **L4b** | Ledger customer columns; settle stamps FK + snapshot | §9.3 |

---

## PART 10 — Decisions needed

~~1. line uniqueness~~ — **decided**, see §8: `LineNo` + variant detail on the line.
~~3. customer~~ — **decided**, see §9: via `contactdetail`, FK + snapshot.

Still open:

2. **§4.2 numbering** — add `CurrentCounterNo` + unique `TransactionNo`, or reuse `pos_bill.BillNo` as the invoice number (no gap-free sequence)?
4. **T3 document type** — add `TransactionTypeId` to `transactiondetaillog` so Sale/Purchase is readable from the header, or infer from the config?
5. **Partial settlement** — support it in v1 (bill stays open until fully tendered), or require full payment?
6. **Walk-in promotion (§9.4)** — confirm "only create a `contactdetail` when a phone number exists". Without this rule, phoneless customers duplicate silently.
7. **Scope check** — is the goal a *reconcilable accounting ledger* (all of the above), or just "settle writes a row somewhere"? That changes L4 substantially.
