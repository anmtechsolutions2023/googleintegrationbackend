// src/modules/paymentdetail/paymentdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withConnection } = require('../../utils/dbHelper');
const pricingService = require('../pricing/pricing.service');

/** TaxComponents is a JSON column — mysql2 may hand back a string or an array. */
const parseComponents = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

class PaymentDetailService extends BaseCRUDService {
  constructor() {
    super('Payment Detail', QUERIES.PAYMENT_DETAIL);
  }

  /**
   * Totals a payment from the priced lines of the transaction log it settles.
   *
   * Reads the lines' STORED snapshots rather than re-pricing them, so a payment
   * always reflects what the invoice actually charged. A discount on the payment
   * is applied before tax, matching the rest of the project.
   *
   * Returns null when the log has no priced lines — payments against logs
   * created before pricing shipped keep whatever the caller supplied.
   *
   * @param {string} logId
   * @param {number|string} discount
   * @param {string} tenantId
   * @returns {Promise<Object|null>} { TotalAmount, TaxesAmount, GrossAmount }
   */
  async totalsFromLog(logId, discount, tenantId) {
    if (!logId) return null;

    const rows = await withConnection(async (conn) => {
      const [result] = await conn.execute(
        QUERIES.TRANSACTION_ITEM_DETAIL.SELECT_PRICED_BY_LOG,
        [logId, tenantId],
      );
      return result;
    });

    // Only lines that actually carry a snapshot count. Lines written before
    // pricing shipped have a NULL UnitPrice and must not drag the total to zero.
    const priceable = (rows || []).filter(
      (r) => r.UnitPrice !== null && r.UnitPrice !== undefined && Number.isFinite(Number(r.UnitPrice)),
    );
    if (priceable.length === 0) return null;

    const amount = Number(discount);
    const { totals } = pricingService.priceSnapshotLines(
      priceable.map((r) => ({
        unitAmount: r.UnitPrice,
        quantity: Number(r.Quantity) || 0,
        // Snapshot amounts are already tax-exclusive net values.
        isTaxIncluded: false,
        components: parseComponents(r.TaxComponents),
      })),
      {
        discount:
          Number.isFinite(amount) && amount > 0 ? { type: 'amount', value: amount } : null,
      },
    );

    return {
      TotalAmount: String(totals.grossAmount),
      TaxesAmount: String(totals.taxAmount),
      GrossAmount: String(totals.netAmount),
    };
  }

  async create(data, tenantId, userEmail) {
    const totals = await this.totalsFromLog(
      data.TransactionDetailLogId, data.DiscountAmount, tenantId,
    );
    return super.create(totals ? { ...data, ...totals } : data, tenantId, userEmail);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.AccountTypeBaseId,
      data.TransactionDetailLogId,
      data.DiscountAmount || null,
      data.RoundOff || null,
      data.TotalAmount,
      data.TaxesAmount || null,
      data.GrossAmount,
      data.UserId || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.AccountTypeBaseId !== undefined ? data.AccountTypeBaseId : existing.AccountTypeBaseId,
      data.TransactionDetailLogId !== undefined ? data.TransactionDetailLogId : existing.TransactionDetailLogId,
      data.DiscountAmount !== undefined ? data.DiscountAmount : existing.DiscountAmount,
      data.RoundOff !== undefined ? data.RoundOff : existing.RoundOff,
      data.TotalAmount !== undefined ? data.TotalAmount : existing.TotalAmount,
      data.TaxesAmount !== undefined ? data.TaxesAmount : existing.TaxesAmount,
      data.GrossAmount !== undefined ? data.GrossAmount : existing.GrossAmount,
      data.UserId !== undefined ? data.UserId : existing.UserId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PaymentDetailService();
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
