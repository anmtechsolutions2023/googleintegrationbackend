// src/modules/menu/menu.service.js
// The Menu screens' reads and writes: the dish list, the dish editor, the
// prices grid, bulk actions and dish photos. Every write goes through
// menu.dish.saveDish, so a dish saved from the editor, the grid, a bulk action
// or a file is the same dish.

const { v4: uuidv4 } = require('uuid');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES, MENU_PHOTO } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const { validateImage } = require('../posmedia/posmedia.service');
const m = require('./menu.masters');
const { loadDishes, saveDish } = require('./menu.dish');

const Q = () => QUERIES.MENU;

/** Everything the editor's pickers offer, in one read. */
const options = (tenantId) => withConnection(async (conn) => {
  const read = async (k) => (await conn.execute(Q()[k], [tenantId]))[0];
  const [branches, channels, portals, categories, units, taxGroups, taxRows, foodTypes, meatTypes, tags, variants, addonRows] = await Promise.all([
    read('BRANCHES'), read('CHANNELS'), read('PORTALS'), read('CATEGORIES'), read('UNITS'), read('TAX_GROUPS'),
    read('TAX_COMPONENTS'), read('FOOD_TYPES'), read('MEAT_TYPES'), read('TAGS'), read('VARIANTS'), read('ADDON_GROUPS'),
  ]);
  const groups = new Map();
  addonRows.forEach((r) => {
    const g = groups.get(r.Id) || { Id: r.Id, Name: r.Name, MinSelection: r.MinSelection, MaxSelection: r.MaxSelection, Addons: [] };
    if (r.AddonId) g.Addons.push({ Id: r.AddonId, Name: r.AddonName, Price: Number(r.AddonPrice), FoodType: r.AddonFoodType });
    groups.set(r.Id, g);
  });
  return {
    branches,
    channels,
    portals,
    categories: categories.map((c) => ({ Id: c.Id, Name: c.ParentName ? `${c.ParentName} › ${c.Name}` : c.Name })),
    units,
    taxGroups: taxGroups.map((g) => ({
      ...g,
      Components: taxRows.filter((t) => t.TaxGroupId === g.Id).map((t) => ({ name: t.Name, value: String(Number(t.Value)) })),
    })),
    foodTypes: foodTypes.map((f) => ({ ...f, IsVeg: !!Number(f.IsVeg) })),
    meatTypes,
    tags,
    variants: variants.map((v) => ({ ...v, Price: Number(v.Price) || 0 })),
    addonGroups: [...groups.values()],
  };
});

/** One line per dish, for the Dishes list. */
const listDishes = (tenantId) => withConnection(async (conn) => {
  const [dishes, [portals], [channels]] = await Promise.all([
    loadDishes(conn, tenantId),
    conn.execute(Q().PORTALS, [tenantId]),
    conn.execute(Q().CHANNELS, [tenantId]),
  ]);
  return {
    portals: portals.map((p) => ({ Id: p.Id, Name: p.Name })),
    // For the bulk bar's channel picker.
    channels: channels.map((c) => ({ Id: c.Id, Name: c.Name })),
    dishes: dishes.map((d) => ({
      itemId: d.itemId,
      code: d.code,
      name: d.name,
      category: d.category,
      diet: d.diet,
      price: d.price,
      taxGroup: d.taxGroup,
      taxIncluded: d.taxIncluded,
      branchCount: d.branches.length,
      branchPrices: d.branches.filter((b) => b.price !== null).length,
      channelCount: new Set(d.branches.flatMap((b) => b.channelIds)).size,
      variants: d.variants,
      addonGroups: d.addonGroups,
      tags: d.tags,
      portals: d.portals,
      status: d.status,
      hasPhoto: d.hasPhoto,
      photoVersion: d.photoVersion,
      stockTracked: d.stockTracked,
    })),
  };
});

const getDish = async (itemId, tenantId) => {
  const [dish] = await withConnection((conn) => loadDishes(conn, tenantId, [itemId]));
  if (!dish) throw new HttpError('Dish not found', 404);
  return dish;
};

/**
 * Save one dish from the editor. Creates the masters it names; returns the
 * saved dish and what was created alongside it.
 */
const save = async (dish, itemId, tenantId, userPhone) => {
  const ctx = m.newContext(tenantId, userPhone);
  const result = await withTransaction((conn) => saveDish(conn, { ...dish, itemId: itemId || null }, ctx));
  return { ...result, alsoCreated: ctx.created, dish: await getDish(result.itemId, tenantId) };
};

// ── Prices and channels ──────────────────────────────────────────────────────

/** Every dish with its base, branch and portal prices. */
const priceGrid = (tenantId) => withConnection(async (conn) => {
  const [dishes, [branches], [portals]] = await Promise.all([
    loadDishes(conn, tenantId),
    conn.execute(Q().BRANCHES, [tenantId]),
    conn.execute(Q().PORTALS, [tenantId]),
  ]);
  return {
    branches,
    portals: portals.map((p) => ({ Id: p.Id, Name: p.Name })),
    rows: dishes.map((d) => ({
      itemId: d.itemId,
      name: d.name,
      code: d.code,
      category: d.category,
      price: d.price,
      taxIncluded: d.taxIncluded,
      status: d.status,
      branches: Object.fromEntries(d.branches.map((b) => [b.branchId, { sold: true, price: b.price }])),
      portals: Object.fromEntries(d.portals.map((p) => [p.portalId, { listed: p.listed, price: p.price }])),
    })),
  };
});

/**
 * Apply a batch of price / listing changes, all or nothing.
 *
 * @param {Array<{itemId, base?, branchId?, portalId?, price?, listed?}>} changes
 */
const savePrices = async (changes, tenantId, userPhone) => {
  const byItem = new Map();
  changes.forEach((c) => {
    const list = byItem.get(c.itemId) || [];
    list.push(c);
    byItem.set(c.itemId, list);
  });
  const ctx = m.newContext(tenantId, userPhone);
  return withTransaction(async (conn) => {
    const dishes = await loadDishes(conn, tenantId, [...byItem.keys()]);
    if (dishes.length !== byItem.size) throw new HttpError('Some of these dishes no longer exist. Refresh and try again.', 404);
    for (const dish of dishes) {
      for (const c of byItem.get(dish.itemId)) {
        if (c.portalId) {
          const cur = dish.portals.find((p) => p.portalId === c.portalId);
          const next = cur || { portalId: c.portalId, listed: false, price: null, name: null };
          if (c.listed !== undefined) next.listed = !!c.listed;
          if (c.price !== undefined) {
            next.price = c.price;
            if (c.price !== null && c.listed === undefined) next.listed = true;
          }
          if (!cur) dish.portals.push(next);
        } else if (c.branchId) {
          const b = dish.branches.find((x) => x.branchId === c.branchId);
          if (!b) throw new HttpError(`${dish.name} is not sold at that branch. Turn it on in the dish editor first.`, 400);
          b.price = c.price;
        } else if (c.price !== undefined && c.price !== null) {
          dish.price = c.price;
        }
      }
      await saveDish(conn, { ...dish, taxComponents: undefined }, ctx);
    }
    return { updated: dishes.length };
  });
};

// ── Bulk actions from the Dishes list ────────────────────────────────────────

const BULK = {
  hide: (d) => { d.status = 'Hidden'; },
  show: (d) => { d.status = 'Active'; },
  addTag: (d, { value }) => { if (!d.tags.some((t) => m.key(t) === m.key(value))) d.tags.push(m.clean(value)); },
  removeTag: (d, { value }) => { d.tags = d.tags.filter((t) => m.key(t) !== m.key(value)); },
  list: (d, { portalId }) => {
    const p = d.portals.find((x) => x.portalId === portalId);
    if (p) p.listed = true; else d.portals.push({ portalId, listed: true, price: null, name: null });
  },
  unlist: (d, { portalId }) => {
    const p = d.portals.find((x) => x.portalId === portalId);
    if (p) p.listed = false;
  },
  // Channels are per branch: the change applies at every branch the dish is
  // sold at.
  addChannel: (d, { channelId }) => {
    d.branches.forEach((b) => { if (!b.channelIds.includes(channelId)) b.channelIds.push(channelId); });
  },
  // Refused rather than half-done in two cases: a dish left with no channel
  // at all (no channel reads as "sold everywhere"), and a channel a listed
  // portal sells through (saving would add it straight back).
  removeChannel: (d, { channelId, channelName, portals }) => {
    const via = portals.find((p) => p.ChannelId === channelId
      && d.portals.some((x) => x.portalId === p.Id && x.listed));
    if (via) throw new HttpError(`${d.name} is listed on ${via.Name}, which sells through ${channelName}. Unlist it from ${via.Name} first.`, 409);
    d.branches.forEach((b) => {
      const left = b.channelIds.filter((id) => id !== channelId);
      if (b.channelIds.length && !left.length) {
        throw new HttpError(`${channelName} is the only channel ${d.name} is sold on. Add another channel first, or hide the dish.`, 409);
      }
      b.channelIds = left;
    });
  },
};

const bulk = async ({ itemIds, action, value, portalId, channelId }, tenantId, userPhone) => {
  const apply = BULK[action];
  if (!apply) throw new HttpError('Unknown bulk action.', 400);
  const ctx = m.newContext(tenantId, userPhone);
  return withTransaction(async (conn) => {
    const dishes = await loadDishes(conn, tenantId, itemIds);
    if (dishes.length !== new Set(itemIds).size) throw new HttpError('Some of these dishes no longer exist. Refresh and try again.', 404);
    let channel = null;
    let portals = [];
    if (channelId) {
      const [[channels], [portalRows]] = await Promise.all([
        conn.execute(Q().CHANNELS, [tenantId]),
        conn.execute(Q().PORTALS, [tenantId]),
      ]);
      channel = channels.find((c) => c.Id === channelId);
      if (!channel) throw new HttpError('That channel does not exist.', 404);
      portals = portalRows;
    }
    for (const d of dishes) {
      apply(d, { value, portalId, channelId, channelName: channel?.Name, portals });
      await saveDish(conn, { ...d, taxComponents: undefined }, ctx);
    }
    return { updated: dishes.length, alsoCreated: ctx.created };
  });
};

// ── Photos ───────────────────────────────────────────────────────────────────

const assertItem = async (conn, itemId, tenantId) => {
  const [rows] = await conn.execute(QUERIES.ITEM_DETAIL.SELECT_BY_ID, [itemId, tenantId]);
  if (!rows[0]) throw new HttpError('Dish not found', 404);
};

/**
 * The list-size copy the browser made. Same checks as the photo itself, with
 * tighter bounds: it is shown dozens at a time on a guest's phone.
 */
const validateThumb = (dataUri) => {
  if (!dataUri) return null;
  const img = validateImage(dataUri);
  const { THUMB_MAX_PX, THUMB_MAX_BYTES } = MENU_PHOTO;
  if (img.byteSize > THUMB_MAX_BYTES || img.width > THUMB_MAX_PX || img.height > THUMB_MAX_PX) {
    throw new HttpError(`The thumbnail must be at most ${THUMB_MAX_PX}px and ${THUMB_MAX_BYTES / 1024}KB.`, 400);
  }
  return img;
};

/**
 * Store (or replace) a dish's photo from a data URI, with its thumbnail when
 * the browser sent one. Validated before writing.
 */
const putPhoto = async (itemId, dataUri, tenantId, userPhone, thumbDataUri = null) => {
  const img = validateImage(dataUri);
  const thumb = validateThumb(thumbDataUri);
  return withConnection(async (conn) => {
    await assertItem(conn, itemId, tenantId);
    await conn.execute(Q().PHOTO_UPSERT, [
      uuidv4(), tenantId, itemId, img.mimeType, img.width || null, img.height || null,
      img.byteSize, img.bytes,
      thumb ? thumb.mimeType : null, thumb ? thumb.byteSize : null, thumb ? thumb.bytes : null,
      userPhone, userPhone,
    ]);
    return {
      itemId, mimeType: img.mimeType, width: img.width, height: img.height, byteSize: img.byteSize,
      thumbByteSize: thumb ? thumb.byteSize : null,
    };
  });
};

/**
 * The photo's bytes, for an <img>: 'thumb' (the list copy, or the photo when a
 * photo predates thumbnails) or 'full'.
 *
 * @returns {Promise<{MimeType: string, Bytes: Buffer, Version: number}>}
 */
const getPhotoImage = (itemId, tenantId, size = 'thumb') => withConnection(async (conn) => {
  const sql = size === 'full' ? Q().PHOTO_IMAGE_FULL : Q().PHOTO_IMAGE_THUMB;
  const [rows] = await conn.execute(sql, [tenantId, itemId]);
  if (!rows[0]) throw new HttpError('This dish has no photo.', 404);
  return rows[0];
});

const getPhoto = (itemId, tenantId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(Q().PHOTO_GET, [tenantId, itemId]);
  if (!rows[0]) throw new HttpError('This dish has no photo.', 404);
  return rows[0];
});

const deletePhoto = (itemId, tenantId) => withConnection(async (conn) => {
  await conn.execute(Q().PHOTO_DELETE, [tenantId, itemId]);
});

// ── Backup ───────────────────────────────────────────────────────────────────

/**
 * The whole menu as the three files the import reads — menu.csv, addons.csv,
 * hours.csv — in one .zip. Taken before a clear, and offered on its own.
 */
const backup = async (user) => {
  // Required here, not at the top: the export catalogue reads the menu
  // definitions, which read this module's neighbours.
  const exportService = require('../export/export.service');
  const zip = require('../../utils/zip');
  const { businessDate } = require('../../utils/dateRange');
  const files = [];
  for (const [key, name] of [['menu', 'menu.csv'], ['menu-addons', 'addons.csv'], ['menu-hours', 'hours.csv']]) {
    const out = await exportService.run(key, {}, user);
    files.push({ name, data: out.csv, rows: out.rowCount });
  }
  return {
    fileName: `menu-backup_${businessDate()}.zip`,
    buffer: zip.build(files.map(({ name, data }) => ({ name, data }))),
    details: files.map((f) => `${f.name} ${f.rows} rows`).join(' · '),
  };
};

module.exports = {
  backup,
  options, listDishes, getDish, save, priceGrid, savePrices, bulk, putPhoto, getPhoto, getPhotoImage, deletePhoto,
};
