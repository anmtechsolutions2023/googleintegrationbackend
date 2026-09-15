// src/modules/ledger/ledger.options.report.js
// Which options and add-ons sell, on which dishes, and how often they are taken.
//
// Built from the SNAPSHOT on each invoice line (Variants / Addons JSON), never
// from the menu masters: renaming "Half" to "Half portion" or repricing Raita
// must not rewrite what history says was sold.
//
// "Take rate" needs a denominator, and the honest one is the plates of dishes
// that OFFER the choice. A dish counts as offering it if it is mapped to it on
// the menu today, or if it actually sold with it in the period — so a choice
// that has since been unmapped still gets a real denominator, and the rate can
// never exceed 100%.
//
// Pure: takes rows, returns the report. The SQL lives in constants and the
// connection in ledger.report.service, so this can be tested without either.

const num = (v) => Number(v || 0);
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

/** One snapshotted choice, in either shape a line has ever stored. */
const choiceOf = (raw) => {
  if (typeof raw === 'string') return raw ? { id: null, name: raw, price: 0 } : null;
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name ?? raw.Name ?? '').trim();
  if (!name) return null;
  return {
    id: raw.id ?? raw.Id ?? null,
    name,
    price: num(raw.price ?? raw.Price),
    groupId: raw.groupId ?? raw.AddonGroupId ?? null,
    groupName: raw.groupName ?? raw.GroupName ?? null,
    maxSelection: raw.maxSelection ?? raw.MaxSelection ?? null,
  };
};

// A choice with no id (a very old snapshot) is keyed by name, so it still
// aggregates with itself rather than once per line.
const choiceKey = (c) => c.id || `name:${c.name.toLowerCase()}`;
const groupKey = (c) => c.groupId || `name:${String(c.groupName || 'Add-ons').toLowerCase()}`;

const bump = (map, key, make) => {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
};

const addDish = (dishes, itemId, plates) => {
  dishes.set(itemId, (dishes.get(itemId) || 0) + plates);
};

/**
 * @param {Array<Object>} productRows - PRODUCT_SALES rows: ItemId, ItemName,
 *   CategoryName, QuantitySold, OptionsAmount, AddonsAmount, GrossAmount.
 * @param {Array<Object>} lineRows - OPTION_LINES rows: ItemId, Quantity, Variants, Addons.
 * @param {Array<Object>} offerRows - OPTION_OFFERS rows: ItemId, Kind ('variant'|'group'), OptionId.
 * @returns {Object} { totals, variants, addonGroups, products }
 */
const buildOptionsReport = (productRows = [], lineRows = [], offerRows = []) => {
  const products = new Map();
  (productRows || []).forEach((r) => {
    products.set(r.ItemId, {
      ItemId: r.ItemId,
      ItemName: r.ItemName || r.ItemId,
      CategoryName: r.CategoryName || null,
      Plates: num(r.QuantitySold),
      GrossAmount: num(r.GrossAmount),
      OptionsAmount: num(r.OptionsAmount),
      AddonsAmount: num(r.AddonsAmount),
      platesWithOption: 0,
      variants: new Map(),
      groups: new Map(),
    });
  });
  const productOf = (itemId) => bump(products, itemId, () => ({
    ItemId: itemId, ItemName: itemId, CategoryName: null, Plates: 0, GrossAmount: 0,
    OptionsAmount: 0, AddonsAmount: 0, platesWithOption: 0, variants: new Map(), groups: new Map(),
  }));

  const offers = { variant: new Map(), group: new Map() };
  (offerRows || []).forEach((r) => {
    const kind = r.Kind === 'group' ? 'group' : 'variant';
    if (!r.OptionId || !r.ItemId) return;
    bump(offers[kind], r.OptionId, () => new Set()).add(r.ItemId);
  });

  const variants = new Map();
  const groups = new Map();

  (lineRows || []).forEach((line) => {
    const plates = num(line.Quantity);
    if (plates <= 0) return;
    const product = productOf(line.ItemId);

    const chosen = asArray(line.Variants).map(choiceOf).filter(Boolean);
    if (chosen.length > 0) product.platesWithOption += plates;
    chosen.forEach((v) => {
      const key = choiceKey(v);
      const menu = bump(variants, key, () => ({
        VariantId: v.id, Name: v.name, Price: v.price, Plates: 0, Revenue: 0, dishes: new Map(),
      }));
      menu.Plates += plates;
      menu.Revenue += plates * v.price;
      addDish(menu.dishes, line.ItemId, plates);

      const own = bump(product.variants, key, () => ({
        VariantId: v.id, Name: v.name, Price: v.price, Plates: 0, Revenue: 0,
      }));
      own.Plates += plates;
      own.Revenue += plates * v.price;
    });

    // A group is TAKEN once per plate, however many of its add-ons were picked
    // on it: two toppings on one pizza is one pizza that took toppings.
    const onLine = new Map();
    asArray(line.Addons).map(choiceOf).filter(Boolean).forEach((a) => {
      const gKey = groupKey(a);
      const menuGroup = bump(groups, gKey, () => ({
        GroupId: a.groupId, GroupName: a.groupName || 'Add-ons', MaxSelection: a.maxSelection,
        Plates: 0, Revenue: 0, dishes: new Map(), addons: new Map(),
      }));
      const menuAddon = bump(menuGroup.addons, choiceKey(a), () => ({
        AddonId: a.id, Name: a.name, Price: a.price, Plates: 0, Revenue: 0, dishes: new Map(),
      }));
      menuAddon.Plates += plates;
      menuAddon.Revenue += plates * a.price;
      addDish(menuAddon.dishes, line.ItemId, plates);

      const ownGroup = bump(product.groups, gKey, () => ({
        GroupId: a.groupId, GroupName: a.groupName || 'Add-ons', MaxSelection: a.maxSelection,
        Plates: 0, Revenue: 0, addons: new Map(),
      }));
      const ownAddon = bump(ownGroup.addons, choiceKey(a), () => ({
        AddonId: a.id, Name: a.name, Price: a.price, Plates: 0, Revenue: 0,
      }));
      ownAddon.Plates += plates;
      ownAddon.Revenue += plates * a.price;

      const seen = bump(onLine, gKey, () => ({ menuGroup, ownGroup, revenue: 0 }));
      seen.revenue += plates * a.price;
    });
    onLine.forEach(({ menuGroup, ownGroup, revenue }) => {
      menuGroup.Plates += plates;
      menuGroup.Revenue += revenue;
      addDish(menuGroup.dishes, line.ItemId, plates);
      ownGroup.Plates += plates;
      ownGroup.Revenue += revenue;
    });
  });

  // Plates of the dishes that offer a choice: mapped today, or sold with it.
  const offeredPlates = (soldOn, mappedTo) => {
    const dishes = new Set([...soldOn.keys(), ...(mappedTo || [])]);
    let plates = 0;
    dishes.forEach((id) => { plates += products.get(id)?.Plates || 0; });
    return plates;
  };
  const dishList = (dishes) => [...dishes.entries()]
    .map(([ItemId, Plates]) => ({ ItemId, ItemName: products.get(ItemId)?.ItemName || ItemId, Plates }))
    .sort((a, b) => b.Plates - a.Plates);
  const byRevenue = (a, b) => (b.Revenue - a.Revenue) || (b.Plates - a.Plates);

  const variantList = [...variants.values()].map((v) => {
    const offered = offeredPlates(v.dishes, offers.variant.get(v.VariantId));
    return {
      VariantId: v.VariantId, Name: v.Name, Price: round2(v.Price),
      Plates: v.Plates, OfferedPlates: offered, TakeRate: pct(v.Plates, offered),
      Revenue: round2(v.Revenue), Dishes: dishList(v.dishes),
    };
  }).sort(byRevenue);

  const groupList = [...groups.values()].map((g) => {
    const offered = offeredPlates(g.dishes, offers.group.get(g.GroupId));
    return {
      GroupId: g.GroupId, GroupName: g.GroupName, MaxSelection: g.MaxSelection,
      Plates: g.Plates, OfferedPlates: offered, TakeRate: pct(g.Plates, offered),
      Revenue: round2(g.Revenue),
      Addons: [...g.addons.values()].map((a) => ({
        AddonId: a.AddonId, Name: a.Name, Price: round2(a.Price),
        Plates: a.Plates, TakeRate: pct(a.Plates, offered), Revenue: round2(a.Revenue),
        Dishes: dishList(a.dishes),
      })).sort(byRevenue),
    };
  }).sort(byRevenue);

  // Per dish, only for dishes that sold with a choice or offer one — the
  // Products tab expands exactly those rows.
  const productDetail = {};
  products.forEach((p) => {
    const offersVariant = [...offers.variant.values()].some((s) => s.has(p.ItemId));
    const offersGroup = [...offers.group.values()].some((s) => s.has(p.ItemId));
    if (p.variants.size === 0 && p.groups.size === 0 && !offersVariant && !offersGroup) return;
    productDetail[p.ItemId] = {
      ItemId: p.ItemId,
      ItemName: p.ItemName,
      CategoryName: p.CategoryName,
      Plates: p.Plates,
      GrossAmount: round2(p.GrossAmount),
      OptionsAmount: round2(p.OptionsAmount),
      AddonsAmount: round2(p.AddonsAmount),
      // What this dish offers on today's menu, so a screen narrowing the report
      // to a category or a dish can recompute take rates exactly.
      OfferedVariantIds: [...offers.variant.entries()].filter(([, s]) => s.has(p.ItemId)).map(([id]) => id),
      OfferedGroupIds: [...offers.group.entries()].filter(([, s]) => s.has(p.ItemId)).map(([id]) => id),
      PlatesWithoutOption: (p.variants.size > 0 || offersVariant)
        ? Math.max(0, p.Plates - p.platesWithOption) : null,
      variants: [...p.variants.values()]
        .map((v) => ({ ...v, Price: round2(v.Price), Revenue: round2(v.Revenue), TakeRate: pct(v.Plates, p.Plates) }))
        .sort(byRevenue),
      addonGroups: [...p.groups.values()].map((g) => ({
        GroupId: g.GroupId, GroupName: g.GroupName, MaxSelection: g.MaxSelection,
        Plates: g.Plates, Revenue: round2(g.Revenue), TakeRate: pct(g.Plates, p.Plates),
        addons: [...g.addons.values()]
          .map((a) => ({ ...a, Price: round2(a.Price), Revenue: round2(a.Revenue), TakeRate: pct(a.Plates, p.Plates) }))
          .sort(byRevenue),
      })).sort(byRevenue),
    };
  });

  let optionsAmount = 0;
  let addonsAmount = 0;
  let grossAmount = 0;
  let plates = 0;
  products.forEach((p) => {
    optionsAmount += p.OptionsAmount;
    addonsAmount += p.AddonsAmount;
    grossAmount += p.GrossAmount;
    plates += p.Plates;
  });

  return {
    totals: {
      OptionsAmount: round2(optionsAmount),
      AddonsAmount: round2(addonsAmount),
      GrossAmount: round2(grossAmount),
      Plates: plates,
      ShareOfRevenue: pct(optionsAmount + addonsAmount, grossAmount),
    },
    variants: variantList,
    addonGroups: groupList,
    products: productDetail,
  };
};

module.exports = { buildOptionsReport, choiceOf };
