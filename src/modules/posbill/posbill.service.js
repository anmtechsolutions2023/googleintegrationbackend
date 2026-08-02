// src/modules/posbill/posbill.service.js
// POS Bill service — business logic extending BaseCRUDService (SRP + DIP).

const { v4: uuidv4 } = require('uuid');
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withTransaction } = require('../../utils/dbHelper');
const pricingService = require('../pricing/pricing.service');
const ledgerService = require('../ledger/ledger.service');
const repository = require('./posbill.repository');

/**
 * Normalizes tenders for the ledger.
 *
 * `Tenders[]` is the real input — one entry per way the customer paid. The older
 * `Payments` JSON blob is still accepted and mapped to a single tender so
 * existing callers keep settling, they just get one Cash line instead of a split.
 *
 * @param {Object} data - Settle payload.
 * @param {number} fallbackTotal - Used when a legacy payment carries no amount.
 * @returns {Array<{paymentModeId:string, amount:number, refNo?:string}>}
 */
const normalizeTenders = (data, fallbackTotal) => {
  if (Array.isArray(data.Tenders) && data.Tenders.length > 0) return data.Tenders;

  const legacy = Array.isArray(data.Payments) ? data.Payments : [];
  return legacy
    .filter((p) => p && p.paymentModeId)
    .map((p) => ({
      paymentModeId: p.paymentModeId,
      amount: p.amount ?? fallbackTotal,
      refNo: p.refNo ?? null,
    }));
};

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

/** Normalizes a discount amount into the shape the pricing engine expects. */
const asDiscount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? { type: 'amount', value: amount }
    : null;
};

class PosBillService extends BaseCRUDService {
  constructor() {
    super('POS Bill', QUERIES.POS_BILL);
  }

  /**
   * Recomputes a bill from every round it covers.
   *
   * Two rules meet here:
   *  - **Discount before tax.** The discount is spread across the lines and tax
   *    is charged on what remains, so it reduces the taxable base rather than
   *    being knocked off an already-taxed total.
   *  - **Snapshot rates.** Lines are priced from what each order stored, never
   *    from the live tax chain, so editing a tax group cannot retrospectively
   *    change a session that is being settled.
   *
   * @param {Object} conn - Open transaction connection.
   * @param {string[]} orderIds
   * @param {number} discount
   * @param {string} tenantId
   * @returns {Promise<Object|null>} { SubTotal, TaxAmount, Discount, Total, TaxByComponent } or null.
   */
  async recomputeTotals(conn, orderIds, discount, tenantId) {
    const lines = await repository.getOrderLinesTx(conn, orderIds, tenantId);
    if (lines.length === 0) return null;

    const { totals } = pricingService.priceSnapshotLines(lines, {
      discount: asDiscount(discount),
    });

    return {
      SubTotal: totals.netAmount,
      TaxAmount: totals.taxAmount,
      Discount: totals.discountAmount,
      Total: totals.grossAmount,
      TaxByComponent: totals.taxByComponent,
    };
  }

  /**
   * Domain action: settle a bill — record payments and mark it paid.
   * Runs in a transaction so the read + settle are atomic.
   * @param {string} id - Bill ID
   * @param {Object} data - { Payments, Discount?, Total? }
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - Acting user
   * @returns {Promise<Object>} Settled bill
   */
  async settle(id, data, tenantId, userEmail) {
    return withTransaction(async (connection) => {
      const existing = await this.getById(id, tenantId); // 404 if missing
      const discount = data.Discount !== undefined ? data.Discount : existing.Discount;

      // Re-price against the bill's rounds so a discount entered at settle time
      // reduces the taxable base. Falls back to the client's Total only when the
      // bill has no linked orders (e.g. raised before this shipped).
      const orderIds = await repository.getBillOrderIdsTx(connection, id, tenantId);
      const recomputed = await this.recomputeTotals(connection, orderIds, discount, tenantId);
      const total = recomputed
        ? recomputed.Total
        : (data.Total !== undefined ? data.Total : existing.Total);

      if (recomputed) {
        await connection.execute(this.queries.UPDATE_TOTALS, [
          recomputed.SubTotal, recomputed.TaxAmount, userEmail, id, tenantId,
        ]);
      }

      // ── Post to the accounting ledger ──────────────────────────────────
      // Only when the bill can be recomputed from its rounds: a bill with no
      // linked orders has no lines to post, and inventing them would be worse
      // than leaving it out of the ledger.
      let posted = null;
      if (recomputed) {
        const lines = await repository.getLedgerLinesTx(connection, orderIds, tenantId);
        posted = await ledgerService.postSaleFromBill(
          connection,
          {
            billId: id,
            totals: recomputed,
            lines,
            tenders: normalizeTenders(data, total),
            posCustomerId: await repository.getSessionCustomerIdTx(connection, orderIds, tenantId),
            branchId: existing.BranchDetailId,
          },
          tenantId,
          userEmail,
        );
      }

      await connection.execute(this.queries.SETTLE, [
        toJson(data.Payments ?? data.Tenders),
        discount,
        posted ? posted.payable : total,
        // A part-tendered bill stays open — "paid" would be a lie.
        posted && posted.balanceDue > 0 ? 'partially_paid' : 'paid',
        userEmail,
        id,
        tenantId,
      ]);

      const bill = await this.getById(id, tenantId);
      return posted ? { ...bill, ...posted } : bill;
    });
  }

  /**
   * Creates a bill covering one or more rounds.
   *
   * `OrderIds` is the new, correct input: a dine-in session is several rounds
   * billed together. `OrderId` is still accepted (and kept in the row) so single
   * -order callers are unaffected.
   */
  async create(data, tenantId, userEmail) {
    const orderIds = Array.isArray(data.OrderIds) && data.OrderIds.length > 0
      ? data.OrderIds
      : [data.OrderId].filter(Boolean);

    if (orderIds.length === 0) return super.create(data, tenantId, userEmail);

    return withTransaction(async (connection) => {
      const id = uuidv4();
      const recomputed = await this.recomputeTotals(
        connection, orderIds, data.Discount, tenantId,
      );

      const row = recomputed
        ? { ...data, ...recomputed, OrderId: data.OrderId || orderIds[0] }
        : { ...data, OrderId: data.OrderId || orderIds[0] };
      // TaxByComponent is a computed footer, not a column.
      delete row.TaxByComponent;
      delete row.OrderIds;

      await connection.execute(
        this.queries.INSERT,
        this.prepareInsertParams(id, row, tenantId, userEmail),
      );
      await repository.setBillOrdersTx(connection, id, orderIds, tenantId, userEmail);

      return { id, ...row, OrderIds: orderIds, TaxByComponent: recomputed?.TaxByComponent ?? [] };
    });
  }

  /**
   * Reads a bill with the rounds it covers and its per-component tax footer.
   *
   * The footer is derived from the orders' STORED snapshots, so a reprint years
   * later shows the CGST/SGST split that was actually charged. Stored totals are
   * returned as-is and never overwritten here — bills raised before this shipped
   * simply come back with an empty footer.
   */
  async getById(id, tenantId, expand) {
    const bill = await super.getById(id, tenantId, expand);
    if (!bill) return bill;

    return withTransaction(async (connection) => {
      const orderIds = await repository.getBillOrderIdsTx(connection, id, tenantId);
      if (orderIds.length === 0) {
        return { ...bill, OrderIds: bill.OrderId ? [bill.OrderId] : [], TaxByComponent: [] };
      }
      const recomputed = await this.recomputeTotals(
        connection, orderIds, bill.Discount, tenantId,
      );
      return {
        ...bill,
        OrderIds: orderIds,
        TaxByComponent: recomputed ? recomputed.TaxByComponent : [],
      };
    });
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.BillNo ?? null,
      data.OrderId ?? null,
      data.SubTotal !== undefined ? data.SubTotal : 0,
      data.TaxAmount !== undefined ? data.TaxAmount : 0,
      data.Discount !== undefined ? data.Discount : 0,
      data.Total !== undefined ? data.Total : 0,
      toJson(data.Payments),
      data.Status ?? null,
      data.SettledAt ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.BillNo !== undefined ? data.BillNo : existing.BillNo,
      data.OrderId !== undefined ? data.OrderId : existing.OrderId,
      data.SubTotal !== undefined ? data.SubTotal : existing.SubTotal,
      data.TaxAmount !== undefined ? data.TaxAmount : existing.TaxAmount,
      data.Discount !== undefined ? data.Discount : existing.Discount,
      data.Total !== undefined ? data.Total : existing.Total,
      data.Payments !== undefined ? toJson(data.Payments) : toJson(existing.Payments),
      data.Status !== undefined ? data.Status : existing.Status,
      data.SettledAt !== undefined ? data.SettledAt : existing.SettledAt,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosBillService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
  settle: (id, data, tenantId, userEmail) => service.settle(id, data, tenantId, userEmail),
};
