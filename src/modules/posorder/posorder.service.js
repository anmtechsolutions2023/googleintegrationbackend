// src/modules/posorder/posorder.service.js
// POS Order service — business logic extending BaseCRUDService (SRP + DIP).

const { v4: uuidv4 } = require('uuid');
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withTransaction, withConnection } = require('../../utils/dbHelper');
const {
  calculatePagination,
  getPaginationMetadata,
  extractCount,
} = require('../../utils/paginationHelper');

const pricingService = require('../pricing/pricing.service');
const itemMetaRepository = require('../positemmeta/positemmeta.repository');
const { transfer: transferImpl, refreshTable } = require('./posorder.transfer');
const { issuePosNumber } = require('./posNumbering');
const { writeKot, findLiveKotTx } = require('./posKotWriter');
const { resolveVenueTx } = require('./posVenue');
const { withCleanNotes, assertNotesFit, cleanInstructions } = require('./kitchenNotes');
const { HttpError } = require('../../middleware/errorHandler');
const categorySchedule = require('../poscategoryschedule/poscategoryschedule.service');

// A round past this point is history: it can be reprinted for the record but not
// re-cooked, and it no longer counts towards a table's occupancy.
const CLOSED_STATUSES = new Set(['closed', 'settled', 'cancelled']);

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

/**
 * Variant ids on an order line. Accepts either a plain id array (`variantIds`)
 * or the resolved objects a previous order stored (`variants`), so a repeat
 * order can be placed straight from a past round.
 * @param {Object} line
 * @returns {string[]}
 */
const normalizeVariantIds = (line) => {
  if (Array.isArray(line.variantIds)) return line.variantIds.filter(Boolean);
  if (Array.isArray(line.variants)) {
    return line.variants.map((v) => (typeof v === 'string' ? v : v?.id)).filter(Boolean);
  }
  return [];
};

/**
 * Add-on ids on an order line, accepted in the same two shapes and for the same
 * reason — a round repeated from a past order carries resolved objects, not ids.
 * @param {Object} line
 * @returns {string[]}
 */
const normalizeAddonIds = (line) => {
  if (Array.isArray(line.addonIds)) return line.addonIds.filter(Boolean);
  if (Array.isArray(line.addons)) {
    return line.addons.map((a) => (typeof a === 'string' ? a : a?.id)).filter(Boolean);
  }
  return [];
};

class PosOrderService extends BaseCRUDService {
  constructor() {
    super('POS Order', QUERIES.POS_ORDER);
  }

  /**
   * Prices an order's Items[] over the tax chain and returns the priced lines
   * plus the order's totals.
   *
   * The server is authoritative: whatever SubTotal/TaxAmount/Total the client
   * sent is discarded and recomputed here. Each line is stamped with a snapshot
   * (net/tax/gross + component split) so the bill — and any reprint years later
   * — reflects the rates in force when the order was placed.
   *
   * Lines carry `costInfoId` when the client knows it; otherwise the item-meta
   * id in `id` is resolved to one, so older clients keep working.
   *
   * @param {Array<Object>} items - Raw Items[] from the request.
   * @param {string} tenantId
   * @returns {Promise<{items:Array, totals:Object}|null>} null when nothing is priceable.
   */
  async priceItems(items, tenantId) {
    // Notes cleaned here as well as in create, because the portal path prices
    // through this seam directly and calls its note `notes`.
    const raw = withCleanNotes(asArray(items));
    if (raw.length === 0) return null;

    // Fill in any missing costInfoId from the menu row the line points at.
    const unresolved = raw.filter((i) => !i.costInfoId && (i.id || i.Id));
    let metaMap = new Map();
    if (unresolved.length > 0) {
      metaMap = await itemMetaRepository.getCostInfoIdsByItemMetaIds(
        unresolved.map((i) => i.id || i.Id),
        tenantId,
      );
    }

    const withCost = raw.map((line) => ({
      ...line,
      costInfoId: line.costInfoId || metaMap.get(line.id || line.Id) || null,
    }));

    const priceable = withCost.filter((l) => l.costInfoId);
    if (priceable.length === 0) return null;

    const { lines, totals } = await pricingService.priceLines(
      priceable.map((l, index) => ({
        costInfoId: l.costInfoId,
        quantity: Number(l.qty ?? l.quantity ?? 1) || 0,
        // Selected variants and add-ons are both a per-unit surcharge resolved
        // from their masters. Neither is trusted from the request.
        variantIds: normalizeVariantIds(l),
        addonIds: normalizeAddonIds(l),
        // The same menu item can appear twice with different variants, so the
        // menu id alone is not a unique key — index by position instead.
        ref: `L${index}`,
      })),
      tenantId,
    );

    const byRef = new Map(lines.map((l) => [l.ref, l]));
    const refByLine = new Map(priceable.map((l, index) => [l, `L${index}`]));

    return {
      items: withCost.map((line) => {
        const priced = byRef.get(refByLine.get(line));
        if (!priced) return line;
        return {
          ...line,
          costInfoId: line.costInfoId,
          // Effective unit price — base + variant + add-on surcharge, the
          // figure taxed.
          price: priced.unitAmount,
          basePrice: priced.baseAmount,
          variantAmount: priced.variantAmount,
          addonAmount: priced.addonAmount,
          // Names and prices as charged, so a reprint or a repeat order can show
          // the options chosen without re-reading the masters.
          variants: priced.variants,
          addons: priced.addons,
          taxCharged: priced.taxCharged,
          taxPct: priced.effectiveRate,
          isTaxIncluded: priced.isTaxIncluded,
          netAmount: priced.netAmount,
          taxAmount: priced.taxAmount,
          grossAmount: priced.grossAmount,
          taxComponents: priced.components,
        };
      }),
      totals,
    };
  }

  /**
   * List rounds, optionally narrowed to one table.
   *
   * Falls straight through to the base implementation when no filter is given,
   * so every existing caller behaves exactly as before. With `tableId` it runs a
   * filtered, still-paginated query rather than making the client pull the whole
   * list and filter locally — that approach silently lost rounds the moment an
   * outlet traded past one page.
   *
   * @param {string} tenantId
   * @param {number} [page]
   * @param {number} [limit]
   * @param {Object} [filters] - { tableId, openOnly }
   */
  async getAll(tenantId, page = 1, limit = 10, filters = {}) {
    const { tableId, openOnly } = filters || {};
    if (!tableId) return super.getAll(tenantId, page, limit);

    const { pageNum, limitNum, offset } = calculatePagination(page, limit);
    const openClause = openOnly
      ? ` AND LOWER(COALESCE(Status, '')) NOT IN (${[...CLOSED_STATUSES].map((s) => `'${s}'`).join(', ')})`
      : '';

    return withConnection(async (connection) => {
      const [countRows] = await connection.execute(
        `SELECT COUNT(*) as total FROM pos_order WHERE TenantId = ? AND TableId = ?${openClause}`,
        [tenantId, tableId],
      );
      const [rows] = await connection.execute(
        `SELECT * FROM pos_order WHERE TenantId = ? AND TableId = ?${openClause}`
        + ` ORDER BY CreatedOn ASC LIMIT ${limitNum} OFFSET ${offset}`,
        [tenantId, tableId],
      );

      return {
        data: rows,
        pagination: getPaginationMetadata(extractCount(countRows), pageNum, limitNum),
      };
    });
  }

  /**
   * Create a round: price it, number it, and stamp where it was served.
   *
   * Sending to the kitchen is a SEPARATE, deliberate act (`fireKot`). Placing a
   * round does not fire it: a counter-served drink never needs a ticket, and the
   * cashier decides when the order is complete enough to cook. The round is left
   * `open`; Billing surfaces rounds that have no ticket so one cannot be
   * forgotten silently.
   *
   * OrderNo is issued from the POS_ORDER series rather than minted in the
   * browser — the client used the last 6 digits of Date.now(), which wraps every
   * ~16m40s and then collides with UNIQUE (OrderNo, TenantId), failing the sale.
   * Any OrderNo sent by a client is ignored.
   *
   * The venue snapshot (table/floor name, capacity) is resolved and frozen here;
   * see resolveVenueTx for why it is copied rather than joined at read time.
   */
  /**
   * Refuses lines whose category is outside its trading hours.
   *
   * THIS is the enforcement; greying the card on the till is presentation. A
   * till left open since breakfast still holds a live token and can still POST
   * the line, so the rule is re-applied here from live data — the same
   * discipline settle uses for campaign offers, which are re-evaluated inside
   * the transaction and never trusted from the request.
   *
   * Reads take their own connections and run BEFORE the caller opens one, for
   * the same reason priceItems does: one connection per request.
   *
   * @param {Array<Object>} items raw Items[] from the request
   * @param {string} tenantId
   */
  async assertLinesAreOnMenu(items, tenantId) {
    const raw = asArray(items);
    if (raw.length === 0) return;

    const metaIds = raw.map((l) => l.id || l.Id).filter(Boolean);
    if (metaIds.length === 0) return;

    const [categoryByMeta, inactive, rules, timeZone] = await Promise.all([
      itemMetaRepository.getCategoryIdsByItemMetaIds(metaIds, tenantId),
      itemMetaRepository.getInactiveItemMetaIds(metaIds, tenantId),
      categorySchedule.getAllForTenant(tenantId),
      categorySchedule.getTimeZone(),
    ]);

    const byCategory = categorySchedule.indexByCategory(rules);
    // One instant for the whole cart, so a round straddling a boundary cannot
    // accept one line and refuse the next.
    const when = new Date();

    const refused = [];
    const offSale = [];
    raw.forEach((line) => {
      // Turned off in Menu Master. Checked FIRST and it wins: an open section
      // does not make an Off dish orderable, and saying "back at 18:00" about
      // one would be wrong — at 18:00 it is still off.
      if (inactive.has(line.id || line.Id)) {
        offSale.push(line.name || 'An item');
        return;
      }
      const categoryId = categoryByMeta.get(line.id || line.Id);
      if (!categoryId) return; // uncategorised is always sellable
      const { available, opensAt } = categorySchedule.availabilityOf(
        byCategory.get(categoryId), when, timeZone,
      );
      if (!available) {
        refused.push(`${line.name || 'An item'}${opensAt ? ` (back at ${opensAt.slice(0, 5)})` : ''}`);
      }
    });

    const problems = [];
    if (offSale.length > 0) problems.push(`Not on sale: ${offSale.join(', ')}.`);
    if (refused.length > 0) problems.push(`Not on the menu right now: ${refused.join(', ')}.`);
    if (problems.length > 0) {
      throw new HttpError(problems.join(' '), 400);
    }
  }

  /**
   * Refuses lines whose add-on selections break their groups' Min/Max rules.
   *
   * The rule a variant never had, and the reason add-ons could not simply reuse
   * the variant picker. Enforced here for the same reason trading hours are:
   * the till greying out a checkbox is presentation, and a stale tab can still
   * POST whatever it likes.
   *
   * Two failures, not one. An id the line DOES carry is checked against its own
   * group's Max; a group the dish offers but the line never answered is caught
   * by reading the dish's groups, because an unanswered group leaves no trace
   * on the line at all.
   *
   * Add-ons belonging to a group this dish does not offer are refused outright
   * rather than dropped — silently pricing a cart the client did not send is
   * how a guest gets charged for something nobody could see on screen.
   *
   * @param {Array<Object>} items raw Items[] from the request
   * @param {string} tenantId
   */
  async assertAddonSelectionsAreValid(items, tenantId) {
    const raw = asArray(items);
    if (raw.length === 0) return;

    const metaIds = raw.map((l) => l.id || l.Id).filter(Boolean);
    if (metaIds.length === 0) return;

    const [rulesByMeta, addons] = await Promise.all([
      itemMetaRepository.getAddonRulesByItemMetaIds(metaIds, tenantId),
      itemMetaRepository.getAddonPricesByIds(
        raw.flatMap((l) => normalizeAddonIds(l)),
        tenantId,
      ),
    ]);

    const refused = [];
    raw.forEach((line) => {
      const groups = rulesByMeta.get(line.id || line.Id) || [];
      const dishName = line.name || 'An item';
      const selected = normalizeAddonIds(line);

      // How many were chosen from each group the dish actually offers.
      const offered = new Set(groups.map((g) => g.groupId));
      const countByGroup = new Map();
      selected.forEach((id) => {
        const addon = addons.get(id);
        if (!addon) {
          // Unknown or retired — it contributes no price either (pricing drops
          // it the same way), so refusing keeps screen and bill in agreement.
          refused.push(`${dishName}: an option is no longer available`);
          return;
        }
        if (!offered.has(addon.groupId)) {
          refused.push(`${dishName}: "${addon.name}" is not offered with this item`);
          return;
        }
        countByGroup.set(addon.groupId, (countByGroup.get(addon.groupId) || 0) + 1);
      });

      groups.forEach((g) => {
        const picked = countByGroup.get(g.groupId) || 0;
        if (picked < g.minSelection) {
          refused.push(
            `${dishName}: choose at least ${g.minSelection} from "${g.groupName}"`,
          );
        } else if (g.maxSelection > 0 && picked > g.maxSelection) {
          refused.push(
            `${dishName}: choose at most ${g.maxSelection} from "${g.groupName}"`,
          );
        }
      });
    });

    if (refused.length > 0) {
      throw new HttpError(refused.join('; '), 400);
    }
  }

  async create(data, tenantId, userPhone) {
    // A dish note that will not fit on the ticket is refused before anything
    // else is checked or priced. Till only — the same reasoning as below.
    assertNotesFit(data.Items);
    const input = {
      ...data,
      Items: withCleanNotes(data.Items),
      CookingInstructions: cleanInstructions(data.CookingInstructions),
    };
    // Deliberately here and NOT in createRoundTx. That seam is shared with the
    // portal path, where an aggregator has already taken the customer's money —
    // refusing there would strand a paid order rather than prevent one. And
    // deliberately NOT on update: closing or paying for a round that was placed
    // while its section was open must keep working after it shuts.
    await this.assertLinesAreOnMenu(input.Items, tenantId);
    // Same seam, same reasoning: a portal order that already charged the guest
    // is reconciled by hand, not refused at the door.
    await this.assertAddonSelectionsAreValid(input.Items, tenantId);
    const priced = await this.priceItems(input.Items, tenantId);
    const order = priced
      ? {
        ...input,
        Items: priced.items,
        SubTotal: priced.totals.netAmount,
        TaxAmount: priced.totals.taxAmount,
        Total: priced.totals.grossAmount,
      }
      : { ...input };

    return withTransaction(async (connection) => this.createRoundTx(
      connection, order, tenantId, userPhone,
    ));
  }

  /**
   * Place a round on a CALLER-SUPPLIED transaction, already priced.
   *
   * The composition seam, mirroring createTx/updateTx on the base class and
   * existing for the same reason: a round is sometimes one step of a larger
   * atomic act. Accepting a portal order is exactly that — the order, the link
   * back to the portal order and the kitchen ticket are one decision, and half
   * of it committing would leave an aggregator order accepted with no food
   * being cooked, or food being cooked for an order nothing points at.
   *
   * `create` above is unchanged in behaviour and now delegates here, so the
   * till path and the portal path issue numbers, resolve the venue and insert
   * through exactly the same code rather than two that can drift.
   *
   * Expects `order.Items` to be ALREADY priced (see priceItems) — pricing takes
   * its own connection and must not be called with a transaction held open.
   *
   * @param {Object} connection - Open transaction connection.
   * @param {Object} order - Priced order data.
   * @param {string} tenantId
   * @param {string} userPhone
   * @returns {Promise<Object>} { id, ...order }
   */
  async createRoundTx(connection, order, tenantId, userPhone) {
    const row = { ...order };
    row.OrderNo = await issuePosNumber(connection, 'POS_ORDER', 'ORD', tenantId, userPhone);
    Object.assign(row, await resolveVenueTx(connection, row.TableId, tenantId));
    return this.createTx(connection, row, tenantId, userPhone);
  }

  async update(id, data, tenantId, userPhone) {
    // Notes are cleaned but NOT length-checked here: settling or closing a
    // portal round re-sends its Items, and a customer's long instruction must
    // not make that round unpayable.
    const input = { ...data };
    if (data.CookingInstructions !== undefined) {
      input.CookingInstructions = cleanInstructions(data.CookingInstructions);
    }
    if (data.Items !== undefined) input.Items = withCleanNotes(data.Items);
    // Only re-price when the caller actually changes the lines; a status-only
    // update must not disturb the totals already recorded.
    if (data.Items === undefined) return super.update(id, input, tenantId, userPhone);
    const priced = await this.priceItems(input.Items, tenantId);
    if (!priced) return super.update(id, input, tenantId, userPhone);
    return super.update(
      id,
      {
        ...input,
        Items: priced.items,
        SubTotal: priced.totals.netAmount,
        TaxAmount: priced.totals.taxAmount,
        Total: priced.totals.grossAmount,
      },
      tenantId,
      userPhone,
    );
  }

  /**
   * Domain action: send a round to the kitchen. Send-once.
   *
   * If this round already has a live ticket, the existing one is returned and
   * NOTHING is written. Pressing the button twice used to put a second copy of
   * the same food on the pass, and the kitchen cooked it twice. The guard lives
   * here rather than in the UI so a double-tap, a retried request or a second
   * device all converge on one ticket.
   *
   * A cancelled ticket does not count as live — that round was pulled, and
   * sending it again is a legitimate act.
   *
   * @param {string} id - Order ID
   * @param {Object} data - Optional { KotNo }
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - Acting user
   * @returns {Promise<Object>} The ticket, with AlreadySent telling the caller
   *                            whether this call is what put it there.
   */
  async fireKot(id, data, tenantId, userPhone) {
    return withTransaction(async (connection) => {
      const order = await this.getByIdTx(connection, id, tenantId); // 404 if missing
      if (CLOSED_STATUSES.has(String(order.Status || '').toLowerCase())) {
        throw new HttpError('Cannot send a closed round to the kitchen.', 409);
      }

      const existing = await findLiveKotTx(connection, id, tenantId);
      if (existing) {
        return {
          KotId: existing.Id,
          KotNo: existing.KotNo,
          OrderId: id,
          Status: existing.Status,
          AlreadySent: true,
        };
      }

      const kot = await writeKot(
        connection, order, tenantId, userPhone, data && data.KotNo,
      );
      await connection.execute(this.queries.SET_STATUS, [
        'fired',
        userPhone,
        id,
        tenantId,
      ]);
      return { ...kot, AlreadySent: false };
    });
  }

  /**
   * Domain action: move items or whole rounds between tables, keeping each
   * line's priced snapshot (no re-price). Atomic — source, destination and both
   * tables' occupancy update together. Returns a reversible `undo` payload.
   * @param {Object} payload - { scope, ... } see posorder.transfer.
   * @param {string} tenantId
   * @param {string} userPhone
   * @returns {Promise<Object>} transfer result incl. `undo`
   */
  async transfer(payload, tenantId, userPhone) {
    return withTransaction((connection) =>
      transferImpl(connection, payload, tenantId, userPhone),
    );
  }

  /**
   * Delete a whole round (order) even after its KOT has fired — the customer
   * changed the order. Removes any KOTs the round produced (so it leaves the
   * kitchen queue), deletes the order, and frees the table if it was the last
   * open round. Atomic.
   * @param {string} id - Order ID
   * @param {string} tenantId
   * @param {string} userPhone
   * @returns {Promise<Object>} { deletedOrderId }
   */
  async deleteRound(id, tenantId, userPhone) {
    return withTransaction(async (connection) => {
      const [rows] = await connection.execute(QUERIES.POS_ORDER.SELECT_BY_ID, [id, tenantId]);
      if (rows.length === 0) throw new HttpError('POS Order not found', 404);
      const order = rows[0];
      // Only removable while the kitchen hasn't started it: a round is deletable
      // when it never fired, or its KOT is still 'pending'. Once a KOT is
      // ready/served the food exists — deleting it silently would lose it.
      const [kots] = await connection.execute(
        'SELECT Status FROM pos_kot WHERE OrderId = ? AND TenantId = ?', [id, tenantId],
      );
      const started = kots.some((k) => {
        const s = String(k.Status || '').toLowerCase();
        return s && s !== 'pending' && s !== 'cancelled';
      });
      if (started) {
        throw new HttpError('Cannot delete this round — the kitchen has already started it.', 409);
      }
      // Pull the round's ticket(s) from the kitchen — a deleted round must not
      // keep cooking.
      await connection.execute(
        'DELETE FROM pos_kot WHERE OrderId = ? AND TenantId = ?', [id, tenantId],
      );
      // And its counter token: pos_token.OrderId is a foreign key, so leaving it
      // would reject the delete outright with a raw SQL error the cashier cannot
      // act on — and a token still calling for food that no longer exists is
      // worse than no token at all.
      await connection.execute(QUERIES.POS_TOKEN.DELETE_BY_ORDER, [id, tenantId]);
      await connection.execute(QUERIES.POS_ORDER.DELETE, [id, tenantId]);
      await refreshTable(connection, order.TableId, tenantId, userPhone);
      return { deletedOrderId: id };
    });
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.OrderNo ?? null,
      data.TableId ?? null,
      data.CustomerId ?? null,
      // OrderType and Status are NOT NULL in pos_order. Naming a column in the
      // INSERT suppresses its column DEFAULT, so an omitted value has to be
      // defaulted here — passing NULL is rejected outright. Same 'open' default
      // the transfer path already applies to a newly split round.
      data.OrderType ?? 'dinein',
      // HOW this was sold, as a reference rather than a string match. Null for
      // a till order placed by a tenant that has not created channels.
      data.ChannelId ?? null,
      data.Status ?? 'open',
      toJson(data.Items),
      data.SubTotal !== undefined ? data.SubTotal : 0,
      data.TaxAmount !== undefined ? data.TaxAmount : 0,
      data.Total !== undefined ? data.Total : 0,
      data.BranchDetailId ?? null,
      // Venue snapshot — see posVenue.js. Copied, never joined at read time.
      data.TableName ?? null,
      data.FloorId ?? null,
      data.FloorName ?? null,
      data.TableCapacity ?? null,
      // The whole-order note and flag — see kitchenNotes.js.
      data.CookingInstructions ?? null,
      data.NoCutlery ? 1 : 0,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.OrderNo !== undefined ? data.OrderNo : existing.OrderNo,
      data.TableId !== undefined ? data.TableId : existing.TableId,
      data.CustomerId !== undefined ? data.CustomerId : existing.CustomerId,
      data.OrderType !== undefined ? data.OrderType : existing.OrderType,
      data.ChannelId !== undefined ? data.ChannelId : existing.ChannelId,
      data.Status !== undefined ? data.Status : existing.Status,
      data.Items !== undefined ? toJson(data.Items) : toJson(existing.Items),
      data.SubTotal !== undefined ? data.SubTotal : existing.SubTotal,
      data.TaxAmount !== undefined ? data.TaxAmount : existing.TaxAmount,
      data.Total !== undefined ? data.Total : existing.Total,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      // Venue snapshot. Only a transfer supplies these (it re-resolves them for
      // the destination table); an ordinary update must leave the recorded
      // history exactly as it was.
      data.TableName !== undefined ? data.TableName : existing.TableName,
      data.FloorId !== undefined ? data.FloorId : existing.FloorId,
      data.FloorName !== undefined ? data.FloorName : existing.FloorName,
      data.TableCapacity !== undefined ? data.TableCapacity : existing.TableCapacity,
      data.CookingInstructions !== undefined
        ? data.CookingInstructions : (existing.CookingInstructions ?? null),
      data.NoCutlery !== undefined ? (data.NoCutlery ? 1 : 0) : (existing.NoCutlery ? 1 : 0),
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new PosOrderService();

module.exports = {
  getAll: (tenantId, page, limit, filters) => service.getAll(tenantId, page, limit, filters),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  // Delete now cascades KOTs + frees the table (see deleteRound), so a fired
  // round can be removed when the customer changes their order.
  remove: (id, tenantId, userPhone) => service.deleteRound(id, tenantId, userPhone),
  fireKot: (id, data, tenantId, userPhone) => service.fireKot(id, data, tenantId, userPhone),
  // Composition seam for callers that own the transaction — see createRoundTx.
  priceItems: (items, tenantId) => service.priceItems(items, tenantId),
  // Exported for its own test, and for any caller that composes a round.
  assertLinesAreOnMenu: (items, tenantId) => service.assertLinesAreOnMenu(items, tenantId),
  assertAddonSelectionsAreValid: (items, tenantId) =>
    service.assertAddonSelectionsAreValid(items, tenantId),
  createRoundTx: (conn, order, tenantId, userPhone) =>
    service.createRoundTx(conn, order, tenantId, userPhone),
  transfer: (payload, tenantId, userPhone) => service.transfer(payload, tenantId, userPhone),
};
