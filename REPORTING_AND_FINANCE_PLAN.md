# Finance, Operations & Reporting — Integrated Plan

Extends [LEDGER_SOURCE_OF_TRUTH_PLAN.md](LEDGER_SOURCE_OF_TRUTH_PLAN.md). That
plan makes the transaction + payment tables the authority for **sales**. This one
extends the same authority to **expenses, cash flow and assets**, and builds one
reporting engine on top of it.

Architectural rule, unchanged from before: **the ledger records money, the POS
records operations, and master data is referenced by both — never duplicated.**

---

## PART A — Capability audit

| Capability | Today | Gap |
|---|---|---|
| Ledger / accounts | `accounttypebase` exists; every payment row hardcoded to `Sales` ([ledger.service.js:120](src/modules/ledger/ledger.service.js#L120)) | No account attribution, no balances |
| Daily cash flow | — | No money-out in the ledger, no opening float, no day close |
| Order lifecycle | `pos_order` → `pos_kot` → `pos_bill` → document | Complete |
| Expenses | `pos_expense` CRUD, free-text `Category` | No master, no account, no payment mode, no ledger link |
| Assets | — | Does not exist |
| Reporting | one endpoint, `days` param only | No ranges, buckets, weekend, branch, product |
| Product analytics | `transactionitemdetail` has qty + amounts | No per-line discount column; no pending metric |
| Performance | **no indexes on any business table** | Every report is a table scan |

---

## PART B — Master data: the structure and the contract

### B.1 The masters

| Domain | Table | Consumed by |
|---|---|---|
| Catalogue | `itemdetail`, `categorydetail`, `UOM`, `uomfactor` | POS menu, order lines, ledger lines, product analytics |
| Pricing & tax | `costinfo`, `taxgroup`, `taxgrouptaxtypemapper`, `TaxTypes` | Pricing engine → order snapshot → ledger line |
| Organisation | `organizationdetail`, `branchdetail`, `locationdetail`, `addressdetail` | Every scoped table, branch-wise reporting |
| Party | `contactdetail`, `contactaddresstype` | Ledger customer, `pos_customer` merge target |
| Document control | `transactiontypeconfig`, `transactiontype`, `transactiontypestatus`, `transactiontypebaseconversion` | Numbering + state machine for every document type |
| Money | `accounttypebase`, `paymentmode`, `paymentreceivedtype` | Payment attribution, tender reports, cash flow |
| POS structure | `pos_floor`, `pos_table`, `pos_channel`, `pos_variant`, `pos_food_type`, `pos_item_meta` | Floor ops; `pos_item_meta.ItemDetailId` is the bridge to `itemdetail` |

### B.2 The three integration rules

1. **Reference, never copy.** A module stores the master's `Id`. `pos_item_meta`
   is the canonical example: it adds POS-only attributes (food type, channels,
   variants) and points at `itemdetail` rather than restating it.
2. **Snapshot at the moment of truth.** When a document is issued, the *values*
   are frozen onto it (`transactionitemdetail.UnitPrice`, `.TaxComponents`,
   `.Variants`, `transactiondetaillog.CustomerName`). Renaming an item or changing
   a tax rate must never rewrite an issued invoice. Reports over history read
   snapshots; reports over the catalogue read masters.
3. **Provision per tenant, at bootstrap.** [posMasters.provision.js](src/modules/mastersetup/posMasters.provision.js)
   is the pattern — idempotent get-or-create by name on the caller's transaction.
   Every new master added below extends this file, not the seed SQL alone.

### B.3 New masters this plan introduces

| Master | Why it must be a master, not free text |
|---|---|
| `expense_category` | `pos_expense.Category` is VARCHAR(100) today, so "Gas", "gas", "LPG" are three categories and no expense report can group reliably |
| `asset_category` | Same reasoning for the asset register |
| `accounttypebase` **used properly** | Already exists; needs a `Kind` discriminator (ASSET/LIABILITY/INCOME/EXPENSE) so cash flow can classify without name matching |

---

## PART C — Closing the five capability gaps

### C.1 Account attribution — make `accounttypebase` real

**Problem.** Every tender is booked to `Sales`, so no account has a meaning.

**Change.** Map payment mode → account and stamp it per breakup:

- `paymentdetail.AccountTypeBaseId` = the **income** account (`Sales`) — what was
  earned.
- `paymentbreakup.AccountTypeBaseId` = the **asset** account the money landed in,
  derived from the tender: Cash → `Cash`, Card/UPI → `Bank`, Wallet → `Wallet`.

That single change turns `paymentbreakup` into a genuine cash/bank movement log
and makes account balances a `GROUP BY AccountTypeBaseId`.

Add `accounttypebase.Kind ENUM('ASSET','LIABILITY','INCOME','EXPENSE')` plus a
`paymentmode.DefaultAccountTypeBaseId` FK so the mapping is data, not code.

*Not proposed:* full double-entry with balanced journal lines. It is a
substantially larger build and this model answers every question in the brief.
Flagged as the upgrade path if statutory books are ever needed.

*Files:* schema (2 columns), `posMasters.provision.js`, `ledger.service.js`,
`02-seed-data.sql`.

### C.2 Expenses become ledger documents

**Problem.** `pos_expense` is a side table. Money out is invisible to the ledger,
so "cash flow" cannot exist.

**Change.** An expense posts a document exactly the way a sale does, reusing the
whole machinery:

```
pos_expense  ──posts──►  transactiondetaillog   (TransactionTypeId = 'Expense')
                            └── paymentdetail    (AccountTypeBaseId = expense account)
                                  └── paymentbreakup  (Amount NEGATIVE — money out,
                                        attributed to Cash / Bank per tender)
```

- New `transactiontype` **Expense** with its own `transactiontypeconfig`
  (separate number series, e.g. `EXP/2026/0001`).
- New statuses reuse `DRAFT → SETTLED`; the same transition whitelist applies.
- `pos_expense` gains `TransactionDetailLogId`, `ExpenseCategoryId` (FK to the new
  master), `PaymentModeId`, and the same immutability guard as `pos_bill`.
- Expenses have no `transactionitemdetail` lines — the category is the analysis
  axis. This is deliberate and keeps product analytics clean.

*Files:* schema (`expense_category` table + 3 columns on `pos_expense`),
`posexpense.service.js`, `ledger.service.js` (`postExpense`), provisioner, seeds.

### C.3 Daily cash flow — the day-close

**Problem.** Even with C.1 + C.2, there is no opening float and no reconciliation
of counted cash against expected cash.

**Change.** New `pos_cash_session` (per branch, per day/shift):

| Column | Purpose |
|---|---|
| `OpeningFloat` | Cash in the drawer at open |
| `OpenedAt` / `ClosedAt`, `OpenedBy` / `ClosedBy` | Accountability |
| `CountedCash` | What the till actually held at close |
| `ExpectedCash` | Computed: float + cash sales − cash expenses − refunds |
| `Variance` | `Counted − Expected`, the number a manager must explain |
| `Status` | `open` / `closed`; closed is immutable |

`GET /api/ledger/reports/cashflow?from&to&branchId` returns, per account:
opening, inflow (positive breakups), outflow (negative breakups), closing —
straight from `paymentbreakup` joined to `accounttypebase`. Because expenses are
now breakups too, in − out is one query over one table.

*Files:* schema (1 table), new `poscashsession` module (routes/service/schemas
following the controller-as-array pattern), report service.

### C.4 Asset register

**Assumption flagged for confirmation.** "Asset/Aspect" is read here as a
**fixed-asset / equipment register** (fryer, POS terminal, furniture) tied to a
branch. If what was meant is *structural operational data* (floors, tables, menu
structure), that already exists as the `pos_*` masters and needs no new build —
say so and this section drops out.

New `asset` table: `Name`, `AssetCategoryId` (master), `BranchDetailId`,
`PurchaseDate`, `PurchaseCost`, `SupplierContactDetailId`, `SerialNo`,
`Status` (in-use / under-repair / retired), `TransactionDetailLogId` (nullable —
links to the purchase document when the asset was bought through the system).

Depreciation is explicitly **out of scope** for v1; it needs a schedule table and
periodic posting, and nothing in the brief requires it.

*Files:* schema (2 tables), new `asset` module, provisioner entry.

---

## PART D — The reporting engine

### D.1 One resolver, not six endpoints

Every requested timeframe is the same query with different bounds. Build a single
`utils/dateRange.js`:

```js
resolveRange({ preset, fromDate, toDate, bucket })
// presets: today | yesterday | last3 | last5 | week | month | weekend | custom
// returns { from, to, bucket: 'day'|'week'|'month', weekendOnly: bool }
```

- **Daily / last 3 / last 5** — `from = CURDATE() - INTERVAL n DAY`.
- **Weekly / monthly** — same bounds, `bucket` changes the `GROUP BY`
  (`DATE(d)` / `YEARWEEK(d)` / `DATE_FORMAT(d,'%Y-%m')`).
- **Weekend-specific** — the same range plus `WEEKDAY(l.TransactionDate) IN (5,6)`.
  A flag on the range, not a separate report.
- **Custom** — `fromDate`/`toDate` validated as ISO dates, `to >= from`, span
  capped (suggest 366 days) so no request can scan the whole history.

Every report endpoint takes the same query contract:
`?preset|fromDate&toDate&bucket&branchId&categoryId&itemId`. One Joi schema,
reused. This is what stops the endpoint count from exploding.

### D.2 The report set

| Endpoint | Source of truth | Answers |
|---|---|---|
| `GET /api/ledger/reports/sales` | `transactiondetaillog` | Invoiced, collected, outstanding, discount, tax, round-off; bucketed trend |
| `GET /api/ledger/reports/products` | `transactionitemdetail` ⋈ `itemdetail` ⋈ `categorydetail` | Qty sold, revenue, **discount per product**, tax, avg unit price; ranked |
| `GET /api/ledger/reports/pending` | `pos_order` (unbilled) + `transactiondetaillog` vs `paymentdetail` (unpaid) | Pending volume and value, per product and per document |
| `GET /api/ledger/reports/tenders` | `paymentbreakup` ⋈ `paymentmode` | Cash / card / UPI mix, refunds netted — the Z-report |
| `GET /api/ledger/reports/cashflow` | `paymentbreakup` ⋈ `accounttypebase` | In / out / closing per account |
| `GET /api/ledger/reports/expenses` | `transactiondetaillog` (Expense) ⋈ `expense_category` | Spend by category, bucketed |
| `GET /api/pos/reports` (existing) | POS tables | Operational only: orders, KOTs, table occupancy, feedback |

The last row matters: **operational metrics stay on POS tables, financial metrics
move to the ledger.** Mixing them is what produced the current broken revenue KPI.

### D.3 Product-level discount — the one schema change analytics needs

`transactionitemdetail` gains `DiscountAmount DECIMAL(18,4) NOT NULL DEFAULT 0`.
The pricing engine already computes it per line
([pricing.service.js:149](src/modules/pricing/pricing.service.js#L149)) and
currently discards it. Persist it, and "discount per product" becomes
`SUM(DiscountAmount) GROUP BY ItemId` instead of an error-prone derivation from
`UnitPrice × Quantity − NetAmount`.

Invariant to test: `Σ line.DiscountAmount = log.DiscountAmount`.

### D.4 Pending — define it before building it

Two distinct questions, two queries, both exposed:

- **Unbilled** — `pos_order` rows with no `pos_bill_order` row, or bill unsettled.
  Product-level: expand the order's `Items` JSON. Operational; POS is the source.
- **Unpaid** — `log.GrossAmount − COALESCE(Σ paymentdetail.TotalAmount, 0) > 0`,
  i.e. `PARTIALLY_PAID` documents. Financial; ledger is the source.

---

## PART E — Performance

### E.1 Indexes (do this first — it is the whole difference)

There is currently **not one index** on a business table beyond PK/UNIQUE/FK.
Every report above filters tenant + date.

```sql
-- financial
CREATE INDEX idx_tdl_tenant_date    ON transactiondetaillog (TenantId, TransactionDate, TransactionTypeStatusId);
CREATE INDEX idx_tdl_tenant_branch  ON transactiondetaillog (TenantId, BranchId, TransactionDate);
CREATE INDEX idx_tdl_tenant_type    ON transactiondetaillog (TenantId, TransactionTypeId, TransactionDate);
CREATE INDEX idx_tid_tenant_item    ON transactionitemdetail (TenantId, ItemId);
CREATE INDEX idx_pb_tenant_ts       ON paymentbreakup (TenantId, Timestamp);
-- operational
CREATE INDEX idx_posorder_tenant    ON pos_order (TenantId, Status, CreatedOn);
CREATE INDEX idx_posbill_tenant     ON pos_bill (TenantId, Status, SettledAt);
CREATE INDEX idx_posexp_tenant_date ON pos_expense (TenantId, ExpenseDate);
```

FK columns already carry an InnoDB index, so the join paths
(`TransactionDetailLogId`, `PaymentDetailId`) are covered.

### E.2 Query discipline

- Aggregate in SQL, never in Node. No `SELECT *` then `.reduce()` over a range.
- Every range endpoint is capped and paginated; product rankings default to
  `LIMIT 50` with `ORDER BY` on the aggregate.
- Reuse the `calculatePagination` helper already in `utils/paginationHelper`.
- Cache nothing until measured — the indexes above make a single restaurant's
  year (~10⁵ documents) an index-range scan of milliseconds.

### E.3 Rollups — designed, deliberately deferred

If volume reaches millions of lines (multi-branch chains, multi-year custom
ranges), add `report_daily_sales(TenantId, BranchId, Date, ItemId, Qty, Net, Tax,
Discount, Gross)` refreshed nightly, with today served live and history from the
rollup. **Do not build this now** — build the indexes, measure with realistic
data, and add rollups only if a real query is slow. Premature rollups introduce a
second source of truth, which is exactly what this plan exists to remove.

---

## PART F — Sequencing

Runs after S1–S2 of the source-of-truth plan (status vocabulary + write-path
holes), which are prerequisites.

| Phase | Scope | Schema | Risk |
|---|---|---|---|
| **F1** | Indexes (E.1) | 8 indexes | none — pure win, do immediately |
| **F2** | `dateRange` resolver + shared query schema (D.1) | none | none |
| **F3** | Sales + product + pending reports on the ledger (D.2, D.4); retire the broken POS revenue query | none | low |
| **F4** | `transactionitemdetail.DiscountAmount` (D.3) + persist it in the settle path | 1 column | low |
| **F5** | Account attribution: `Kind`, `paymentmode.DefaultAccountTypeBaseId`, correct stamping (C.1) | 2 columns | medium — changes what existing rows mean; backfill needed |
| **F6** | Expense category master + expenses post documents (C.2) | 1 table, 3 columns | medium |
| **F7** | Tender + cash flow + expense reports (D.2) | none | low |
| **F8** | `pos_cash_session` + day close (C.3) | 1 table | medium |
| **F9** | Asset register (C.4) — **pending confirmation of intent** | 2 tables | low |

F1–F4 are additive and independently shippable. **F5 is the pivot** — it changes
the meaning of existing `paymentbreakup` rows and needs a backfill that maps
historic tenders to their proper accounts.

## Open decisions

1. **Assets** — fixed-asset register, or the existing `pos_*` structural masters?
   Materially different builds (C.4).
2. **Double-entry** — the account-attribution model in C.1 answers everything in
   the brief. Confirm statutory books are not a requirement, or F5 grows
   substantially.
3. **Cash session granularity** — per day, or per shift/cashier? Affects
   `pos_cash_session`'s unique key and the variance workflow.
4. **Expense approval** — do expenses need an approval step before posting
   (`DRAFT → APPROVED → SETTLED`), or does recording one post it immediately?
