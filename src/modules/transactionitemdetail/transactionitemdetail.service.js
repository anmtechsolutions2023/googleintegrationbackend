// src/modules/transactionitemdetail/transactionitemdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withConnection } = require('../../utils/dbHelper');
const pricingService = require('../pricing/pricing.service');
const { assertMutable } = require('../ledger/ledger.guard');

const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

class TransactionItemDetailService extends BaseCRUDService {
  constructor() {
    super('Transaction Item Detail', QUERIES.TRANSACTION_ITEM_DETAIL);
  }

  /**
   * Prices a ledger line from the item it points at.
   *
   * The line references an itemdetail, which owns its price via CostInfoId, so
   * the caller supplies a quantity and the server resolves the rest. The result
   * is a SNAPSHOT: UnitPrice and the amounts are frozen at write time, so an
   * invoice keeps the rate it was raised under whatever happens to the tax group
   * afterwards.
   *
   * An explicit CostInfoId overrides the item's own, which lets a correction pin
   * a line to a specific cost record.
   *
   * @param {Object} data - Incoming payload.
   * @param {Object|null} existing - Current row on update.
   * @param {string} tenantId
   * @returns {Promise<Object|null>} Snapshot fields, or null when nothing is priceable.
   */
  async priceLine(data, existing, tenantId) {
    const itemId = data.ItemId ?? existing?.ItemId ?? null;
    const quantity = Number(data.Quantity ?? existing?.Quantity ?? 1) || 0;

    let costInfoId = data.CostInfoId ?? null;
    if (!costInfoId && itemId) {
      costInfoId = await withConnection(async (conn) => {
        const [rows] = await conn.execute(QUERIES.ITEM_DETAIL.SELECT_BY_ID, [itemId, tenantId]);
        return rows && rows.length > 0 ? rows[0].CostInfoId ?? null : null;
      });
    }
    if (!costInfoId) return null;

    const { lines } = await pricingService.priceLines([{ costInfoId, quantity }], tenantId);
    const priced = lines[0];
    if (!priced || !priced.found) return null;

    return {
      Quantity: quantity,
      CostInfoId: costInfoId,
      UnitPrice: priced.unitAmount,
      NetAmount: priced.netAmount,
      TaxAmount: priced.taxAmount,
      GrossAmount: priced.grossAmount,
      TaxComponents: priced.components,
    };
  }

  /**
   * Next free line number for a document.
   *
   * Line numbers are unique per document (uk_tid_log_line), so a CRUD insert
   * cannot simply take the column default — the second line of a document would
   * collide with the first.
   * @param {string} logId
   * @param {string} tenantId
   * @returns {Promise<number>}
   */
  async nextLineNo(logId, tenantId) {
    if (!logId) return 1;
    return withConnection(async (conn) => {
      const [rows] = await conn.execute(QUERIES.LEDGER.SELECT_NEXT_LINE_NO, [logId, tenantId]);
      return rows && rows.length > 0 ? Number(rows[0].NextLineNo) || 1 : 1;
    });
  }

  async create(data, tenantId, userEmail) {
    // Lines cannot be added to a settled document.
    await assertMutable(data.TransactionDetailLogId, tenantId);
    const priced = await this.priceLine(data, null, tenantId);
    const lineNo = data.LineNo !== undefined
      ? data.LineNo
      : await this.nextLineNo(data.TransactionDetailLogId, tenantId);
    return super.create(
      { ...data, ...(priced || {}), LineNo: lineNo },
      tenantId,
      userEmail,
    );
  }

  async update(id, data, tenantId, userEmail) {
    // Lines of a settled document cannot be edited.
    const current = await this.getById(id, tenantId);
    await assertMutable(current.TransactionDetailLogId, tenantId);
    // Re-price only when something that affects the amount changed; a comment
    // edit must not silently restate a historical line at today's rates.
    const affectsPrice =
      data.ItemId !== undefined ||
      data.Quantity !== undefined ||
      data.CostInfoId !== undefined;
    if (!affectsPrice) return super.update(id, data, tenantId, userEmail);

    const existing = await this.getById(id, tenantId);
    const priced = await this.priceLine(data, existing, tenantId);
    return super.update(id, priced ? { ...data, ...priced } : data, tenantId, userEmail);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.TransactionDetailLogId,
      data.LineNo !== undefined ? data.LineNo : 1,
      data.ItemId,
      data.Quantity !== undefined ? data.Quantity : 1,
      data.CostInfoId ?? null,
      data.UnitPrice ?? null,
      data.BasePrice ?? null,
      data.VariantAmount !== undefined ? data.VariantAmount : 0,
      data.NetAmount ?? null,
      data.TaxAmount ?? null,
      data.GrossAmount ?? null,
      toJson(data.TaxComponents),
      toJson(data.Variants),
      data.Comment || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    const pick = (key) => (data[key] !== undefined ? data[key] : existing[key]);
    return [
      pick('TransactionDetailLogId'),
      pick('LineNo') ?? 1,
      pick('ItemId'),
      pick('Quantity') ?? 1,
      pick('CostInfoId') ?? null,
      pick('UnitPrice') ?? null,
      pick('BasePrice') ?? null,
      pick('VariantAmount') ?? 0,
      pick('NetAmount') ?? null,
      pick('TaxAmount') ?? null,
      pick('GrossAmount') ?? null,
      toJson(pick('TaxComponents')),
      toJson(pick('Variants')),
      pick('Comment') ?? null,
      pick('Active'),
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new TransactionItemDetailService();
module.exports = {
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
