# Tax & Pricing Engine — Design Proposal

A single, shared way to turn `costinfo` into a priced result, driven by the
existing chain:

```
costinfo(Amount, IsTaxIncluded, TaxGroupId)
   └─> taxgroup
         └─> taxgrouptaxtypemapper
               └─> TaxTypes(Value = percent)
```

Status: **proposal for review — nothing implemented.**

---

## 1. What exists today

| Piece | State |
|---|---|
| The chain | Fully modelled and correct. `costinfo.TaxGroupId` is NOT NULL, so every price already declares a group. |
| `IsTaxIncluded` | `TINYINT(1) NOT NULL` on `costinfo`. Stored, never read. |
| `Active` flags | Present on `TaxTypes`, `taxgroup`, `taxgrouptaxtypemapper`, `costinfo` — so the chain can be filtered properly. |
| Calculation | **None.** No query joins past `taxgroup`; nothing sums `TaxTypes.Value`. |
| POS totals | `data.TaxAmount ?? 0` — taken from the client, unverified. |
| POS Billing UI | Reads `pos_item_meta.Prices` JSON, a legacy column the Menu form no longer writes → effectively always 0. |
| Shared helpers | `src/utils/` has no money or tax helper of any kind. |

**Net:** the data model is right; there is simply no code that walks it.

---

## 2. Three problems to solve before writing any math

### 2.1 Money is stored as strings in master data

| Column | Type |
|---|---|
| `costinfo.Amount` | `VARCHAR(50)` |
| `TaxTypes.Value` | `VARCHAR(50)` |
| `paymentdetail.TotalAmount` / `TaxesAmount` / `GrossAmount` | `VARCHAR(50)` |
| `pos_order` / `pos_bill` `SubTotal` / `TaxAmount` / `Total` | `DECIMAL(12,2)` |

Two different conventions for the same concept. The engine must parse defensively
at the boundary and must never do `0.1 + 0.2` style float arithmetic on money.

### 2.2 Rounding is not a detail — it changes totals

The component split is where this bites. Worked example, the common Indian case:

```
Amount = 100.00, IsTaxIncluded = 1, group "GST18" = CGST 9% + SGST 9%

gross      = 100.000000
net        = 100 / 1.18 = 84.745763
taxTotal   = 15.254237          → rounds to 15.25

naive per-component:
  CGST = 15.254237 × (9/18) = 7.627119 → 7.63
  SGST = 15.254237 × (9/18) = 7.627119 → 7.63
                                          -----
                                          15.26   ✗ ≠ 15.25
```

The invoice would not foot. The fix is **largest-remainder allocation**: round
each component down, then distribute the leftover paise one at a time to the
components with the largest fractional parts — giving `7.63 + 7.62 = 15.25` ✓.

This must live in exactly one function, or different screens will disagree by a
paisa and someone will spend a day on it.

### 2.3 There is no line quantity outside POS

`transactionitemdetail` has **no Quantity, Amount, Price or Rate column** — it is
only a link from a transaction log to an item, plus a comment. POS keeps
quantities inside the `pos_order.Items` JSON blob.

So "price × qty + tax" is expressible in POS today, and **not expressible at all**
on the transaction side. Any project-wide tax story eventually needs a decision
here (see §6).

---

## 3. Proposed architecture — three layers

Deliberately layered so the math is testable without a database and the DB access
is batched in one place.

```
┌─ Layer 3 ── consumers ─────────────────────────────────────────┐
│  costinfo expand · itemdetail expand · pos item-meta ·          │
│  pos order/bill totals · payment detail · POST /pricing/quote   │
└───────────────────────────┬────────────────────────────────────┘
                            │
┌─ Layer 2 ── src/modules/pricing/pricing.service.js ────────────┐
│  priceCostInfos(ids[], tenantId) → breakdown per costinfo       │
│  priceLines(lines[], tenantId)   → per-line + document totals   │
│  Batched: ONE query for the whole chain, no N+1.                │
└───────────────────────────┬────────────────────────────────────┘
                            │
┌─ Layer 1 ── src/utils/taxCalculator.js ── PURE, no DB ─────────┐
│  computeTax({ amount, isTaxIncluded, components })              │
│  allocate(total, weights)   ← largest-remainder                 │
│  Money helpers: parse / round / toMinorUnits                    │
└────────────────────────────────────────────────────────────────┘
```

### Layer 1 — `src/utils/taxCalculator.js` (pure)

No imports beyond itself. Everything here is unit-testable with no mocks.

```js
computeTax({
  amount: 100,              // parsed number
  isTaxIncluded: true,
  components: [             // resolved from the chain
    { id, name: 'CGST', rate: 9 },
    { id, name: 'SGST', rate: 9 },
  ],
})
// →
{
  netAmount:      84.75,    // pre-tax
  taxAmount:      15.25,    // total tax
  grossAmount:   100.00,    // payable
  effectiveRate:  18,
  isTaxIncluded:  true,
  components: [             // sums EXACTLY to taxAmount
    { id, name: 'CGST', rate: 9, amount: 7.63 },
    { id, name: 'SGST', rate: 9, amount: 7.62 },
  ],
}
```

Rules it owns:
- **Exclusive**: `net = amount`, `tax = net × Σrate/100`, `gross = net + tax`
- **Inclusive**: `gross = amount`, `net = gross ÷ (1 + Σrate/100)`, `tax = gross − net`
- Compute in **integer minor units** (paise), never floats.
- `net` and `tax` are forced to reconcile to `gross` — never independently rounded.
- Per-component amounts allocated by largest remainder so they sum to `tax`.
- Zero/empty component list → `tax = 0`, `net = gross = amount` (an "Exempt" group is valid, not an error).

### Layer 2 — `src/modules/pricing/pricing.service.js`

Owns all DB access. One batched query resolves the whole chain:

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

Note every join is **tenant-scoped and Active-filtered** — an inactive tax type
silently drops out of the group, which is the intended way to retire a component.

API:

| Function | Purpose |
|---|---|
| `priceCostInfos(costInfoIds[], tenantId)` | `Map<costInfoId, breakdown>` — the primitive |
| `priceLines(lines[], tenantId)` | `lines = [{ costInfoId, quantity, discount? }]` → per-line breakdown **plus** document totals |
| `getTaxGroupRate(taxGroupId, tenantId)` | effective rate + components, for UI display |

`priceLines` is what order/bill/invoice code calls. It is the single place that
applies the settled policy in §6 — discount first, tax per line, then sum:

```js
priceLines([
  { costInfoId, quantity: 2, discount: { type: 'percent', value: 10 } },
  { costInfoId, quantity: 1 },
], tenantId)
// →
{
  lines: [ { costInfoId, quantity, unitNet, lineNet, lineTax, lineGross, components:[…] }, … ],
  totals: { netAmount, taxAmount, grossAmount,
            taxByComponent: [ { name:'CGST', amount }, { name:'SGST', amount } ] },
}
```

`taxByComponent` is the invoice-footer breakdown, aggregated across lines — the
reason components are tracked individually rather than collapsed into one rate.

### Layer 3 — consumers

All additive; no existing response field changes meaning.

| Consumer | Change |
|---|---|
| `GET /api/costinfos?expand=true` | add `TaxBreakdown` object |
| `GET /api/itemdetails?expand=true` | add `NetAmount`, `TaxAmount`, `GrossAmount`, `EffectiveTaxRate` |
| `GET /api/pos/item-meta` | same, so the menu grid can show tax-correct prices |
| `POST /api/pricing/quote` | stateless calculator for any client — no record needed |
| `pos_order` / `pos_bill` writes | server recomputes `SubTotal`/`TaxAmount`/`Total` (decision 1) |
| `paymentdetail` | populate `TaxesAmount` / `GrossAmount` from the same source |

---

## 4. Why a separate `pricing` module rather than extending `costinfo`

- Tax touches items, batches, menu entries, orders, bills and payments. Hanging
  it off `costinfo.service` would make half the codebase import a CRUD service.
- `costinfo.service` already extends `BaseCRUDService`; pricing is not CRUD.
- Keeps the pure math importable by anything (including tests and, later, a
  frontend mirror) with no DB dependency.

This mirrors the `mastersetup.repository.js` split done for the setup gate — thin,
dependency-light module that several callers can share.

---

## 5. Suggested phasing

Each phase is independently shippable and adds no breaking change.

**Phase 1 — the engine (no behaviour change anywhere)**
`taxCalculator.js` + `pricing.service.js` + `POST /api/pricing/quote`, with a
heavy unit-test suite around the rounding rules. Nothing else consumes it yet, so
risk is near zero.

**Phase 2 — read paths**
Expose the breakdown on `costinfo`, `itemdetail` and `pos/item-meta` expands.
Purely additive fields. The Menu Item summary card you just built becomes able to
show a real tax breakdown instead of just the group name.

**Phase 3 — write paths**
Server-authoritative totals for `pos_order` / `pos_bill` / `paymentdetail`.
This is the only phase with a behaviour change, and it is where the decisions in
§6 bite.

**Phase 4 — retire the legacy path**
Remove `taxPct()` in `Billing.js` and stop depending on `pos_item_meta.Prices`.

---

## 6. Settled policy

These are decided and must not be re-litigated per screen — they are the reason
the engine exists in one place.

### 6.1 Rounding: **per line, then sum**

Each line's tax is rounded to 2dp, then lines are added. Printed line amounts
always add up to the printed document total, which is what invoice auditors
expect.

```
3 lines @ 18% GST
  Line 1  33.33 → tax 5.9994 → 6.00
  Line 2  33.33 → tax 5.9994 → 6.00
  Line 3  33.34 → tax 6.0012 → 6.00
                               -----
  document tax                 18.00
```

Consequence to accept: the document tax may differ by a paisa or two from
`documentNet × rate`. That is correct and intended under this policy.

### 6.2 Discount: **applied before tax**

Tax is computed on the discounted net — you owe tax on what was actually charged.

```
Item 100.00, 10% discount, 18% GST
  net after discount   90.00
  tax = 90 × 18%       16.20
                      ------
  total               106.20
```

So a line is evaluated as: `discountedNet → computeTax(...)`. For an
**inclusive** price the discount applies to the gross first, and the net is
then re-derived from the discounted gross.

### 6.3 POS totals: **server-authoritative**

`pos_order`, `pos_bill` and `paymentdetail` recompute `SubTotal` / `TaxAmount` /
`Total` from the chain on write. Client-supplied totals are ignored rather than
trusted. This lands as Phase 3 on its own so the behaviour change is isolated,
and Phase 4 then retires `taxPct()` in `Billing.js`.

---

## 7. Still open

**Money column types.** `costinfo.Amount` and `TaxTypes.Value` are `VARCHAR(50)`.
The engine will parse defensively so this is not a blocker, but migrating to
`DECIMAL` would remove a class of "someone stored `12,50`" bugs. A migration here
is a *tightening*, so it does not conflict with the never-relax-the-DB rule.
Proposed: defer to a Phase 5, decide once the engine is live.

**Line quantity on the transaction side.** `transactionitemdetail` has no
Quantity, Amount, Price or Rate column, so `priceLines` can only serve POS today.
Making the transaction ledger priceable needs `Quantity` / `UnitPrice` (and
possibly `CostInfoId`) added there — a schema change with its own scope, and the
one thing standing between this and being genuinely project-wide.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Float drift on money | Integer minor units throughout Layer 1 |
| Component amounts not summing to total | Largest-remainder allocation, property-tested |
| N+1 queries when pricing an order | Layer 2 is batched by design — `IN (…)` over all ids |
| Existing POS totals change on deploy | Phase 3 is separable and can be feature-flagged per tenant |
| A group with no active types | Defined as 0% (an "Exempt" group), not an error |
| Inactive tax type still billed | Every join filters `Active = 1` |
