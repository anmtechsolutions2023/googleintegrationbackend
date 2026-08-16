# Making the transaction & payment tables the source of truth

**Goal.** `transactiondetaillog` + `transactionitemdetail` + `paymentdetail` +
`paymentbreakup` + `paymentmodetransactiondetail` become the *only* authority for
what was sold, what it cost, and what was collected. `pos_bill` / `pos_order`
remain the **operational** record (which table, which round, which KOT) and their
money columns become a **derived cache**, never a second truth.

The test of success: delete every money column on `pos_bill` and no report,
screen, or reprint changes its answer.

---

## Current state — validated

The **write** path is correct: `settle` posts a full document in one transaction
([posbill.service.js:119](src/modules/posbill/posbill.service.js#L119) →
[ledger.service.js:101](src/modules/ledger/ledger.service.js#L101)), with gap-free
numbering, snapshot lines, one `paymentbreakup` per tender, whitelisted status
transitions and a `pos_bill.TransactionDetailLogId` idempotency guard.

The **read** path does not exist outside `/api/ledger/*`. Everything else still
reads `pos_bill`. Five write-path holes let the two diverge.

### Divergence points

| Id | Problem | Consequence |
|---|---|---|
| W1 | Settle posts to the ledger **only** when the bill has linked orders ([posbill.service.js:120](src/modules/posbill/posbill.service.js#L120)); otherwise it still writes `Status='paid'` | Money in POS, absent from the ledger. Also bypasses the 409 guard → repeatable settle |
| W2 | Unresolvable lines are skipped ([ledger.service.js:151](src/modules/ledger/ledger.service.js#L151)) | Header total ≠ `Σ` line totals |
| W3 | `PUT /api/pos/bills/:id` rewrites `Total`/`Payments`/`Status` post-posting, unguarded | Bill contradicts its own invoice |
| W4 | Refund never updates `pos_bill` | POS `paid`, ledger `REFUNDED` |
| W5 | `DELETE /api/pos/bills/:id` on a posted bill orphans the document | No route from document back to the sale |
| R1 | Reports read `pos_bill` filtered on `Status='Settled'`, a value nothing writes ([posreport.service.js:26](src/modules/posreport/posreport.service.js#L26)) | **Revenue KPI and trend are always 0** |
| R2 | No tender-mix / day-close report from `paymentbreakup` | Cash-up is done outside the system |
| R3 | Bill list & reprint use `pos_bill` + `Payments` JSON; no `TransactionNo` | Two versions of one bill |
| R4 | Ledger screens can't show `BillNo`/table | Accountant can't reconcile to the floor |
| D1 | `pos_bill.SubTotal/TaxAmount/Discount/Total/Payments/SettledAt` duplicate the document | Two truths by construction |

---

## Phase S1 — Stop the bleeding (no schema change)

Independently shippable; fixes a live bug.

1. **Bill status vocabulary.** Add `POS_BILL_STATUS = { UNPAID:'unpaid',
   PARTIALLY_PAID:'partially_paid', PAID:'paid', REFUNDED:'refunded',
   VOID:'void' }` to `src/config/constants.js`. Replace the string literals in
   [posbill.service.js:142](src/modules/posbill/posbill.service.js#L142) and the
   Joi enum in `posbill.schemas.js`.
2. **Fix the report filter.** `posreport.service.js` lines 26 and 60 —
   `Status='Settled'` → the constant. This alone restores the revenue KPI.
3. **Regression test.** `settle → getSummary` returns non-zero revenue. This is
   the test that was missing and let the mismatch ship.

*Files:* `src/config/constants.js`, `src/modules/posbill/posbill.service.js`,
`src/modules/posbill/posbill.schemas.js`,
`src/modules/posreport/posreport.service.js`,
`src/__tests__/modules/posreport.service.test.js` (new).

---

## Phase S2 — Close the write-path holes

No document may be optional, editable, or deletable behind the ledger's back.

### S2.1 Every settle posts a document (W1)

In `settle`, replace the `if (recomputed)` branch with a hard requirement:

- `recomputed === null` (no linked orders / no lines) → `400`
  `BILL_NOT_POSTABLE` ("this bill has no priced lines and cannot be settled").
- Remove the `posted ? posted.payable : total` fallback — the payable is always
  the document's rounded gross.
- Move the double-settle check *before* re-pricing so an already-posted bill 409s
  regardless of its lines.

**Migration concern:** bills created before `pos_bill_order` shipped have no
rounds. Write a one-off backfill that populates `pos_bill_order` from
`pos_bill.OrderId` where missing, and *leave already-settled legacy bills alone*
(historic, not re-postable).

*Files:* `posbill.service.js`, `config/messages.js`, `scripts/backfill-bill-orders.js` (new).

### S2.2 A line that cannot be posted fails the settle (W2)

Replace the `continue` in `ledger.service.js:151` with a thrown
`LEDGER_LINE_UNPOSTABLE` (400) naming the item. Silent omission is the one
outcome a ledger must never have. Add an explicit assertion after the line loop:
`Σ line.grossAmount` reconciles to `totals.Total` within 1 paisa, else throw.

*Files:* `ledger.service.js`, `config/messages.js`, `ledger.service.test.js`.

### S2.3 Guard the bill against post-hoc edits (W3, W5)

Add `assertBillMutable(billId, tenantId)` to `posbill.service.js` — 409 when
`TransactionDetailLogId IS NOT NULL`. Apply to `update` and `delete`. A settled
bill is corrected by refund only.

Narrow exception: allow updating operational-only fields (`BranchDetailId`,
`Active`) via an allowlist, reject any money/status field.

*Files:* `posbill.service.js`, `posbill.routes.js`, new tests.

### S2.4 Refund propagates to the bill (W4)

`refundSale` currently returns without touching POS. Have the refund controller,
inside the same transaction, update the linked bill to
`Status='refunded'`. Look the bill up by `TransactionDetailLogId` (already a FK,
so it is indexed).

*Files:* `ledger.service.js` (refundSale takes the bill update),
`ledger.controller.js`, `constants.js` (query), tests.

---

## Phase S3 — Read from the ledger

This is the phase that actually makes the ledger the source of truth.

### S3.1 Reports move to `transactiondetaillog` (R1)

Rewrite `posreport.service.js` revenue queries:

```sql
-- today's revenue: what was INVOICED and settled, not what a POS row remembers
SELECT COALESCE(SUM(l.GrossAmount),0)
  FROM transactiondetaillog l
  JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
 WHERE l.TenantId = ? AND s.Name = 'SETTLED' AND l.TransactionDate = CURDATE()
```

Same shape for the N-day trend (`GROUP BY l.TransactionDate`). Order counts,
KOTs, tables and feedback stay on the POS tables — those are operational, not
financial. Partial payments must be reported from `paymentdetail.TotalAmount`
(collected), *separately* from `GrossAmount` (invoiced); the KPI row gains
"Invoiced / Collected / Outstanding".

### S3.2 Tender mix & day close (R2) — new

`GET /api/ledger/reports/tenders?fromDate&toDate` reading
`paymentbreakup` ⋈ `paymentmodetransactiondetail` ⋈ `paymentmode`, grouped by
mode, with refunds (negative amounts) netted. This is the cash-up report and it
has no POS equivalent, so it is pure gain.

Invariant to assert in tests: `Σ paymentbreakup.Amount` per document =
`paymentdetail.TotalAmount`.

*Files:* new `ledger.report.service.js`, `ledger.routes.js`, `constants.js`.

### S3.3 Bill list and reprint show the document (R3)

- `POS_BILL.SELECT_ALL` gains a `LEFT JOIN transactiondetaillog` for
  `TransactionNo` and the ledger status.
- Frontend `Billing.js` bill list: show `TransactionNo` as the primary
  identifier, `BillNo` secondary; badge unposted bills.
- Reprint/invoice view fetches `GET /api/ledger/documents/:id` instead of
  rendering from `pos_bill.Payments`. The `Ledger.js` detail view already renders
  exactly this shape — reuse it rather than building a second renderer.

*Files:* `config/constants.js`, `posbill.repository.js`,
frontend `Billing.js`, `posService.js`.

### S3.4 Ledger shows the floor context (R4)

`SELECT_LOG_LIST` / `SELECT_LOG_FULL` gain
`LEFT JOIN pos_bill pb ON pb.TransactionDetailLogId = l.Id` for `BillNo`, and
through it table/order. No schema change — the FK index exists.

*Files:* `config/constants.js`, `ledger.read.service.js`, frontend `Ledger.js`.

---

## Phase S4 — Demote the POS money columns (D1)

Only after S3, when nothing reads them for financial answers.

1. Keep the columns (fast list rendering, offline reprint) but document them in
   the schema file as **cache, not truth**, with the ledger named as the
   authority.
2. Add a reconciliation check — a script or `/api/ledger/reports/reconcile` — that
   reports any settled bill where `pos_bill.Total ≠ transactiondetaillog.GrossAmount`
   or `Status` disagrees with the document status. Expected result: empty.
3. Optionally stop writing `pos_bill.Payments` on settle (the tenders live in
   `paymentbreakup`); keep reading it only for legacy rows.

---

## Schema changes required

**None.** Every join in this plan runs on existing keys:
`pos_bill.TransactionDetailLogId` (FK, indexed) both ways,
`transactiondetaillog.TransactionTypeStatusId`, `paymentdetail.TransactionDetailLogId`.

Still outstanding from the earlier plan and unchanged by this one: the ALTER
script for existing databases, the ledger-master backfill for tenants
provisioned before `posMasters.provision.js`, and splitting POS Sale off the
`Onboarding` numbering config.

---

## Sequencing

| Phase | Ships | Risk | Behaviour change |
|---|---|---|---|
| S1 | Status vocabulary + report filter fix | none | Revenue KPI stops being 0 |
| S2 | Write-path holes closed | medium — settle can now 400 | Yes: unpostable bills rejected |
| S3 | Reports/lists/reprints read the ledger | low | Numbers become the ledger's |
| S4 | POS money demoted to cache + reconciler | low | none |

S1 is independent and should go first. S2 needs the `pos_bill_order` backfill
run before it, or legacy bills start failing to settle.

## Tests this must add

- settle → `getSummary` revenue is non-zero and equals `GrossAmount` (S1)
- settle on a bill with no rounds → 400, no ledger row, bill still unpaid (S2.1)
- an unresolvable line → 400, whole settle rolled back (S2.2)
- `PUT`/`DELETE` on a posted bill → 409 (S2.3)
- refund → both document REFUNDED **and** bill `refunded` (S2.4)
- revenue from the ledger ≠ affected by editing `pos_bill.Total` directly (S3.1)
- tender report sums to `paymentdetail.TotalAmount`, refunds netted (S3.2)
- reconciler returns empty after a normal settle (S4)
