// src/modules/import/import.service.js
//
// Bulk import: a menu becomes a catalogue in two passes.
//
// WHY THIS EXISTS
// A 56-drink beverage menu is 126 form submissions today — 56 items, 56 menu
// entries, and the masters around them. That is three to four hours of typing
// for one page of one menu, and it is the bottleneck on onboarding a tenant.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It creates nothing of its own. Every record is written through the SAME
// createTx the ordinary forms call — category, uom, taxGroup, costInfo,
// itemDetail — so an imported item is not a different kind of item. No shadow
// table, no `imported` flag, no second code path to keep in step. That is what
// makes an imported row editable in Master Data → Items and publishable in Menu
// Master exactly like one typed by hand, and there is a test that proves it.
//
// TRANSACTION SHAPE
// One transaction PER ROW, not per file. A 56-row file where row 37 has a bad
// price must not discard the 36 rows that were fine. Within a row the whole
// subtree is atomic, so a failure can never leave orphan cost info behind.

const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES, IMPORT } = require('../../config/constants');
const { logger } = require('../../utils/logger');
const { HttpError } = require('../../middleware/errorHandler');

const category = require('../category/category.service');
const uom = require('../uom/uom.service');
const taxGroup = require('../taxgroup/taxgroup.service');
const costInfo = require('../costinfo/costinfo.service');
const itemDetail = require('../itemdetail/itemdetail.service');
const taxType = require('../taxtype/taxtype.service');
const taxMapper = require('../taxgrouptaxtypemapper/taxgrouptaxtypemapper.service');
// The publish pass calls positemmeta's ORDINARY create(), which already opens
// its own transaction and syncs the channel/variant links. That is exactly the
// per-row atomicity this import wants, so the module needs no changes at all.
const itemMeta = require('../positemmeta/positemmeta.service');

/**
 * Strip a label down to something two spellings of the same thing share.
 *
 * The CSV says whatever the person typed: `Non-Veg`, `non veg`, `NONVEG`,
 * `Non_Veg`. The database holds Name `Non-Veg` and Code `NONVEG`. Matching on
 * the code alone — which is what this did — silently failed for exactly the
 * value the template tells people to use, and the row then died at a NOT NULL
 * constraint with a message nobody could act on.
 *
 * @param {string} v
 * @returns {string} Upper-case, letters and digits only.
 */
const normaliseLabel = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * A comparable fingerprint for a set of tax components.
 *
 * Order-insensitive, so `CGST:2.5|SGST:2.5` and `SGST:2.5|CGST:2.5` are the
 * same instruction — and so is a row that states nothing, because the default
 * IS that pair. Only a genuinely different treatment produces a different
 * signature.
 *
 * @param {Array<{name: string, value: string|number}>} components
 * @returns {string}
 */
const taxSignature = (components) => components
  .map((c) => `${normaliseLabel(c.name)}:${Number(c.value)}`)
  .sort()
  .join('|');

// ─── Row outcomes ────────────────────────────────────────────────────────────
// Every row comes back as exactly one of these. The caller reports them; it
// never has to infer what happened from an error message.
const OUTCOME = { CREATED: 'created', UPDATED: 'updated', SKIPPED: 'skipped', FAILED: 'failed' };

/**
 * Find a record by name within the tenancy, or create it.
 *
 * The pattern the tenant provisioner already uses (`ensureByName`), lifted here
 * because an import is mostly this: 56 rows naming eight categories between
 * them must produce eight categories, not 56.
 *
 * @param {Object} conn - Active transaction connection.
 * @param {Object} ctx - { cache, tenantId, userEmail, created }
 * @param {string} kind - 'category' | 'uom' | 'taxGroup', for the cache and counters.
 * @param {string} lookupSql
 * @param {string} name
 * @param {Function} create - (conn) => Promise<{id}>
 * @returns {Promise<string>} The id.
 */
const ensureByName = async (conn, ctx, kind, lookupSql, name, create) => {
  const key = `${kind}:${name.toLowerCase()}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key);

  const [rows] = await conn.execute(lookupSql, [name, ctx.tenantId]);
  if (rows.length > 0) {
    ctx.cache.set(key, rows[0].Id);
    return rows[0].Id;
  }

  const record = await create(conn);
  ctx.created[kind] = (ctx.created[kind] || 0) + 1;
  ctx.cache.set(key, record.id);
  return record.id;
};

/**
 * Ensure a tax group actually holds the rates it is named for.
 *
 * A tax group is a container: the rates live in TaxTypes mapped into it. The
 * import used to create the group and stop, so "GST 5%" meant 5% to a human and
 * 0% to the pricing engine — a menu that looked imported and charged no tax.
 *
 * Components are stated by the file (`CGST:2.5|SGST:2.5`). When a row states
 * none, IMPORT.DEFAULT_TAX_COMPONENTS is applied — a deliberate product
 * decision that a menu priced at 0% is the worse outcome. The preview reports
 * how many rows that will touch, so it is never applied silently.
 *
 * Idempotent in both directions: an existing tax type is reused by name, and an
 * existing mapping is left alone.
 *
 * @param {Object} conn - Active transaction connection.
 * @param {Object} ctx
 * @param {string} taxGroupId
 * @param {Array<{name: string, value: string}>} components
 * @returns {Promise<void>}
 */
const ensureTaxComponents = async (conn, ctx, taxGroupId, components) => {
  for (const component of components) {
    const name = String(component.name).trim();
    // eslint-disable-next-line no-await-in-loop
    const typeId = await ensureByName(
      conn, ctx, 'taxTypes', QUERIES.TAX_TYPES.SELECT_BY_NAME, name,
      (c) => taxType.createTx(c, { Name: name, Value: String(component.value), Active: true },
        ctx.tenantId, ctx.userEmail),
    );

    // No unique key on (group, type), so nothing else would stop a second run
    // mapping the same rate in twice and doubling the tax.
    // eslint-disable-next-line no-await-in-loop
    const [mapped] = await conn.execute(
      QUERIES.TAX_GROUP_TAX_TYPE_MAPPER.SELECT_BY_GROUP_AND_TYPE,
      [taxGroupId, typeId, ctx.tenantId],
    );
    if (mapped.length > 0) continue;

    // eslint-disable-next-line no-await-in-loop
    await taxMapper.createTx(conn, {
      TaxGroupId: taxGroupId, TaxTypeId: typeId, Active: true,
    }, ctx.tenantId, ctx.userEmail);
    ctx.created.taxMappings = (ctx.created.taxMappings || 0) + 1;
  }
};

/**
 * Import catalogue items — pass one.
 *
 * @param {Array<Object>} rows - Validated rows: { name, category, unit, price, taxGroup, … }
 * @param {Object} options - { onDuplicate: 'skip' | 'update' }
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<{summary: Object, created: Object, rows: Array}>}
 */
const importItems = async (rows, options, tenantId, userEmail) => {
  const onDuplicate = options?.onDuplicate === 'update' ? 'update' : 'skip';

  // Shared across rows so the masters are resolved once, not 56 times. Safe
  // because each id it holds was committed by the row that created it.
  const ctx = {
    cache: new Map(), tenantId, userEmail, created: {},
    // What each group looked like BEFORE this run, and what this run has asked
    // of it. Both are per-import, not per-row — see the tax rules below.
    groupHadRates: new Map(),
    taxAsk: new Map(),
  };
  const results = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 1;

    try {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await withTransaction(async (conn) => {
        const [existingRows] = await conn.execute(
          QUERIES.ITEM_DETAIL.SELECT_BY_NAME, [row.name, tenantId],
        );
        const existing = existingRows[0];

        // A re-run must not quietly rewrite prices somebody has since corrected
        // by hand, so skipping is the default and updating is a deliberate choice.
        if (existing && onDuplicate === 'skip') {
          return { status: OUTCOME.SKIPPED, itemId: existing.Id,
            reason: 'An item with this name already exists' };
        }

        const categoryId = await ensureByName(
          conn, ctx, 'categories', QUERIES.CATEGORY.SELECT_BY_NAME, row.category,
          (c) => category.createTx(c, { Name: row.category, Active: true }, tenantId, userEmail),
        );
        const uomId = await ensureByName(
          conn, ctx, 'units', QUERIES.UOM.SELECT_BY_NAME, row.unit,
          (c) => uom.createTx(c, { UnitName: row.unit, IsPrimary: true, Active: true }, tenantId, userEmail),
        );
        const taxGroupId = await ensureByName(
          conn, ctx, 'taxGroups', QUERIES.TAX_GROUP.SELECT_BY_NAME, row.taxGroup,
          (c) => taxGroup.createTx(c, { Name: row.taxGroup, Active: true }, tenantId, userEmail),
        );

        // The group alone prices at 0%, so give it the rates it is named for —
        // but only when it has none. Two rules, and both are about the same
        // failure: wrong tax is worse than no tax, because no tax is visibly
        // zero and wrong tax is plausible.
        //
        //   1. A group that ALREADY held rates before this import is never
        //      touched. Stacking a 5% default onto a group carrying IGST 5%
        //      would price it at 10%.
        //   2. Within one file, a group cannot be asked for two different
        //      treatments. Row 1 taking the default and row 2 stating IGST
        //      would stack for the same reason — and which one the operator
        //      meant is not something to guess at.
        //
        // The snapshot is taken once per group and reused, so later rows see
        // what the group looked like BEFORE this run, not what earlier rows in
        // the same run just wrote.
        const wanted = row.taxComponents?.length
          ? row.taxComponents
          : IMPORT.DEFAULT_TAX_COMPONENTS;
        const signature = taxSignature(wanted);

        const asked = ctx.taxAsk.get(taxGroupId);
        if (asked && asked !== signature) {
          throw new HttpError(
            `Tax group “${row.taxGroup}” is given two different sets of rates in this file. `
            + 'Use the same rates everywhere the group appears, or give it its own group.',
            400,
          );
        }
        ctx.taxAsk.set(taxGroupId, signature);

        if (!ctx.groupHadRates.has(taxGroupId)) {
          const [before] = await conn.execute(
            QUERIES.TAX_GROUP_TAX_TYPE_MAPPER.SELECT_COMPONENTS_OF_GROUP,
            [taxGroupId, tenantId],
          );
          ctx.groupHadRates.set(
            taxGroupId,
            before.length > 0
              ? taxSignature(before.map((c) => ({ name: c.Name, value: c.Value })))
              : null,
          );
        }
        const already = ctx.groupHadRates.get(taxGroupId);

        if (already === null) {
          // Empty group: fill it, whether from the file or from the default.
          await ensureTaxComponents(conn, ctx, taxGroupId, wanted);
        } else if (already !== signature && row.taxComponents?.length) {
          // The group is configured and the file explicitly asks for something
          // else. Adding would stack; ignoring would make the column a lie.
          // Neither — say so, and let a person decide.
          throw new HttpError(
            `Tax group “${row.taxGroup}” already carries different rates. `
            + 'Change them in Master Data → Tax Groups, or name a different group here.',
            400,
          );
        }
        // Configured and matching, or configured and the row stated nothing:
        // nothing to do. A re-run of the same file lands here, which is why it
        // is a no-op rather than a failure.

        const cost = await costInfo.createTx(conn, {
          Amount: String(row.price),
          TaxGroupId: taxGroupId,
          IsTaxIncluded: row.taxIncluded !== false,
          Active: true,
        }, tenantId, userEmail);

        if (existing) {
          // Update re-points the item at a NEW cost info rather than editing the
          // old one in place: a settled ledger line references the cost info it
          // was priced from, and rewriting that would restate history.
          await itemDetail.updateTx(conn, existing.Id, {
            Name: row.name,
            Code: row.code ?? existing.Code,
            Description: row.description ?? existing.Description,
            CategoryId: categoryId,
            UOMId: uomId,
            CostInfoId: cost.id,
            Active: true,
          }, tenantId, userEmail);
          return { status: OUTCOME.UPDATED, itemId: existing.Id };
        }

        const item = await itemDetail.createTx(conn, {
          Name: row.name,
          Code: row.code || null,
          Description: row.description || null,
          CategoryId: categoryId,
          UOMId: uomId,
          CostInfoId: cost.id,
          Active: true,
        }, tenantId, userEmail);

        return { status: OUTCOME.CREATED, itemId: item.id };
      });

      results.push({ row: line, name: row.name, ...outcome });
    } catch (err) {
      // The row is reported and the loop continues. Losing 55 good rows to one
      // bad one is the behaviour this design exists to avoid.
      logger.warn('Import row failed', { row: line, name: row.name, error: err.message });
      results.push({
        row: line, name: row.name, status: OUTCOME.FAILED,
        reason: err.sqlMessage || err.message || 'Could not be imported',
      });
    }
  }

  const summary = {
    total: rows.length,
    created: results.filter((r) => r.status === OUTCOME.CREATED).length,
    updated: results.filter((r) => r.status === OUTCOME.UPDATED).length,
    skipped: results.filter((r) => r.status === OUTCOME.SKIPPED).length,
    failed: results.filter((r) => r.status === OUTCOME.FAILED).length,
  };

  logger.info('Item import finished', { tenantId, ...summary });
  return { summary, created: ctx.created, rows: results };
};

/**
 * Which tax groups this import touched have no tax types mapped to them.
 *
 * A group with no types computes 0% tax and looks like a perfectly working
 * setup — the failure mode that silently prices a whole menu at zero. Surfaced
 * as a warning rather than an error because a genuinely zero-rated group is
 * legitimate; the caller decides what to do about it.
 *
 * @param {string[]} names
 * @param {string} tenantId
 * @returns {Promise<string[]>} Names of groups holding no tax types.
 */
const findEmptyTaxGroups = (names, tenantId) =>
  withConnection(async (conn) => {
    const empty = [];
    for (const name of [...new Set(names.filter(Boolean))]) {
      // eslint-disable-next-line no-await-in-loop
      const [groups] = await conn.execute(QUERIES.TAX_GROUP.SELECT_BY_NAME, [name, tenantId]);
      if (groups.length === 0) { empty.push(name); continue; }   // not created yet → will be empty
      // eslint-disable-next-line no-await-in-loop
      const [[{ total }]] = await conn.execute(
        QUERIES.TAX_GROUP.COUNT_TYPES_IN_GROUP, [groups[0].Id, tenantId],
      );
      if (Number(total) === 0) empty.push(name);
    }
    return empty;
  });

/**
 * Publish catalogue items onto one branch's menu — pass two.
 *
 * Items are tenancy-wide; nothing sells until it exists as a menu entry against
 * a branch. Takes item NAMES rather than ids so the same file drives both
 * passes.
 *
 * @param {Object} payload - { branchDetailId, defaultFoodType, channelIds, variantIds, items }
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<{summary: Object, rows: Array}>}
 */
const importMenuEntries = async (payload, tenantId, userEmail) => {
  const { branchDetailId, defaultFoodType, channelIds = [], variantIds = [], items } = payload;
  const results = [];
  // Loaded once and matched in JS. The tenancy has three food types; fetching
  // all of them costs one query and lets NAME and CODE be compared on equal
  // terms after punctuation is stripped — which SQL cannot do consistently
  // across collations, and which is the whole reason `Non-Veg` failed.
  let foodTypes = null;
  const loadFoodTypes = async (conn) => {
    if (foodTypes) return foodTypes;
    const [rows] = await conn.execute(QUERIES.POS_FOOD_TYPE.SELECT_ALL_FOR_TENANT, [tenantId]);
    foodTypes = rows;
    return foodTypes;
  };

  const resolveFoodType = async (conn, label) => {
    const wanted = normaliseLabel(label);
    if (!wanted) return null;
    const all = await loadFoodTypes(conn);
    // Exact match after normalising, never a prefix — VEG must not match VEGAN.
    const hit = all.find((f) => normaliseLabel(f.Code) === wanted
      || normaliseLabel(f.Name) === wanted);
    return hit?.Id || null;
  };

  // For the error message: telling somebody their value is wrong without
  // saying what would be right just moves the guessing.
  const knownFoodTypes = async (conn) =>
    (await loadFoodTypes(conn)).map((f) => f.Name).join(', ');

  for (let i = 0; i < items.length; i += 1) {
    const entry = items[i];
    const line = i + 1;

    try {
      // Resolve on a plain connection, then hand off to positemmeta.create(),
      // which owns its own transaction. A concurrent double-publish would race
      // past this check and be caught by UNIQUE (item, branch, tenant) — the
      // catch below reports that as a skip rather than a crash.
      // eslint-disable-next-line no-await-in-loop
      const resolved = await withConnection(async (conn) => {
        const [itemRows] = await conn.execute(
          QUERIES.ITEM_DETAIL.SELECT_BY_NAME, [entry.name, tenantId],
        );
        if (itemRows.length === 0) {
          return { status: OUTCOME.FAILED, reason: 'No catalogue item with this name' };
        }

        const [already] = await conn.execute(
          QUERIES.POS_ITEM_META.SELECT_BY_ITEM_BRANCH,
          [itemRows[0].Id, branchDetailId, tenantId],
        );
        if (already.length > 0) {
          return { status: OUTCOME.SKIPPED, menuItemId: already[0].Id,
            reason: 'Already on this branch\u2019s menu' };
        }

        // The ROW's own food type wins; the default is a fallback for rows that
        // leave the column blank, not an override of what the file said. It
        // being an override is exactly the bug this fixes — every item on a
        // mixed menu published as Veg.
        const wanted = entry.foodType || defaultFoodType;
        const foodTypeId = await resolveFoodType(conn, wanted);
        if (!foodTypeId) {
          // FoodTypeId is NOT NULL, so without this the row would die at the
          // constraint with a message nobody can act on.
          return { status: OUTCOME.FAILED,
            reason: `No food type matching \u201C${wanted}\u201D. This tenancy has: `
              + `${await knownFoodTypes(conn)}` };
        }

        return { itemId: itemRows[0].Id, foodTypeId };
      });

      let outcome = resolved;
      if (resolved.itemId) {
        // eslint-disable-next-line no-await-in-loop
        const meta = await itemMeta.create({
          ItemDetailId: resolved.itemId,
          FoodTypeId: resolved.foodTypeId,
          BranchDetailId: branchDetailId,
          ChannelIds: channelIds,
          VariantIds: variantIds,
          Active: true,
        }, tenantId, userEmail);
        outcome = { status: OUTCOME.CREATED, menuItemId: meta.id };
      }

      results.push({ row: line, name: entry.name, ...outcome });
    } catch (err) {
      logger.warn('Menu publish row failed', { row: line, name: entry.name, error: err.message });
      results.push({
        row: line, name: entry.name, status: OUTCOME.FAILED,
        reason: err.sqlMessage || err.message || 'Could not be published',
      });
    }
  }

  const summary = {
    total: items.length,
    created: results.filter((r) => r.status === OUTCOME.CREATED).length,
    skipped: results.filter((r) => r.status === OUTCOME.SKIPPED).length,
    failed: results.filter((r) => r.status === OUTCOME.FAILED).length,
  };

  logger.info('Menu publish finished', { tenantId, branchDetailId, ...summary });
  return { summary, rows: results };
};

module.exports = { importItems, importMenuEntries, findEmptyTaxGroups, OUTCOME, MAX_ROWS: IMPORT?.MAX_ROWS };
