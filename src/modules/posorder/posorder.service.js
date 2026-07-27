// src/modules/posorder/posorder.service.js
// POS Order service — business logic extending BaseCRUDService (SRP + DIP).

const { v4: uuidv4 } = require('uuid');
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withTransaction } = require('../../utils/dbHelper');

const pricingService = require('../pricing/pricing.service');
const itemMetaRepository = require('../positemmeta/positemmeta.repository');
const { transfer: transferImpl, refreshTable } = require('./posorder.transfer');
const { HttpError } = require('../../middleware/errorHandler');

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

  // Server-authoritative on write. Read paths are untouched, so orders placed
  // before this shipped keep whatever they stored.
  async create(data, tenantId, userEmail) {
    const priced = await this.priceItems(data.Items, tenantId);
    if (!priced) return super.create(data, tenantId, userEmail);
    return super.create(
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
   * Domain action: fire a KOT from an order — snapshots the order's items into a
   * new pos_kot row and marks the order 'fired'. Atomic (single transaction).
   * @param {string} id - Order ID
   * @param {Object} data - Optional { KotNo }
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - Acting user
   * @returns {Promise<Object>} The created KOT summary
   */
  async fireKot(id, data, tenantId, userEmail) {
    return withTransaction(async (connection) => {
      const order = await this.getById(id, tenantId); // 404 if missing
      // Fire once per round: a second tap must not duplicate the ticket in the
      // kitchen. Add items as a new round to send more to the pass.
      if (String(order.Status || '').toLowerCase() === 'fired') {
        throw new HttpError('KOT already fired for this round.', 409);
      }
      const kotId = uuidv4();
      const kotNo = (data && data.KotNo) || `KOT-${Date.now()}`;
      await connection.execute(QUERIES.POS_KOT.INSERT, [
        kotId,
        tenantId,
        kotNo,
        order.Id,
        order.TableId,
        toJson(order.Items),
        'pending',
        new Date(),
        order.BranchDetailId,
        1,
        userEmail,
        userEmail,
      ]);
      await connection.execute(this.queries.SET_STATUS, [
        'fired',
        userEmail,
        id,
        tenantId,
      ]);
      return { KotId: kotId, KotNo: kotNo, OrderId: order.Id, Status: 'pending' };
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
      data.OrderType ?? null,
      data.Status ?? null,
      toJson(data.Items),
      data.SubTotal !== undefined ? data.SubTotal : 0,
      data.TaxAmount !== undefined ? data.TaxAmount : 0,
      data.Total !== undefined ? data.Total : 0,
      data.BranchDetailId ?? null,
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
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosOrderService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  // Delete now cascades KOTs + frees the table (see deleteRound), so a fired
  // round can be removed when the customer changes their order.
  remove: (id, tenantId, userEmail) => service.deleteRound(id, tenantId, userEmail),
  fireKot: (id, data, tenantId, userEmail) => service.fireKot(id, data, tenantId, userEmail),
  transfer: (payload, tenantId, userEmail) => service.transfer(payload, tenantId, userEmail),
};
