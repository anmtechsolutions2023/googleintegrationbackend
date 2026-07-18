# Front Desk — Component Creation & Dependency Workflow

Analysis of what must be created (and in what order) to initialize components under
`http://localhost:3000/frontdesk/...`. Derived from the backend FK graph
(`database/01-schema-definition.sql` §4 POS), the module Joi create-schemas
(`src/modules/pos*/**.schemas.js`), and the frontend page/reference wiring
(`src/pages/frontdesk`, `src/config/posModules.js`).

---

## 1. Methodology & Legend

Each component is classified by **what must exist before a create call can succeed**.

- **Hard dependency (⛔ blocking):** a `.required()` field or `NOT NULL` FK that points
  at another module. You *cannot* create the record without it.
- **Soft dependency (⚠️ functional):** an *optional* FK/reference the schema allows to be
  null, but the workflow/UI expects in practice (e.g. a dine-in order with no table is
  technically valid but operationally meaningless).
- **Level N** = longest chain of *hard* dependencies beneath it. Level 0 = fully standalone.

> **Key finding:** almost every `BranchDetailId` and cross-link in the POS tables is
> **nullable**, and the API scopes by `TenantId`. So the graph is shallow — the **only hard
> cross-module blocker in the whole section is Menu Master**, which requires a master
> `itemdetail` and (app-level) a `branchdetail`. Everything else is standalone or softly chained.

---

## 2. Prerequisite Master Data (outside `/frontdesk`, but pulled in)

These live under `/master/...` and are consumed by frontdesk dropdowns:

| Master module | Needed by | Hard requirement to create it |
|---|---|---|
| **Item Detail** (`/master/itemDetails`) | **Menu Master** (⛔ required) | `Name` only (Category/UOM/CostInfo optional) → effectively Level 0 |
| **Branch Detail** (`/master/branchDetails`) | Menu (required), + optional Branch scoping everywhere | ⛔ **Deep chain:** Organization + Contact + Address + TransactionTypeConfig (all NOT NULL) |
| **Cost Info** (`/master/costInfos`) | Menu (optional price ref) | `Amount` + `TaxGroupId` (⛔ → Tax Group) |

**Branch is the single deepest prerequisite in the system.** For branch-scoped POS data you
must first build:
`Organization → Contact → Address (→ MapProvider/Location) → TransactionTypeConfig → Branch`.

---

## 3. Frontdesk Component Dependency Matrix

| Level | URL | Creates (table) | Hard-required fields | Hard deps ⛔ | Soft/optional refs ⚠️ |
|---|---|---|---|---|---|
| **0** | `/frontdesk/channels` | `pos_channel` | `Name`, `Code` | — | — |
| **0** | `/frontdesk/variants` | `pos_variant` | `Name`, `Code` | — | — |
| **0** | `/frontdesk/floors` | `pos_floor` | `Name` | — | Branch |
| **0** | `/frontdesk/staff` | `pos_staff` | `Name` | — | Branch |
| **0** | `/frontdesk/customers` | `pos_customer` | `Name` | — | Branch |
| **0** | `/frontdesk/expenses` | `pos_expense` | `Category`, `Amount` | — | Branch |
| **0** | `/frontdesk/online` | `pos_online_order` | `Platform` | — | — |
| **1** | `/frontdesk/tables` | `pos_table` | `Name` | — | **Floor** (⚠️ groups by floor), Branch |
| **1** | `/frontdesk/feedback` | `pos_feedback` | `Rating` (1–5) | — | **Customer**, Branch |
| **1** | `/frontdesk/menu` | `pos_item_meta` | `ItemDetailId`, `FoodType`, `BranchDetailId` | **Item** (master) + **Branch** (master) | CostInfo, **Channels[]**, **Variants[]** |
| **2** | `/frontdesk/billing` → *Order* | `pos_order` | `OrderNo` | — | **Table** (L1), **Customer** (L0), Menu items |
| **3** | `/frontdesk/billing` → *KOT* | `pos_kot` | `KotNo` | — | **Order** (L2) |
| **3** | `/frontdesk/billing` → *Bill* | `pos_bill` | `BillNo` | — | **Order** (L2) |
| **0–3** | `/frontdesk/tokens` | `pos_token` | `TokenNumber` | — | Order (optional link) |

**Read-only / no-create pages** (consume the above, create nothing): `/frontdesk` (Dashboard),
`/frontdesk/kitchen` (updates KOT status only), `/frontdesk/tracking`, `/frontdesk/reports`,
`/frontdesk/inventory` (reads master itemdetail + batch), `/frontdesk/access-control` (IAM roles/permissions).

---

## 4. Dependency Graph (DAG)

```
[MASTER DATA]
  Organization ─┐
  Contact ──────┤
  Address ──────┼─► Branch Detail ─────────────────────┐
  TxnTypeConfig ┘                                       │
  TaxGroup ─► Cost Info ──────────┐                     │
  Item Detail ────────────────────┼───────────┐         │
                                   │           ▼         ▼
[FRONTDESK L0]                     │      ┌───────────────────────┐
  Channels ───────────┐           └────► │  MENU MASTER           │  (L1)
  Variants ───────────┼─────────────────►│  pos_item_meta         │
  Floors ──┐          │                  └───────────┬───────────┘
  Customers┼──┐       │                              │ (menu items feed orders)
  Staff    │  │       │                              ▼
  Expenses │  │       │            ┌───────────────────────────────┐
           │  │       └───────────►│  ORDER (Billing)  pos_order    │ (L2)
  Tables ◄─┘  │  (Floor)           └───────┬───────────────┬───────┘
  (L1) ◄──────┘  (Customer→Feedback L1)    │               │
                                    ┌───────▼──────┐  ┌─────▼───────┐
                                    │ KOT pos_kot  │  │ BILL        │ (L3)
                                    │ (Kitchen)    │  │ pos_bill    │
                                    └──────────────┘  └─────────────┘
```

---

## 5. Recommended Creation Sequence (the "what-first" playbook)

**Phase A — Foundation (once per tenant, optional but unlocks branch scoping)**
1. `/master` → Organization → Contact → Address → TransactionTypeConfig → **Branch Detail**
2. `/master` → Tax Group → **Cost Info**; and **Item Detail** (menu items catalog)

**Phase B — Frontdesk config (Level 0, any order)**
3. **Channels** and **Variants** (`/frontdesk/channels`, `/variants`)
4. **Floors** (`/frontdesk/floors`) → then **Tables** (`/frontdesk/tables`, pick a Floor)
5. **Staff**, **Customers** (`/frontdesk/customers`)

**Phase C — Menu (Level 1, the first hard gate)**
6. **Menu Master** (`/frontdesk/menu`) — requires an **Item** + **Branch**; optionally attach
   **Channels/Variants** (created in step 3) and a **Cost Info**.

**Phase D — Live operations (Levels 2–3, via Billing)**
7. **Order** — open from Billing, seat at a **Table**, attach a **Customer**, add **Menu** items.
8. **Fire KOT** → appears in **Kitchen (KDS)** for status updates.
9. **Settle Bill** → closes the order, frees the table.
10. **Tokens** / **Online Orders** run in parallel (standalone; token can link to an order).

---

## 6. Gotchas Worth Flagging

- **Menu is the only true blocker.** With no `itemdetail` rows, `/frontdesk/menu` create fails
  on `ItemDetailId`. Since the demo data was deleted, a fresh DB has **no items and no branches**
  — Menu can't be created until you seed at least one Item + Branch.
- **Branch is app-required for Menu but has no DB FK** — it validates a UUID format but won't
  reject a non-existent branch. The other tables' `BranchDetailId` *do* have real FKs and will
  reject bad ids.
- **Channels/Variants attach to Menu, not the reverse** — create them before opening the Menu
  form if you want them selectable (they populate the `ChannelIds[]`/`VariantIds[]` multi-selects).
- **KOT/Bill are not standalone screens** — they're created as side-effects of the Billing order
  flow (`fireKot`, `createBill`), so "Order first" is mandatory for them to be meaningful.
- **Kitchen, Tracking, Reports, Dashboard, Inventory** never create POS rows; excluding them from
  the creation hierarchy is intentional.
