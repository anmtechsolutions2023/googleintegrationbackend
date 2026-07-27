# Tax & Pricing Engine — Detailed Implementation Plan

Companion to `TAX_ENGINE_DESIGN.md` (concept + settled policy). This is the
build plan, after a second, deeper audit.

**Answering "are you confident you covered all?" — honestly, no.** The first pass
missed four things. They are in §1, and two of them change the plan materially.

---

## 1. What the re-audit found

### 1.1 `batchdetail` is already fully priceable — I missed it

```sql
batchdetail: CostInfoId → costinfo   +   Quantity   +   UOMId
```

It is the **only** non-POS table that already has everything needed for line
pricing (a cost link *and* a quantity). It belongs in Phase 2, not in the
"blocked" bucket where I implicitly left it.

### 1.2 POS needs **no schema change** to be repriced — better news than I said

`pos_order.Items` JSON is:

```js
{ id, name, price, qty, taxPct }   // id = pos_item_meta.Id
```

Because `id` is the item-meta id, the server can walk
`pos_item_meta → CostInfoId → taxgroup → mapper → TaxTypes` for every line with
no new columns. I had implied POS pricing was blocked; it is not.

Also: `itemPrice()` in `Billing.js` **already** prefers `CostInfoAmount` over the
legacy `Prices` JSON. So the *price* is already right — only `taxPct()` is broken,
because it reads the legacy JSON exclusively and returns `0`. The bug is narrower
than "POS pricing is wrong": it is precisely "POS tax is always 0".

### 1.3 A bill is a **session aggregate**, not one order — this breaks my Phase 3

`handleSettleBill` sums every round of a table's session, then writes one bill:

```js
const sessSub = sessionRounds.reduce((s, r) => s + Number(r.order.SubTotal), 0)
…
createBill({ OrderId: sessionRounds[0].orderId, SubTotal: sessSub, … })
```

`pos_bill.OrderId` records only the **first** round. A bill covering rounds 1–4
keeps a pointer to round 1 alone, so **the server cannot recompute a bill from its
own foreign key.** Server-authoritative billing is impossible until the bill knows
all its orders. See §5.1.

### 1.4 The current discount flow contradicts the settled policy

Settled policy (design §6.2) is *discount before tax*. The code does the opposite:

```js
const payable = Math.max(0, sessTot - discount)   // discount off the GROSS
```

Tax has already been computed and baked into `sessTot` before the discount is
subtracted. Adopting the settled policy is therefore a **real change in the tax
owed**, not just a refactor. It must be a conscious, announced change.

### 1.5 Bonus: `paymentbreakup` cannot record a split payment

Columns are `Id, AccountTypeBaseId, PaymentDetailId,
PaymentModeTransactionDetailId, PaymentReceivedTypeId, UserId, Timestamp,
TenantId, Active` + audit. **There is no Amount column.** "₹500 cash + ₹300 card"
has nowhere to store 500 and 300. Out of scope for tax, but it blocks any real
"final bill" settlement story, so flagging it now.

---

## 2. Corrected consumer map

| Consumer | Cost link | Quantity | Priceable today? |
|---|---|---|---|
| `costinfo` | — (is the source) | n/a | ✅ the atom |
| `itemdetail` | `CostInfoId` | n/a (unit price) | ✅ unit-level |
| `pos_item_meta` | via item | n/a (unit price) | ✅ unit-level |
| `batchdetail` | `CostInfoId` | `Quantity` | ✅ **line-level** |
| `pos_order` / `pos_kot` | via `Items[].id` → item-meta | `Items[].qty` | ✅ line-level, no schema change |
| `pos_bill` | via its orders | via orders | ⚠️ **blocked** — see §1.3 |
| `transactionitemdetail` | via `ItemId` → itemdetail | ❌ **none** | ❌ blocked — needs `Quantity` |
| `paymentdetail` | — | — | ✅ once its log's lines are priceable |

---

## 3. A rule that governs everything: **snapshot on write, never recompute on read**

Prices and tax rates change. An order placed in March at 12% GST must still show
12% in December.

So:
- Pricing is computed **at write time** and the result is **stored**.
- `GET` endpoints return stored values; they never re-run the engine over
  historical rows.
- The only exception is `POST /api/pricing/quote`, which is explicitly a
  "what would this cost right now" endpoint and stores nothing.

This is why Phase 2 (adding breakdowns to `expand`) is safe: those are *current*
master-data reads, not historical documents. And it is why Phase 3 must compute
totals in the create/settle handlers rather than in a read hook.

---

## 4. Phase 1 — the engine (no behaviour change anywhere)

### 4.1 `src/utils/taxCalculator.js` — pure, no DB, no imports

```js
computeTax({ amount, isTaxIncluded, components, quantity = 1, discount = null })
allocate(totalMinorUnits, weights)   // largest-remainder
toMinor(value) / fromMinor(units) / parseMoney(str)
```

Contract:
- All arithmetic in **integer minor units (paise)**. No float ever touches money.
- **Exclusive**: `net = amount`, `tax = net × Σrate/100`, `gross = net + tax`
- **Inclusive**: `gross = amount`, `net = gross ÷ (1 + Σrate/100)`, `tax = gross − net`
- `net` and `tax` are reconciled to `gross` — never rounded independently.
- Components allocated by largest remainder so `Σcomponents === tax` exactly.
- Discount applied **before** tax. For an inclusive price, the discount comes off
  the gross first and net is re-derived from the discounted gross.
- Empty/zero component list → `tax = 0` (a valid "Exempt" group, not an error).

### 4.2 `src/modules/pricing/pricing.repository.js`

One batched, tenant-scoped, `Active`-filtered query:

```sql
SELECT ci.Id AS CostInfoId, ci.Amount, ci.IsTaxIncluded,
       tg.Id AS TaxGroupId, tg.Name AS TaxGroupName,
       tt.Id AS TaxTypeId, tt.Name AS TaxTypeName, tt.Value AS TaxTypeValue
FROM costinfo ci
LEFT JOIN taxgroup tg
       ON tg.Id = ci.TaxGroupId AND tg.TenantId = ci.TenantId AND tg.Active = 1
LEFT JOIN taxgrouptaxtypemapper tgm
       ON tgm.TaxGroupId = tg.Id AND tgm.TenantId = ci.TenantId AND tgm.Active = 1
LEFT JOIN TaxTypes tt
       ON tt.Id = tgm.TaxTypeId AND tt.TenantId = ci.TenantId AND tt.Active = 1
WHERE ci.TenantId = ? AND ci.Id IN (?)
```

Repository, not service — same reasoning as `mastersetup.repository.js`: several
modules need it and none should drag in a CRUD service to get it.

### 4.3 `src/modules/pricing/pricing.service.js`

| Function | Returns |
|---|---|
| `priceCostInfos(ids[], tenantId)` | `Map<costInfoId, breakdown>` |
| `priceLines(lines[], tenantId)` | per-line breakdowns + document totals + `taxByComponent` |
| `getTaxGroupRate(groupId, tenantId)` | effective rate + components, for UI |

`priceLines` is the only place that applies: discount-first → per-line rounding →
sum. A **document-level** discount is apportioned across lines with the same
`allocate()` helper before tax, so the parts always sum to the whole.

### 4.4 `POST /api/pricing/quote`

Stateless. Body: `{ lines: [{ costInfoId, quantity, discount? }], discount? }`.
Scope-gated on an existing read scope; stores nothing. This is what lets you
verify the numbers before anything depends on them.

### 4.5 Tests — the point of Phase 1

- inclusive vs exclusive, 1 / 2 / 3 components
- **the 100.00 @ CGST9+SGST9 case** → `7.63 + 7.62 = 15.25`
- components always sum to total (property test over random rates/amounts)
- discount before tax, both inclusive and exclusive
- document discount apportioned across lines sums exactly
- zero-rate group, empty group, inactive type excluded
- `VARCHAR` inputs: `"120"`, `"120.00"`, `" 120 "`, `null`, `""`, `"abc"`
- batching: N cost infos → exactly 1 query

---

## 5. Phase 3 — POS KOT → Bill (the part you asked for)

This is where the real work is, and it needs two structural fixes first.

### 5.1 Blocker: link a bill to all its orders

Proposed — a join table, matching the existing `pos_item_meta_channel` pattern:

```sql
CREATE TABLE pos_bill_order (
    Id        VARCHAR(50) NOT NULL,
    BillId    VARCHAR(50) NOT NULL,
    OrderId   VARCHAR(50) NOT NULL,
    TenantId  VARCHAR(50) NOT NULL,
    Active    TINYINT(1)  NOT NULL DEFAULT 1,
    CreatedOn DATETIME, CreatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (BillId, OrderId, TenantId),
    FOREIGN KEY (BillId)  REFERENCES pos_bill(Id) ON DELETE CASCADE,
    FOREIGN KEY (OrderId) REFERENCES pos_order(Id)
);
```

`pos_bill.OrderId` stays (back-compat, = first/primary order); the join table
becomes the truth. Then a bill can be recomputed from its own rows.

### 5.2 The flow, end to end

```
1. Add to cart            → client, display only
2. Create order (round)   → POST /api/pos/orders
                            server prices Items[] via pricing.priceLines()
                            stores SubTotal / TaxAmount / Total  ← authoritative
                            stores per-line tax snapshot INTO Items[] JSON
3. Fire KOT               → copies order.Items (already priced) — no change needed
4. Kitchen marks ready    → no pricing involvement
5. Settle                 → POST /api/pos/bills  (OrderIds[], Discount)
                            server re-reads the orders' STORED line snapshots,
                            applies document discount BEFORE tax,
                            recomputes SubTotal / TaxAmount / Total,
                            writes pos_bill_order rows
6. Bill view / print      → GET /api/pos/bills/:id?expand=true
                            returns stored totals + taxByComponent footer
```

Step 5 is the subtle one: the bill re-derives from the orders' **stored** line
snapshots, not from live `costinfo`. A price change between ordering and settling
must not alter the bill.

### 5.3 Extended `Items[]` line snapshot

Additive — existing keys keep their meaning:

```js
{
  id, name, price, qty,          // unchanged
  taxPct,                        // kept, now = effective rate (back-compat)
  costInfoId,                    // NEW — what was priced
  netAmount, taxAmount, grossAmount,   // NEW — line snapshot
  taxComponents: [{ name, rate, amount }],  // NEW — CGST/SGST split
}
```

### 5.4 The KOT question

`pos_kot` copies `order.Items` verbatim at fire time, so once orders are priced,
KOTs inherit the breakdown for free — **no KOT change required.** A KOT is a
kitchen document; it should keep showing items and quantities, not money. The
"final bill" belongs to `pos_bill`, assembled from the KOTs'/rounds' parent
orders.

### 5.5 Frontend

- `Billing.js`: delete `taxPct()` and the legacy `Prices` fallback; stop
  computing `taxAmount` client-side. Show server totals.
- Cart still shows an *indicative* total via `POST /api/pricing/quote` so the
  UI stays live before the order exists.
- Settle modal sends `{ OrderIds: [...], Discount }` and renders the returned
  `taxByComponent` as the invoice footer (CGST ₹x / SGST ₹y).

---

## 6. Phase 4 — the transaction side

`transactionitemdetail` has `Id, TransactionDetailLogId, ItemId, Comment,
TenantId, Active` + audit. No quantity, no price.

Proposed additions:

```sql
ALTER TABLE transactionitemdetail
  ADD COLUMN Quantity    DECIMAL(18,4) NOT NULL DEFAULT 1,
  ADD COLUMN UnitPrice   DECIMAL(18,4) NULL,   -- snapshot at write
  ADD COLUMN CostInfoId  VARCHAR(50)   NULL,   -- what was priced
  ADD COLUMN NetAmount   DECIMAL(18,4) NULL,
  ADD COLUMN TaxAmount   DECIMAL(18,4) NULL,
  ADD COLUMN GrossAmount DECIMAL(18,4) NULL,
  ADD CONSTRAINT fk_tid_costinfo FOREIGN KEY (CostInfoId) REFERENCES costinfo(Id);
```

`UnitPrice` + the amounts are the historical snapshot (§3). `CostInfoId` is
nullable so existing rows migrate cleanly; new writes populate it from
`itemdetail.CostInfoId`.

Then `paymentdetail.TaxesAmount` / `GrossAmount` / `TotalAmount` are populated by
summing the log's priced lines instead of being client-supplied.

**Not included:** the `paymentbreakup` missing-Amount problem (§1.5). It is a
separate defect and should be its own change.

---

## 7. Sequencing

| Phase | Scope | Behaviour change | Schema change |
|---|---|---|---|
| **1** | Engine + `/pricing/quote` + tests | none | none |
| **2** | Breakdown on `costinfo`, `itemdetail`, `pos/item-meta`, `batchdetail` expands | none (additive fields) | none |
| **3** | POS orders priced server-side; bill from all orders; discount before tax | **yes** | `pos_bill_order` |
| **4** | Transaction lines priceable; `paymentdetail` populated | yes | `transactionitemdetail` columns |
| **5** | Retire `taxPct()` / legacy `Prices`; consider `VARCHAR`→`DECIMAL` money | cleanup | optional |

Phases 1–2 are safe to ship immediately and independently. Phase 3 is the first
one that changes a number a customer sees.

---

## 8. Decisions still needed before Phase 3

1. **`pos_bill_order` join table** — agreed, or keep an `OrderIds` JSON array on
   `pos_bill` (less normalized, no migration)?
2. **Discount change is a real tax change** (§1.4). Confirm you want the settled
   policy applied to POS, knowing bills will total differently than today.
3. **Existing rows.** Orders/bills created before this have `TaxAmount = 0` and no
   line snapshot. Leave them (historically accurate) or backfill?
4. **`transactionitemdetail`** — proceed with the Phase 4 columns above, or keep
   the transaction ledger out of scope for now?
