// src/modules/posbill/posbill.service.js
// POS Bill service — business logic extending BaseCRUDService (SRP + DIP).

const { v4: uuidv4 } = require('uuid');
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES, POS_BILL_STATUS } = require('../../config/constants');
const { withTransaction } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const pricingService = require('../pricing/pricing.service');
const ledgerService = require('../ledger/ledger.service');
const tokenService = require('../postoken/postoken.service');
const customerStats = require('../poscustomer/poscustomer.stats.service');
const loyalty = require('../loyalty/loyalty.service');
const { issuePosNumber } = require('../posorder/posNumbering');
const repository = require('./posbill.repository');
const { logger } = require('../../utils/logger');

// A sale with no table and this order type is a counter sale — the only kind
// that needs a queue number.
const POS_ORDER_TYPE_TAKEAWAY = 'takeaway';

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

// A JSON column arrives as an object or as a string depending on the driver
// config, so every read normalizes rather than assuming one shape.
const asObject = (v) => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : null; } catch { return null; }
};

/**
 * Issues a counter token when the bill is a counter sale, and only then.
 *
 * A counter sale is one where every round is takeaway and none sat at a table:
 * that is precisely the case where the customer has no other handle on their
 * order. Dine-in is identified by its table and delivery by its address, so
 * neither gets one.
 *
 * Runs INSIDE the settle transaction on purpose — payment and token are one
 * atomic act, so a dropped follow-up request cannot leave a paying customer
 * with no number.
 *
 * @returns {Promise<Object>} { TokenNumber, TokenLabel, TokenDate } or {}.
 */
const issueCounterTokenTx = async (conn, { billId, orderIds, bill }, tenantId, userEmail) => {
  const orders = await repository.getOrdersMetaTx(conn, orderIds, tenantId);
  if (orders.length === 0) return {};

  const isCounterSale = orders.every(
    (o) => !o.TableId && String(o.OrderType || '').toLowerCase() === POS_ORDER_TYPE_TAKEAWAY,
  );
  if (!isCounterSale) return {};

  // The bill's branch, falling back to the rounds' own. A token is unique
  // within a branch, so without one it cannot be numbered at all.
  const branchId = bill.BranchDetailId || orders.find((o) => o.BranchDetailId)?.BranchDetailId;
  if (!branchId) {
    // The sale is already paid and posted. Refusing it now over a missing
    // branch would undo a completed payment to fix a configuration gap, so the
    // gap is reported instead and the till carries on.
    logger.warn('Counter sale settled with no branch — no token issued', { billId, tenantId });
    return {};
  }

  const token = await tokenService.issueTokenTx(
    conn, { branchId, orderId: orders[0].Id }, tenantId, userEmail,
  );
  return {
    TokenNumber: token.TokenNumber,
    TokenLabel: token.TokenLabel,
    TokenDate: token.TokenDate,
  };
};

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
   * Two kinds of discount meet here and are deliberately kept apart: a per-item
   * discount attaches to its own line, while the whole-bill discount is spread
   * across every line by value. Both reduce the taxable base before tax; only
   * their attribution differs, and that attribution is what makes "which
   * products do we discount?" answerable later.
   *
   * @param {Object} conn - Open transaction connection.
   * @param {string[]} orderIds
   * @param {number} discount - Whole-bill discount.
   * @param {string} tenantId
   * @param {Object} [lineDiscounts] - Per-item, keyed "<orderId>#<lineIndex>".
   * @returns {Promise<Object|null>} { SubTotal, TaxAmount, Discount, Total, TaxByComponent } or null.
   */
  async recomputeTotals(conn, orderIds, discount, tenantId, lineDiscounts) {
    const lines = await repository.getOrderLinesTx(conn, orderIds, tenantId, lineDiscounts);
    if (lines.length === 0) return null;

    const priced = pricingService.priceSnapshotLines(lines, {
      discount: asDiscount(discount),
    });
    const { totals } = priced;

    return {
      SubTotal: totals.netAmount,
      TaxAmount: totals.taxAmount,
      Discount: totals.discountAmount,
      Total: totals.grossAmount,
      TaxByComponent: totals.taxByComponent,
      // The priced lines the totals were computed FROM. The ledger stores these
      // very lines, so a document can always be reconciled against its header.
      Lines: priced.lines,
    };
  }

  /**
   * Refuses to change a bill that has already been posted.
   *
   * A posted bill IS an invoice; editing its total or payments afterwards would
   * make the POS and the ledger disagree with no record of which is right.
   * Corrections go through a refund.
   * @param {string} id
   * @param {string} tenantId
   */
  async assertBillMutable(id, tenantId) {
    const bill = await this.getById(id, tenantId); // 404 if missing
    if (bill.TransactionDetailLogId) {
      throw new HttpError(
        MESSAGES.ERROR.LEDGER_IMMUTABLE,
        MESSAGES.HTTP_STATUS.CONFLICT,
      );
    }
    return bill;
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
      // Refuses a bill that is already posted, before any work is done — a
      // second settle must not be able to issue a second invoice.
      const existing = await this.assertBillMutable(id, tenantId);
      const discount = data.Discount !== undefined ? data.Discount : existing.Discount;
      const lineDiscounts = data.LineDiscounts !== undefined
        ? data.LineDiscounts
        : asObject(existing.LineDiscounts);

      // Re-price against the bill's rounds so a discount entered at settle time
      // reduces the taxable base.
      const orderIds = await repository.getBillOrderIdsTx(connection, id, tenantId);
      const recomputed = await this.recomputeTotals(
        connection, orderIds, discount, tenantId, lineDiscounts,
      );

      // Every settle posts a document. A bill with no priced lines cannot be
      // posted, and settling it anyway would put money in the POS that the
      // ledger has never heard of — so it is refused instead.
      if (!recomputed) {
        throw new HttpError(
          MESSAGES.ERROR.LEDGER_BILL_NOT_POSTABLE,
          MESSAGES.HTTP_STATUS.BAD_REQUEST,
        );
      }

      await connection.execute(this.queries.UPDATE_TOTALS, [
        recomputed.SubTotal, recomputed.TaxAmount, userEmail, id, tenantId,
      ]);

      // ── Post to the accounting ledger ──────────────────────────────────
      const lines = await repository.toLedgerLinesTx(connection, recomputed.Lines, tenantId);
      // Resolved once and used twice: the ledger records WHO bought (as a
      // contact), and the CRM records THAT they bought (as a visit). Querying
      // for the same customer twice would let the two disagree.
      const posCustomerId = await repository.getSessionCustomerIdTx(connection, orderIds, tenantId);

      const posted = await ledgerService.postSaleFromBill(
        connection,
        {
          billId: id,
          totals: recomputed,
          lines,
          tenders: normalizeTenders(data, recomputed.Total),
          posCustomerId,
          branchId: existing.BranchDetailId,
        },
        tenantId,
        userEmail,
      );

      // ── CRM ────────────────────────────────────────────────────────────
      // Visits, spend and loyalty. On this transaction on purpose: a sale that
      // rolls back must take its visit with it, or a customer is credited for
      // something that never happened. Walk-ins (no customer) record nothing.
      await customerStats.recordSaleTx(
        connection, posCustomerId, posted.payable, tenantId, userEmail,
      );

      // Points, through the loyalty ledger rather than a bare counter — so the
      // balance carries the reason it moved, and a refund has something to give
      // back. Same connection, same reasoning as the visit above.
      await loyalty.earnForSaleTx(connection, {
        customerId: posCustomerId,
        billId: id,
        amount: posted.payable,
        branchDetailId: existing.BranchDetailId,
      }, tenantId, userEmail);

      await connection.execute(this.queries.SETTLE, [
        toJson(data.Payments ?? data.Tenders),
        discount,
        toJson(lineDiscounts),
        posted.payable,
        // A part-tendered bill stays open — "paid" would be a lie.
        posted.balanceDue > 0 ? POS_BILL_STATUS.PARTIALLY_PAID : POS_BILL_STATUS.PAID,
        userEmail,
        id,
        tenantId,
      ]);

      // ── Counter token ──────────────────────────────────────────────────
      const token = await issueCounterTokenTx(
        connection, { billId: id, orderIds, bill: existing }, tenantId, userEmail,
      );

      // Read back on the transaction's own connection, or the caller gets the
      // bill as it looked BEFORE it was settled.
      const bill = await this.getByIdTx(connection, id, tenantId);
      return { ...bill, ...posted, ...token };
    });
  }

  /** A posted bill is corrected by refund, never by editing or deleting. */
  async update(id, data, tenantId, userEmail) {
    await this.assertBillMutable(id, tenantId);
    return super.update(id, data, tenantId, userEmail);
  }

  async delete(id, tenantId) {
    await this.assertBillMutable(id, tenantId);
    return super.delete(id, tenantId);
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

    // BillNo is NOT NULL and is now server-issued, so even a bill covering no
    // rounds has to go through the numbering transaction.
    if (orderIds.length === 0) {
      return withTransaction(async (connection) => {
        const BillNo = await issuePosNumber(connection, 'POS_BILL', 'BILL', tenantId, userEmail);
        return this.createTx(connection, { ...data, BillNo }, tenantId, userEmail);
      });
    }

    return withTransaction(async (connection) => {
      const id = uuidv4();
      const recomputed = await this.recomputeTotals(
        connection, orderIds, data.Discount, tenantId, data.LineDiscounts,
      );

      const row = recomputed
        ? { ...data, ...recomputed, OrderId: data.OrderId || orderIds[0] }
        : { ...data, OrderId: data.OrderId || orderIds[0] };
      // BillNo comes from the POS_BILL series, not from the client, which minted
      // it from the last 6 digits of Date.now() — a value that wraps every
      // ~16m40s and then collides with UNIQUE (BillNo, TenantId).
      row.BillNo = await issuePosNumber(connection, 'POS_BILL', 'BILL', tenantId, userEmail);
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
        connection, orderIds, bill.Discount, tenantId, asObject(bill.LineDiscounts),
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
      toJson(data.LineDiscounts),
      data.Total !== undefined ? data.Total : 0,
      toJson(data.Payments),
      // NOT NULL in pos_bill. Naming a column in the INSERT suppresses its
      // column DEFAULT, so an omitted value has to be defaulted here — passing
      // NULL is rejected outright. A bill is born unpaid; settling is what
      // changes that. (Same defect that was fixed on pos_order.Status.)
      data.Status ?? POS_BILL_STATUS.UNPAID,
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
      data.LineDiscounts !== undefined
        ? toJson(data.LineDiscounts) : toJson(existing.LineDiscounts),
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
