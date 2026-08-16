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
const { HttpError } = require('../../middleware/errorHandler');

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
    const raw = asArray(items);
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
        // Selected variants are a per-unit surcharge resolved from the master.
        variantIds: normalizeVariantIds(l),
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
          // Effective unit price — base + variant surcharge, the figure taxed.
          price: priced.unitAmount,
          basePrice: priced.baseAmount,
          variantAmount: priced.addOnAmount,
          // Names and prices as charged, so a reprint or a repeat order can show
          // the options chosen without re-reading the variant master.
          variants: priced.variants,
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
  async create(data, tenantId, userEmail) {
    const priced = await this.priceItems(data.Items, tenantId);
    const order = priced
      ? {
        ...data,
        Items: priced.items,
        SubTotal: priced.totals.netAmount,
        TaxAmount: priced.totals.taxAmount,
        Total: priced.totals.grossAmount,
      }
      : { ...data };

    return withTransaction(async (connection) => {
      order.OrderNo = await issuePosNumber(connection, 'POS_ORDER', 'ORD', tenantId, userEmail);
      Object.assign(order, await resolveVenueTx(connection, order.TableId, tenantId));
      return this.createTx(connection, order, tenantId, userEmail);
    });
  }

  async update(id, data, tenantId, userEmail) {
    // Only re-price when the caller actually changes the lines; a status-only
    // update must not disturb the totals already recorded.
    if (data.Items === undefined) return super.update(id, data, tenantId, userEmail);
    const priced = await this.priceItems(data.Items, tenantId);
    if (!priced) return super.update(id, data, tenantId, userEmail);
    return super.update(
      id,
      {
        ...data,
        Items: priced.items,
        SubTotal: priced.totals.netAmount,
        TaxAmount: priced.totals.taxAmount,
        Total: priced.totals.grossAmount,
      },
      tenantId,
      userEmail,
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
   * @param {string} userEmail - Acting user
   * @returns {Promise<Object>} The ticket, with AlreadySent telling the caller
   *                            whether this call is what put it there.
   */
  async fireKot(id, data, tenantId, userEmail) {
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
        connection, order, tenantId, userEmail, data && data.KotNo,
      );
      await connection.execute(this.queries.SET_STATUS, [
        'fired',
        userEmail,
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
   * @param {string} userEmail
   * @returns {Promise<Object>} transfer result incl. `undo`
   */
  async transfer(payload, tenantId, userEmail) {
    return withTransaction((connection) =>
      transferImpl(connection, payload, tenantId, userEmail),
    );
  }

  /**
   * Delete a whole round (order) even after its KOT has fired — the customer
   * changed the order. Removes any KOTs the round produced (so it leaves the
   * kitchen queue), deletes the order, and frees the table if it was the last
   * open round. Atomic.
   * @param {string} id - Order ID
   * @param {string} tenantId
   * @param {string} userEmail
   * @returns {Promise<Object>} { deletedOrderId }
   */
  async deleteRound(id, tenantId, userEmail) {
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
      await connection.execute(QUERIES.POS_ORDER.DELETE, [id, tenantId]);
      await refreshTable(connection, order.TableId, tenantId, userEmail);
      return { deletedOrderId: id };
    });
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
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
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.OrderNo !== undefined ? data.OrderNo : existing.OrderNo,
      data.TableId !== undefined ? data.TableId : existing.TableId,
      data.CustomerId !== undefined ? data.CustomerId : existing.CustomerId,
      data.OrderType !== undefined ? data.OrderType : existing.OrderType,
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
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosOrderService();

module.exports = {
  getAll: (tenantId, page, limit, filters) => service.getAll(tenantId, page, limit, filters),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  // Delete now cascades KOTs + frees the table (see deleteRound), so a fired
  // round can be removed when the customer changes their order.
  remove: (id, tenantId, userEmail) => service.deleteRound(id, tenantId, userEmail),
  fireKot: (id, data, tenantId, userEmail) => service.fireKot(id, data, tenantId, userEmail),
  transfer: (payload, tenantId, userEmail) => service.transfer(payload, tenantId, userEmail),
};
