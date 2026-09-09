# Zomato Integration Plan (Menu + Order Certification)

Close the 24 open items on Zomato's critical feature list so the seeded `Zomato` portal can
move off the `manual` adapter and onto a live API integration.

- **Backend:** `googleintegrationbackend` (Node/Express/MySQL, multi-tenant, JWT+scopes+audit)
- **Frontend:** `googleintegrationfrontend/tenant-auth-ui` (React 18 CRA) — Front Desk section
- **Audit basis:** `database/01-schema-definition.sql`, `database/02-seed-data.sql`, `src/modules/`
  read on 6 Sep 2026.

## Build status — updated 6 Sep 2026

Decisions 1 and 2 approved: `UNIQUE (Name, TenantId)` kept on `categorydetail`;
schema for Phases 0–5 landed **in one pass, one rebuild**.

| Work | State |
|---|---|
| Schema — all 12 tables + 14 columns for Phases 0–5 | ✅ **Done.** Verified by applying `01` + `02` to a clean MySQL 8.0 container from scratch. |
| Seed — PART 13 (7 meat types, 12 menu tags, 6 rejection reasons) | ✅ Done |
| Per-tenant provisioning (`posMasters.provision.js`) | ✅ Done |
| `schemaCheck.js` drift list | ✅ Done |
| Tenant-delete sweep (12 new tables, FK order) | ✅ Done. Real 84-statement sweep runs with FK checks ON and leaves nothing behind. |
| `QUERIES` blocks ×5 | ✅ Done |
| Modules: `posmeattype`, `posmenutag`, `posaddongroup`, `posaddon`, `posrejectionreason` | ✅ Done — 28 endpoints, registered, linted |
| Tests (`posmenumasters.service.test.js`) | ✅ Done — 29 passing |
| Swagger — 5 CRUD sets + 3 lookups + 15 schemas | ✅ Done — 197 paths, zero dangling `$ref` |
| **Backend suite** | 2994 passing, **zero regressions** (6 pre-existing failures unchanged) |

### Frontend — the five masters (vertical slice)

| Work | State |
|---|---|
| `POS_MODULES` entries ×5 (`posModules.js`) | ✅ Done — screens **and** reference sources |
| Pages ×5 (`pages/frontdesk/`) | ✅ Done — `PosCrudPage`, so responsive behaviour is inherited, not re-implemented |
| Routes + `ScopeGuard` (`App.js`) | ✅ Done |
| Front Desk sidebar entries (`navigation.js`) | ✅ Done — groups before options; rejection reasons under Portals |
| Reference-integrity test (`config/__tests__/posModules.test.js`) | ✅ Done — 27 passing |
| Production build | ✅ Succeeds, **+654 B gzip** for all five screens |
| **Frontend suite** | 909 passing, **zero regressions** (8 pre-existing failures unchanged) |

> **New guard worth keeping.** A `reference` key that matches neither `MODULES`
> nor `POS_MODULES` does not throw — it resolves to `undefined`, the fetch never
> fires, and the dropdown renders **empty**. `posModules.js` already carries a
> long comment about this happening once with branch pickers. The new test walks
> every reference in **both** registries, so it guards the pre-existing config
> too, not just the new entries.

### Sub-categories — `categorydetail.ParentId` (Phase 0.1 app layer)

| Work | State |
|---|---|
| `QUERIES.CATEGORY` — ParentId/SortOrder, tenant-scoped parent self-join, `SELECT_PARENT_CANDIDATES`, `COUNT_CHILDREN` | ✅ Done |
| `assertTwoLevelDepth` guard + `GET /api/categories/parent-candidates` | ✅ Done |
| Delete guard — clear 400 instead of an opaque FK 500 | ✅ Done |
| Joi + Swagger + frontend form, list and parent picker | ✅ Done |
| Tests — `category.hierarchy.test.js` (16) + `modules.categories.test.js` (8) | ✅ Done |
| Live DB proof | ✅ Two-level tree reads correctly; FK **RESTRICT** confirmed (`ERROR 1451`) — which is exactly what the 400 replaces |

**The depth guard blocks all three routes to a third level**, including the one a
naive depth check misses: giving a parent to a category that already *has*
children. Self-parenting is rejected before any lookup.

> **Two corrections made, both under "the DB is the source of truth".**
> `categorydetail.Name` is `VARCHAR(50)`, but Joi allowed 100 and the frontend
> form allowed 100 — a 51-character name passed validation and failed in MySQL
> as a 500 instead of a field-level 400. Swagger already said 50, so Joi and the
> UI were the outliers. The two tests that asserted the 100-character boundary
> were asserting the bug, and moved to 50.

### Menu item wiring + category hours (completes Phases 0–2 app layer)

| Work | State |
|---|---|
| `positemmeta` — add-on group + tag joins, nutrition upsert, serves/portion/meat/prep columns | ✅ Done |
| `syncLinks` refactored to a NAMED object (4 link kinds; positional args were mis-orderable) | ✅ Done |
| `poscategoryschedule` — bulk-replace week, overnight split, availability resolution | ✅ Done |
| Joi + Swagger (200 paths, 257 schemas, zero dangling `$ref`) | ✅ Done |
| Frontend — MenuMaster fields + a responsive Category Hours editor | ✅ Done, builds |
| Tests — `poscategoryschedule.service.test.js` (19) | ✅ Done |

### Integration + PK/FK validation (run on a clean MySQL 8.0 build)

| Check | Result |
|---|---|
| Schema + seed from scratch | ✅ 91 tables, seed clean |
| **Real production queries** on live data (not hand-written SQL) | ✅ One dish returned its add-on groups, tags, meat type, portion, prep time and sub-category together |
| Availability resolution | ✅ 5/5 — including **no rules = AVAILABLE** and the midnight split matching on both sides |
| Tables without a primary key | ✅ **None** |
| FK columns without an index | ✅ **None** |
| Cross-tenant / orphan leaks | ✅ **0** across 7 join paths |
| Three-level category nesting | ✅ **0** |
| TenantId on all 12 new tables | ✅ All present, all NOT NULL |
| Tenant-delete sweep (84 statements, FK checks ON) | ✅ Clean, nothing left behind |
| Backend suite | ✅ 3033 passing, zero regressions |
| Frontend suite | ✅ 918 passing, zero regressions |

**FK delete rules follow one rule consistently:** `CASCADE` where the child is
*owned* by the parent (an item's tag links die with the item), `RESTRICT` where
it merely *references* a shared master (a menu tag in use cannot be deleted).

> **FK defect — FIXED 7 Sep 2026.**
> `paymentbreakup.PaymentModeTransactionDetailId` was `VARCHAR(100)` against a
> `VARCHAR(50)` parent. Narrowed to 50. Safe: Joi and Swagger both already
> required a uuid (36 chars), so nothing was ever writing anything longer — the
> width was an oversight, not a capability in use. Re-audited: **0 FK type
> mismatches across all 129 foreign keys.**

---

## PHASE 3 — Kitchen Preparation Time ✅ DONE (7 Sep 2026)

| Work | State |
|---|---|
| `posonlineorder.kpt.js` — its own module, not another block in `lifecycle.js` | ✅ Done |
| `resolveKpt` — pure, 4-level priority: explicit → slowest line → branch → platform | ✅ Done |
| `clamp` — 1–120 min; a mistyped 200 is capped, not rejected | ✅ Done |
| `SET_ACCEPTED` writes `KptMinutes` + `KptSetOn` in ONE statement | ✅ Done |
| Pushed to the portal on the order object — `BaseAdapter.pushStatus` signature unchanged | ✅ Done |
| `kpt.default_minutes` wired into `pos_setting` defaults **and** the write whitelist | ✅ Done |
| Joi + Swagger (`KptMinutes`, `KptSource`) | ✅ Done |
| Frontend — optional override on the detail panel; queue card stays one tap | ✅ Done |
| Tests — `posonlineorder.kpt.test.js` (34) | ✅ Done |

**The aggregate is MAX, not AVG or SUM** — the kitchen is not finished until its
slowest dish is. Lines with no prep time contribute nothing rather than a zero.
Verified live: Salad(8) + Biryani(45) → **45**; an all-untimed order → NULL, so
it falls through to the branch default.

**`KptMinutes` is not `PromisedOn`.** Ours is about the pass; the portal's is
about the doorstep. Conflating them is how a kitchen gets blamed for a late rider.

> **Gap caught by an existing test, then fixed.** Adding `KPT_DEFAULT_MINUTES`
> to `POS_SETTING_KEYS` without wiring it into the settings service would have
> shipped a setting nobody could change — exactly what that file's own comment
> warns about. `possetting.service.test.js` failed on it. Now in both the
> defaults and the write whitelist.

---

## PHASE 4 — Cooking instructions reach the kitchen ✅ DONE (7 Sep 2026)

The data always arrived. Nothing carried it to the pass, so the kitchen never
saw it — which is the entire point of a cooking instruction.

| Work | State |
|---|---|
| `emptyInboundOrder` — `cookingInstructions` + `noCutlery` on the adapter contract | ✅ Done |
| `manual` adapter (queue form) and `httpAggregator` (configurable path) | ✅ Done |
| `COMMON_FIELDS` — `order.instructions`, `order.no_cutlery` | ✅ Done |
| Ingest promotes them OUT of the raw payload into columns | ✅ Done |
| **`pos_kot.CookingInstructions` + `NoCutlery`** — snapshotted at fire time | ✅ Done |
| `writeKot` carries them; accept passes them through | ✅ Done |
| Receipt catalogue: `orderInstructions`, `noCutlery` on the kitchen ticket | ✅ Done |
| `Receipt.js` renders them; `kotPrint.js` supplies them | ✅ Done |
| Joi + Swagger + `schemaCheck` + online-order INSERT/UPDATE | ✅ Done |

**Snapshotted, not read live** — same reason `Items` is. A ticket already on the
pass must not be rewritten because somebody edited the order behind it.

**`NoCutlery` is a boolean, not a phrase to grep for.** It is acted on by whoever
BAGS the order, who is not reading the cooking notes — and "no cutlery" buried in
a sentence is how a fork ends up in the bag anyway. It prints in its own boxed
line below the items.

> **Defect caught by my own verification, before it shipped.** Adding two
> columns to the `pos_online_order` INSERT, I added only one placeholder — 40
> columns against 39 values. A column/value skew writes every field one position
> to the left and MySQL does not always complain. The column-vs-VALUES count
> check caught it; both INSERTs now verify 1:1.

### Validation (clean MySQL 8.0 build)

| Check | Result |
|---|---|
| Schema + seed from scratch | ✅ 91 tables, clean |
| Real `pos_kot` INSERT with instructions | ✅ Persisted and read back |
| Real `pos_online_order` INSERT + `SET_ACCEPTED` | ✅ **Phases 3 and 4 together**: KPT 22 min stamped alongside the instruction and cutlery flag |
| Tables without a PK / FK mismatches / unindexed FKs | ✅ **0 / 0 / 0** across 129 FKs |
| Tenant sweep | ✅ Clean, nothing left behind |
| Swagger | ✅ 200 paths, 257 schemas, zero dangling `$ref` |
| Backend | ✅ 3068 passing, zero regressions |
| Frontend | ✅ 918 passing, zero regressions, build clean |

**Next:** Phase 5 (wiring the coded rejection reasons into the reject path),
Phase 6 (the Zomato adapter).

**Next:** Phase 3 (KPT), Phase 4 (cooking instructions to the KOT), Phase 5
(coded rejection wiring into the reject path), Phase 6 (the Zomato adapter).

> **Pre-existing bug found, not fixed (out of scope):** `src/config/swagger.js`
> has a duplicate key `'/api/admin/users/{phone}'` — one definition silently
> wins and the other never reaches the docs. Present at HEAD; flagged only.

## Current standing

| Area | Built | Partial | Missing | Total |
|---|---|---|---|---|
| Menu Management | 7 | 4 | 12 | 23 |
| Order Management | 6 | 4 | 4 | 14 |
| **Total** | **13** | **8** | **16** | **37** |

**The integration plumbing is already built.** `BaseAdapter` exposes exactly the five methods a
Zomato integration needs (`verify`, `normalize`, `mapStatus`, `pushStatus`, `pushMenu`);
`pos_portal_credential` holds webhook secrets and API keys; `pos_portal_event` gives idempotency
on `(portal, ref, type, payload hash)`; `pos_portal_listing` maps `ExternalItemId` and tracks
sync state. Zomato is seeded at 18% commission with its own settlement tender.

What is missing is **menu richness**, not integration capability. That is the cheap kind of
missing — mostly additive tables and columns.

---

## Verified codebase standards (this plan conforms to these)

Confirmed by reading the code, not assumed:

1. **DB is the source of truth.** On any app/DB mismatch, the app layers (Joi + UI + tests) are
   corrected to match the DB. The DB is never relaxed to accommodate the app.
2. **Fresh deploy, no migrations.** `01-schema-definition.sql` and `02-seed-data.sql` are the
   *only* database files. Schema changes are edited **in place**; a rebuild is a
   drop-and-recreate. **No `ALTER` scripts, no backfill scripts, no third file.**
3. **Table shape:** `Id VARCHAR(50)` app-generated UUID, `TenantId VARCHAR(50) NOT NULL`,
   `Active TINYINT(1)`, `CreatedOn/CreatedBy/UpdatedOn/UpdatedBy`. Named `UNIQUE` on the natural
   key. FKs declared explicitly.
4. **Module shape:** four files — `X.service.js` (extends `BaseCRUDService`, implements
   `prepareInsertParams` / `prepareUpdateParams`), `X.controller.js` (exports **arrays**:
   `[validateParams(...), validateBody(...), handler]`), `X.routes.js`, `X.schemas.js` (Joi).
5. **SQL lives in `src/config/constants.js`** under `QUERIES.<MODULE>` with the standard keys:
   `SELECT_ALL`, `COUNT`, `SELECT_BY_ID`, `INSERT`, `UPDATE`, `DELETE`.
6. **Routes** are registered in `src/config/routes.js` (require at top, `app.use()` below) and
   every route carries `authenticateToken`, a `checkScope(...)` guard, and `auditLogCrud(...)`.
7. **Per-tenant provisioning:** every new POS master must be seeded for new tenants in
   `src/modules/mastersetup/posMasters.provision.js`, mirrored by a global seed in
   `02-seed-data.sql` for the template tenant.
8. **One connection per request.** Helpers take an existing connection rather than opening a
   second — nesting deadlocks the pool.

---

## IAM position

**No new features or scopes are required.** Every master added below is POS reference data and
fits the existing model:

- **Reads:** `SCOPE_SETS.POS_REFERENCE_READ` — a read follows the capability that needs it, so a
  till can render add-ons without holding `POS_CONFIG`.
- **Writes:** `SCOPES.POS_CONFIG_WRITE` (plus `TENANT_ADMIN` / `TENANT_SUPER_ADMIN`).
- **Order actions** (accept / reject / KPT) stay on `POS_ORDER_WRITE`.

This keeps `features` at 29 rows and avoids touching PART 3 / PART 6 of the seed.

---

# PHASE 0 — Structural schema pass

The three gaps that need real design rather than a column. Nine of the twelve remaining menu
gaps either depend on these or become trivial once they exist. **Do all schema edits in one
pass**, then rebuild the database once.

### 0.1 Sub-categories — `categorydetail.ParentId`

```sql
-- In categorydetail, after CategoryId-adjacent columns:
    ParentId   VARCHAR(50)  NULL,
    SortOrder  INT          NOT NULL DEFAULT 0,
    ...
    FOREIGN KEY (ParentId) REFERENCES categorydetail(Id)
```

Self-referencing, one level deep (Zomato's menu tree is category → sub-category; deeper nesting
is not supported by the portal and must be rejected in Joi, not merely discouraged).

> **⚠ Decision for review — the UNIQUE key.** `categorydetail` currently has
> `UNIQUE (Name, TenantId)`. Changing it to `UNIQUE (Name, ParentId, TenantId)` looks right but
> is a trap: **MySQL treats NULLs as distinct in a unique index**, so every top-level category
> (`ParentId IS NULL`) would become unconstrained and duplicates could be created freely.
> **Recommendation: keep `UNIQUE (Name, TenantId)`.** Category names stay globally unique per
> tenant — which is already true today, so no behaviour changes and no existing data breaks.
> The cost is that "Starters" cannot exist under two different parents. Confirm that is
> acceptable before build.

### 0.2 Add-ons — three new tables

Variants and add-ons are **not** the same thing: a variant *replaces* the item's price, an
add-on *augments* it and carries its own selection rules. Modelling add-ons as variants is the
single most common way this integration goes wrong.

```sql
-- 4.x pos_addon_group — a choice block ("Choose your crust", "Extra toppings")
CREATE TABLE pos_addon_group (
    Id            VARCHAR(50)   NOT NULL,
    Name          VARCHAR(100)  NOT NULL,
    Code          VARCHAR(50)   NOT NULL,
    Description   VARCHAR(255)  NULL,
    -- Selection rules. MinSelection > 0 makes the group mandatory; the pair is
    -- what Zomato validates an inbound order line against.
    MinSelection  INT           NOT NULL DEFAULT 0,
    MaxSelection  INT           NOT NULL DEFAULT 1,
    SortOrder     INT           NOT NULL DEFAULT 0,
    TenantId      VARCHAR(50)   NOT NULL,
    Active        TINYINT(1)    NOT NULL DEFAULT 1,
    CreatedOn     DATETIME, CreatedBy VARCHAR(50),
    UpdatedOn     DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Code, TenantId)
);

-- 4.x pos_addon — one selectable option inside a group
CREATE TABLE pos_addon (
    Id            VARCHAR(50)   NOT NULL,
    AddonGroupId  VARCHAR(50)   NOT NULL,
    Name          VARCHAR(100)  NOT NULL,
    Code          VARCHAR(50)   NOT NULL,
    Price         DECIMAL(18,4) NOT NULL DEFAULT 0,
    -- Dietary tag on the ADD-ON itself. Zomato requires this: a veg pizza with a
    -- chicken topping is not a veg order. Reuses the existing food type master
    -- rather than inventing a second veg flag.
    FoodTypeId    VARCHAR(50)   NULL,
    SortOrder     INT           NOT NULL DEFAULT 0,
    TenantId      VARCHAR(50)   NOT NULL,
    Active        TINYINT(1)    NOT NULL DEFAULT 1,
    CreatedOn     DATETIME, CreatedBy VARCHAR(50),
    UpdatedOn     DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Code, TenantId),
    FOREIGN KEY (AddonGroupId) REFERENCES pos_addon_group(Id) ON DELETE CASCADE,
    FOREIGN KEY (FoodTypeId)   REFERENCES pos_food_type(Id)
);

-- 4.x pos_item_meta_addon_group — which groups apply to which dish
CREATE TABLE pos_item_meta_addon_group (
    Id            VARCHAR(50)   NOT NULL,
    ItemMetaId    VARCHAR(50)   NOT NULL,
    AddonGroupId  VARCHAR(50)   NOT NULL,
    SortOrder     INT           NOT NULL DEFAULT 0,
    TenantId      VARCHAR(50)   NOT NULL,
    Active        TINYINT(1)    NOT NULL DEFAULT 1,
    CreatedOn     DATETIME, CreatedBy VARCHAR(50),
    UpdatedOn     DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (ItemMetaId, AddonGroupId, TenantId),
    FOREIGN KEY (ItemMetaId)   REFERENCES pos_item_meta(Id) ON DELETE CASCADE,
    FOREIGN KEY (AddonGroupId) REFERENCES pos_addon_group(Id)
);
```

`FoodTypeId` on `pos_addon` closes **Add-ons Level Tagging** for free.

### 0.3 Variant-level out-of-stock — `pos_portal_listing_variant`

`Available` currently lives on `pos_portal_listing`, which is keyed to the *item*. "Large is
sold out, regular isn't" cannot be expressed. This table mirrors the parent exactly:

```sql
CREATE TABLE pos_portal_listing_variant (
    Id                VARCHAR(50)   NOT NULL,
    ListingId         VARCHAR(50)   NOT NULL,
    VariantId         VARCHAR(50)   NOT NULL,
    -- Zomato's own id for this size/option. Inbound order lines resolve on it.
    ExternalVariantId VARCHAR(100)  NULL,
    PriceOverride     DECIMAL(18,4) NULL,
    Available         TINYINT(1)    NOT NULL DEFAULT 1,
    SortOrder         INT           NOT NULL DEFAULT 0,
    LastSyncedOn      DATETIME      NULL,
    SyncStatus        VARCHAR(20)   NOT NULL DEFAULT 'pending',
    SyncError         VARCHAR(500)  NULL,
    TenantId          VARCHAR(50)   NOT NULL,
    Active            TINYINT(1)    NOT NULL DEFAULT 1,
    CreatedOn         DATETIME, CreatedBy VARCHAR(50),
    UpdatedOn         DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (ListingId, VariantId, TenantId),
    FOREIGN KEY (ListingId) REFERENCES pos_portal_listing(Id) ON DELETE CASCADE,
    FOREIGN KEY (VariantId) REFERENCES pos_variant(Id)
);
```

### 0.4 Category listing per portal — `pos_portal_category`

Needed for **Category OOS** and for `pushMenu()` to address a category by Zomato's id. Mirrors
`pos_portal_listing`:

```sql
CREATE TABLE pos_portal_category (
    Id                 VARCHAR(50)  NOT NULL,
    PortalId           VARCHAR(50)  NOT NULL,
    CategoryId         VARCHAR(50)  NOT NULL,
    ExternalCategoryId VARCHAR(100) NULL,
    ListedName         VARCHAR(255) NULL,
    Available          TINYINT(1)   NOT NULL DEFAULT 1,
    SortOrder          INT          NOT NULL DEFAULT 0,
    LastSyncedOn       DATETIME     NULL,
    SyncStatus         VARCHAR(20)  NOT NULL DEFAULT 'pending',
    SyncError          VARCHAR(500) NULL,
    TenantId           VARCHAR(50)  NOT NULL,
    Active             TINYINT(1)   NOT NULL DEFAULT 1,
    CreatedOn          DATETIME, CreatedBy VARCHAR(50),
    UpdatedOn          DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (PortalId, CategoryId, TenantId),
    FOREIGN KEY (PortalId)   REFERENCES pos_portal(Id) ON DELETE CASCADE,
    FOREIGN KEY (CategoryId) REFERENCES categorydetail(Id) ON DELETE CASCADE
);
```

### Phase 0 modules

| Module | Files | Route base | Notes |
|---|---|---|---|
| `posaddongroup` | service, controller, routes, schemas | `/api/pos/addon-groups` | Standard `BaseCRUDService` CRUD |
| `posaddon` | service, controller, routes, schemas | `/api/pos/addons` | Filter by `AddonGroupId` on list |
| **extend** `category` | schemas, service | `/api/categories` | `ParentId` in create/update; reject 2-level nesting in Joi |
| **extend** `positemmeta` | service, schemas, repository | — | Attach/detach addon groups |
| **extend** `posportal` | listing.service, controller, routes | `+ /categories`, `+ /listings/:id/variants` | Category + variant listing CRUD and availability |

**Closes:** Add Add-ons · Add-ons Level Tagging · Adding Category/Sub Category · Variant OOS ·
Category OOS · Delete Category & SC (7 items)

---

# PHASE 1 — Menu attributes and compliance

Purely additive. Low risk, high feature count.

### 1.1 Columns on `pos_item_meta`

```sql
    -- Serving information — "Serves 2", "350 ml". Zomato shows this on the card.
    ServesCount      TINYINT       NULL,
    PortionSize      VARCHAR(50)   NULL,
    -- Meat taxonomy. ORTHOGONAL to FoodTypeId, not a replacement: a dish is
    -- Non-Veg (food type) AND Chicken (meat type). Collapsing them loses one.
    MeatTypeId       VARCHAR(50)   NULL,
    -- Kitchen Preparation Time, per dish. See Phase 3.
    PrepTimeMinutes  INT           NULL,
    ...
    FOREIGN KEY (MeatTypeId) REFERENCES pos_meat_type(Id)
```

### 1.2 New master — `pos_meat_type`

```sql
CREATE TABLE pos_meat_type (
    Id          VARCHAR(50)  NOT NULL,
    Name        VARCHAR(100) NOT NULL,
    Code        VARCHAR(50)  NOT NULL,
    Description VARCHAR(255) NULL,
    SortOrder   INT          NOT NULL DEFAULT 0,
    TenantId    VARCHAR(50)  NOT NULL,
    Active      TINYINT(1)   NOT NULL DEFAULT 1,
    CreatedOn   DATETIME, CreatedBy VARCHAR(50),
    UpdatedOn   DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Code, TenantId)
);
```

Seed: Chicken, Mutton/Lamb, Beef, Pork, Fish, Prawn/Shellfish, Egg, Other.

### 1.3 Nutrition — `pos_item_nutrition` (1:1, optional)

> **⚠ Decision for review.** Nutrition can be columns on `pos_item_meta` or its own table.
> **Recommendation: separate table.** The data is sparse (most tenants will never fill it),
> `pos_item_meta` is already wide, and a compliance schema tends to grow. The cost is one LEFT
> JOIN in the menu read path.

```sql
CREATE TABLE pos_item_nutrition (
    Id             VARCHAR(50)   NOT NULL,
    ItemMetaId     VARCHAR(50)   NOT NULL,
    ServingSizeG   DECIMAL(10,2) NULL,
    Calories       DECIMAL(10,2) NULL,
    ProteinG       DECIMAL(10,2) NULL,
    CarbohydrateG  DECIMAL(10,2) NULL,
    SugarG         DECIMAL(10,2) NULL,
    FatG           DECIMAL(10,2) NULL,
    SaturatedFatG  DECIMAL(10,2) NULL,
    FibreG         DECIMAL(10,2) NULL,
    SodiumMg       DECIMAL(10,2) NULL,
    Allergens      VARCHAR(500)  NULL,
    TenantId       VARCHAR(50)   NOT NULL,
    Active         TINYINT(1)    NOT NULL DEFAULT 1,
    CreatedOn      DATETIME, CreatedBy VARCHAR(50),
    UpdatedOn      DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (ItemMetaId, TenantId),
    FOREIGN KEY (ItemMetaId) REFERENCES pos_item_meta(Id) ON DELETE CASCADE
);
```

### 1.4 GST 9(5) — columns on `itemdetail`

Goes next to the existing `HSNCode`, because that is where tax identity already lives.

```sql
    -- GST 9(5): restaurant supply is a SERVICE, packaged goods sold alongside
    -- are GOODS, and the two attract different treatment on the same bill.
    -- HSN codes goods; SAC codes services — an item needs whichever applies.
    SupplyType  VARCHAR(10)  NOT NULL DEFAULT 'GOODS',
    SACCode     VARCHAR(50)  NULL,
```

Joi must constrain `SupplyType` to `GOODS` | `SERVICE`. `receipt.format.service.js` needs a
bifurcated tax summary block.

### 1.5 Tags — one model for both tag features

```sql
CREATE TABLE pos_menu_tag (
    Id        VARCHAR(50)  NOT NULL,
    Name      VARCHAR(100) NOT NULL,
    Code      VARCHAR(50)  NOT NULL,
    -- CATEGORY | BEVERAGE | CUISINE. One master, three uses — a second table
    -- per tag kind is how a taxonomy becomes unmaintainable.
    TagType   VARCHAR(20)  NOT NULL DEFAULT 'CATEGORY',
    SortOrder INT          NOT NULL DEFAULT 0,
    TenantId  VARCHAR(50)  NOT NULL,
    Active    TINYINT(1)   NOT NULL DEFAULT 1,
    CreatedOn DATETIME, CreatedBy VARCHAR(50),
    UpdatedOn DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Code, TenantId)
);

CREATE TABLE pos_item_meta_tag (
    Id VARCHAR(50) NOT NULL, ItemMetaId VARCHAR(50) NOT NULL, TagId VARCHAR(50) NOT NULL,
    TenantId VARCHAR(50) NOT NULL, Active TINYINT(1) NOT NULL DEFAULT 1,
    CreatedOn DATETIME, CreatedBy VARCHAR(50), UpdatedOn DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id), UNIQUE (ItemMetaId, TagId, TenantId),
    FOREIGN KEY (ItemMetaId) REFERENCES pos_item_meta(Id) ON DELETE CASCADE,
    FOREIGN KEY (TagId)      REFERENCES pos_menu_tag(Id)
);

CREATE TABLE pos_category_tag (
    Id VARCHAR(50) NOT NULL, CategoryId VARCHAR(50) NOT NULL, TagId VARCHAR(50) NOT NULL,
    TenantId VARCHAR(50) NOT NULL, Active TINYINT(1) NOT NULL DEFAULT 1,
    CreatedOn DATETIME, CreatedBy VARCHAR(50), UpdatedOn DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id), UNIQUE (CategoryId, TagId, TenantId),
    FOREIGN KEY (CategoryId) REFERENCES categorydetail(Id) ON DELETE CASCADE,
    FOREIGN KEY (TagId)      REFERENCES pos_menu_tag(Id)
);
```

### Phase 1 modules

| Module | Route base |
|---|---|
| `posmeattype` | `/api/pos/meat-types` |
| `posmenutag` | `/api/pos/menu-tags` |
| `positemnutrition` | `/api/pos/items/:itemMetaId/nutrition` (GET/PUT, 1:1 — no list) |
| **extend** `positemmeta` | serving, meat type, prep time, tag attach/detach |
| **extend** `itemdetail` | `SupplyType`, `SACCode` in schemas + service |
| **extend** `posreceipt` | GST 9(5) bifurcated summary |

**Closes:** Serving Information · Meat Type Tag · Nutritional Information · GST 9(5) ·
Category Tags · Beverage Tags (6 items)

---

# PHASE 2 — Category scheduling

### 2.1 `pos_category_schedule`

> **Model day and time together, in one row.** Zomato sends a category timing as a single rule
> ("Sat 18:00–23:00"), not as a day list and a separate time list. Splitting them into two
> tables makes every read a cross-product and every write ambiguous.

```sql
CREATE TABLE pos_category_schedule (
    Id         VARCHAR(50) NOT NULL,
    CategoryId VARCHAR(50) NOT NULL,
    -- 0 = Sunday .. 6 = Saturday, matching JS getDay(). A category with NO rows
    -- is available always; that is the default and must stay the default, or
    -- every existing category silently disappears from the menu.
    DayOfWeek  TINYINT     NOT NULL,
    StartTime  TIME        NOT NULL,
    EndTime    TIME        NOT NULL,
    TenantId   VARCHAR(50) NOT NULL,
    Active     TINYINT(1)  NOT NULL DEFAULT 1,
    CreatedOn  DATETIME, CreatedBy VARCHAR(50),
    UpdatedOn  DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (CategoryId, DayOfWeek, StartTime, TenantId),
    FOREIGN KEY (CategoryId) REFERENCES categorydetail(Id) ON DELETE CASCADE
);
```

**Resolution rule (implement in `poscategoryschedule.service.js`):** a category is available
when it has **no** schedule rows, **or** when now() falls inside any row for today's weekday.
Overnight windows (`22:00–02:00`) are stored as two rows by the service, never as one row with
`EndTime < StartTime` — that comparison silently matches nothing.

### Phase 2 modules

| Module | Route base |
|---|---|
| `poscategoryschedule` | `/api/pos/categories/:categoryId/schedule` (GET, PUT bulk-replace, DELETE) |

Bulk-replace rather than per-row CRUD: a weekly schedule is edited as a whole in the UI, and
row-by-row edits leave partial states visible to the portal mid-save.

**Closes:** Category Sub Category Timing · Category Day Schedule · Category Time Schedule
(3 items)

---

# PHASE 3 — Kitchen Preparation Time

The only order-side gap with **no existing foundation** — zero references to prep time or KPT
anywhere in the codebase. Zomato weights KPT accuracy in merchant ratings, so this is a
certification concern, not just a feature.

### 3.1 Schema

- `pos_item_meta.PrepTimeMinutes INT NULL` — per-dish default (added in Phase 1.1)
- On `pos_online_order`:

```sql
    -- What we told the portal this order would take, and when we said it.
    -- Distinct from PromisedOn, which is the PORTAL's delivery SLA.
    KptMinutes    INT      NULL,
    KptSetOn      DATETIME NULL,
```

### 3.2 Behaviour

1. On ingest, `posonlineorder.service` computes a suggested KPT =
   `MAX(PrepTimeMinutes)` across resolved lines, falling back to a branch default from
   `pos_setting` (`kpt.default_minutes`, seeded at 20).
2. The accept screen shows it, pre-filled and editable.
3. `POST /:id/accept` accepts an optional `KptMinutes` in the body, persists it with
   `KptSetOn`, and passes it to `adapter.pushStatus(order, 'accepted', credential)`.
4. `BaseAdapter.pushStatus` signature gains the KPT via the order object — **no signature
   change**, so `manual` and `httpAggregator` keep working untouched.

### Phase 3 changes

| File | Change |
|---|---|
| `posonlineorder.schemas.js` | `KptMinutes` on the accept schema |
| `posonlineorder.lifecycle.js` | Persist KPT in the accept transaction, before `pushStatusSafely` |
| `posonlineorder.service.js` | Suggested-KPT computation on ingest |
| `possetting` seed | `kpt.default_minutes` = 20 |
| `positemmeta.schemas.js` | `PrepTimeMinutes` |

**Closes:** Kitchen Preparation Time (1 item)

---

# PHASE 4 — Cooking instructions reach the kitchen

Today the raw `Payload` JSON preserves whatever Zomato sends, so nothing is lost — but there is
no modelled field and **it never reaches the KOT**. The kitchen cannot see it, which is the
entire point of the feature.

### 4.1 Schema

```sql
-- On pos_online_order:
    -- Order-level instruction from the customer ("no cutlery", "extra spicy").
    -- Promoted OUT of the raw payload so the KOT writer can reach it without
    -- knowing any portal's payload shape.
    CookingInstructions VARCHAR(500) NULL,
    NoCutlery           TINYINT(1)   NOT NULL DEFAULT 0,
```

Per-line instructions ride in the existing `OrderLines` JSON as an `Instructions` key —
normalised there by each adapter, so no schema change is needed per line.

### 4.2 Behaviour

- `BaseAdapter.normalize()` contract extends to populate `CookingInstructions`, `NoCutlery`,
  and per-line `Instructions`. `manual.adapter.js` picks them up from the queue form;
  `httpAggregator.adapter.js` from a configured field path.
- `posorder/posKotWriter.js` renders order-level and per-line instructions on the KOT.
- `posreceipt/receipt.format.service.js` renders them on the customer receipt.

### Phase 4 changes

| File | Change |
|---|---|
| `adapters/baseAdapter.js` | Extend `emptyInboundOrder` with the new fields |
| `adapters/manual.adapter.js` | Map from the manual queue form |
| `adapters/httpAggregator.adapter.js` | Map from configured paths |
| `posorder/posKotWriter.js` | **Render on the KOT** — the point of the phase |
| `posreceipt/receipt.format.service.js` | Render on the receipt |
| `posonlineorder.schemas.js` | Accept on manual create |

**Closes:** No Cutlery / Cooking Instruction (1 item)

---

# PHASE 5 — Coded rejection reasons

`CancelReason` is free-text `VARCHAR(255)`. The right pattern already exists nearby in
`pos_return_reason` (coded, seeded, with an `IsFault` flag) — but it serves *returns*, not
portal rejections, and the two vocabularies are different. A second table, same shape.

### 5.1 Schema

```sql
CREATE TABLE pos_rejection_reason (
    Id            VARCHAR(50)  NOT NULL,
    Name          VARCHAR(100) NOT NULL,
    Code          VARCHAR(50)  NOT NULL,
    -- The portal's OWN code for this reason. Zomato will not accept ours, and
    -- hardcoding a switch on portal name is what the adapter pattern exists to
    -- avoid. NULL means "not mapped to this portal".
    ExternalCode  VARCHAR(50)  NULL,
    PortalId      VARCHAR(50)  NULL,
    -- IOOS rejections MUST carry the offending item ids. This flag is what the
    -- UI reads to force an item picker before the reject button enables.
    RequiresItems TINYINT(1)   NOT NULL DEFAULT 0,
    Description   VARCHAR(255) NULL,
    SortOrder     INT          NOT NULL DEFAULT 0,
    TenantId      VARCHAR(50)  NOT NULL,
    Active        TINYINT(1)   NOT NULL DEFAULT 1,
    CreatedOn     DATETIME, CreatedBy VARCHAR(50),
    UpdatedOn     DATETIME, UpdatedBy VARCHAR(50),
    PRIMARY KEY (Id),
    UNIQUE (Code, PortalId, TenantId),
    FOREIGN KEY (PortalId) REFERENCES pos_portal(Id) ON DELETE CASCADE
);

-- On pos_online_order:
    RejectionReasonId VARCHAR(50) NULL,
    -- Which lines caused it, for an IOOS rejection. JSON array of ItemMetaIds.
    RejectedItemIds   JSON        NULL,
    ...
    FOREIGN KEY (RejectionReasonId) REFERENCES pos_rejection_reason(Id)
```

### 5.2 Behaviour

`lifecycle.reject()` validates: if the chosen reason has `RequiresItems = 1`, `RejectedItemIds`
must be a non-empty array of ids that resolve against the order's lines — a 400 otherwise, not
a silent accept. The adapter maps `ExternalCode` + item ids into the portal's payload.

> **Seed note:** Zomato's actual reason codes must come from their integration documentation.
> Seed a starter set (`ITEM_OUT_OF_STOCK` with `RequiresItems=1`, `KITCHEN_FULL`,
> `OUTLET_CLOSED`, `RIDER_UNAVAILABLE`, `OTHER`) and map `ExternalCode` during certification.

### Phase 5 modules

| Module | Route base |
|---|---|
| `posrejectionreason` | `/api/pos/rejection-reasons` |
| **extend** `posonlineorder` | reject schema + lifecycle validation |

**Closes:** Rejection Reason at par with Z · Rejection Message with IOOS marked (2 items)

---

# PHASE 6 — The Zomato adapter

**Deliberately last.** `pushMenu()` serialises the menu model into Zomato's format — every
attribute added afterwards means revisiting it. Finish the model, then write the adapter once.

### 6.1 `src/modules/posportal/adapters/zomato.adapter.js`

Implements the five `BaseAdapter` methods:

| Method | Responsibility |
|---|---|
| `verify(req, credential)` | HMAC the raw body against `credential.WebhookSecret`. Reject on mismatch **before** the payload is parsed. |
| `normalize(payload)` | Zomato order envelope → `emptyInboundOrder` shape. Resolve lines via `pos_portal_listing.ExternalItemId` and `pos_portal_listing_variant.ExternalVariantId`; unmatched lines are kept and flagged, never dropped. Populate charges, instructions, cutlery flag. |
| `mapStatus(externalStatus)` | Zomato lifecycle → `COMMON_STATUS_MAP`. |
| `pushStatus(order, status, credential)` | Accept (with KPT), reject (with reason code + item ids), ready, dispatched. Reports; never throws into the caller's transaction. |
| `pushMenu(listings, credential)` | Full menu serialisation: categories with schedules, items with variants, add-on groups, tags, nutrition, dietary and meat tags, GST fields. Writes `SyncStatus` / `SyncError` per listing. |

### 6.2 Registration

- Add `zomato` to `adapters/index.js` `REGISTRY`.
- Switch the seeded Zomato portal in `02-seed-data.sql` from `'manual'` to `'zomato'`.
- Populate `pos_portal_credential` for the tenant (API key, secret, base URL, webhook secret)
  through the existing `PUT /api/pos/portals/:id/credentials`.

### 6.3 Config

New env vars in `.env.example` (values are per-tenant in the DB, not env — these are only
transport defaults):

```
ZOMATO_API_TIMEOUT_MS=10000
ZOMATO_GRAPH_RETRY=2
```

**Closes:** the integration itself — makes every preceding phase actually reach Zomato.

---

# PHASE 7 — Real-time order alert

The queue is polled. A ringing alert needs a push channel — and polling tills is precisely the
load shape that exhausted the Aiven connection pool, so this pays for itself twice.

### 7.1 Approach

> **⚠ Decision for review.** Vercel's serverless functions cannot hold a WebSocket.
> Options: (a) **SSE** via a long-lived function — still constrained by execution limits;
> (b) **a hosted realtime service** (Pusher / Ably) — the portal writes an event, the browser
> subscribes; (c) **FCM web push** — reuses the push infrastructure the mobile app needs anyway.
> **Recommendation: (c).** It is the only option that serves both the web Front Desk and the
> planned mobile app from one implementation, and `notification_outbox` already exists as the
> durable queue behind it.

### 7.2 Changes

| File | Change |
|---|---|
| `database/01-schema-definition.sql` | `device_token` table (Id, UserPhone, TenantId, BranchDetailId, Token, Platform, Active, audit) |
| `src/modules/notification/` | FCM send path reading `notification_outbox` |
| `posportal.ingest.service.js` | Enqueue an outbox row on order arrival |
| new `posdevice` module | `/api/pos/devices` register / unregister |

**Closes:** Order Notification — Alert/Popup (1 item)

---

# Deferred — needs Zomato input before it can be specified

| Feature | Why deferred |
|---|---|
| **Merchant Agreed Cancellation** | The handshake protocol is Zomato's. `CancelReason`, `CancelledBy` and the cancelled status already exist; only the agreement loop is missing, and its shape depends on their API. |
| **Call Masking on Demand** | Requires Zomato's masking endpoint. Note the schema already assumes masked, rotating numbers — it deliberately does **not** auto-create a `pos_customer` from an aggregator order, to avoid poisoning the loyalty ledger. **That reasoning is correct and must not be changed** when this lands. |
| **Bulk Order Support** | No public contract for requesting an additional delivery partner. Confirm during certification whether it is required for your merchant tier. |

---

# Cross-cutting work (every phase)

### Seed + provisioning — do both, always

Every new master needs **two** entries or new tenants silently get an empty list:

1. `database/02-seed-data.sql` — global seed for the template tenant, `INSERT IGNORE` + fixed
   UUIDs, added to the PART header comment and the statement count.
2. `src/modules/mastersetup/posMasters.provision.js` — a `const` array plus a loop in
   `provisionPosMasters`, mirroring `FOOD_TYPES` / `CHANNELS` / `PORTALS`.

New masters requiring both: `pos_meat_type`, `pos_menu_tag`, `pos_addon_group` (empty is fine),
`pos_rejection_reason`.

### Constants

Each new module adds a `QUERIES.<MODULE>` block in `src/config/constants.js` with
`SELECT_ALL`, `COUNT`, `SELECT_BY_ID`, `INSERT`, `UPDATE`, `DELETE`.

### Schema drift check

`src/config/schemaCheck.js` holds `REQUIRED_COLUMNS`. **Add every new column added to an
existing table**, or a stale deployed database will not be reported.

New entries needed: `categorydetail: ['ParentId','SortOrder']`,
`pos_item_meta: ['ServesCount','PortionSize','MeatTypeId','PrepTimeMinutes']`,
`itemdetail: ['SupplyType','SACCode']`,
`pos_online_order: ['KptMinutes','KptSetOn','CookingInstructions','NoCutlery','RejectionReasonId','RejectedItemIds']`.

### Tests

One test file per new module under `src/__tests__/modules/`, following
`posfoodtype.service.test.js`. Additionally:

- `zomato.adapter.test.js` — `normalize()` against recorded Zomato payloads, including an
  order with an unmapped line (must be kept and flagged, not rejected) and a replayed webhook
  (must be idempotent).
- `poscategoryschedule.service.test.js` — the no-rows-means-always-available default, and the
  overnight-window split.
- `posonlineorder.reject.test.js` — IOOS rejection without item ids must 400.

### Documentation

Update `ENDPOINTS.md` and `API_DOCUMENTATION.md` per phase.

---

# Effort and sequencing

| Phase | Content | Items closed | Est. |
|---|---|---|---|
| 0 | Structural schema — sub-categories, add-ons, variant/category OOS | 7 | 1.5–2 wks |
| 1 | Menu attributes + compliance | 6 | 1–1.5 wks |
| 2 | Category scheduling | 3 | 3–5 days |
| 3 | Kitchen Preparation Time | 1 | 3–4 days |
| 4 | Cooking instructions to KOT | 1 | 2–3 days |
| 5 | Coded rejection reasons | 2 | 3–4 days |
| 6 | Zomato adapter | — | 2–3 wks |
| 7 | Real-time alert | 1 | 1 wk |
| — | Deferred (needs Zomato) | 3 | — |
| | **Total** | **21 of 24** | **8–11 wks** |

Frontend work in `tenant-auth-ui` runs alongside each phase and is **not** included above —
budget roughly 60% of backend effort again for the menu editor changes.

---

# Open decisions for review

Confirm these before Phase 0 begins; each changes what gets built.

1. **Category UNIQUE key** (§0.1) — keep `UNIQUE (Name, TenantId)` and accept globally unique
   category names? *Recommended: yes.* The alternative silently unconstrains top-level
   categories because MySQL treats NULLs as distinct.
2. **Nutrition storage** (§1.3) — separate `pos_item_nutrition` table, or columns on
   `pos_item_meta`? *Recommended: separate table.*
3. **Real-time transport** (§7.1) — FCM web push, SSE, or a hosted realtime service?
   *Recommended: FCM*, shared with the planned mobile app.
4. **Rebuild window.** Phases 0–5 all touch `01-schema-definition.sql`. Since there are no
   migrations, each rebuild is a drop-and-recreate. Confirm whether to **land the full schema
   for phases 0–5 in one edit** (one rebuild, recommended) or rebuild per phase.
5. **Zomato reason codes** (§5) — needed from their integration docs before `ExternalCode` can
   be seeded meaningfully.
6. **Certification tier** — confirm with Zomato whether Bulk Order Support and Call Masking are
   mandatory for your merchant tier, or optional.

---

*Plan written 6 Sep 2026 against the repository as read on that date. All "missing" claims were
verified by direct inspection of `01-schema-definition.sql`, `02-seed-data.sql` and
`src/modules/` — not inferred.*
