// src/modules/posexpense/posexpense.service.js
// POS Expense service — money OUT, with an approval gate before it becomes a cost.
//
// Lifecycle:  draft --approve--> approved --settle--> settled
//                 \--reject---> cancelled
//
// Only settling posts to the ledger. A draft is a claim and an approved expense
// is a commitment; neither is money that has left, so neither may appear in cash
// flow. That separation is the reason the approval step exists at all.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES, EXPENSE_STATUS } = require('../../config/constants');
const { withTransaction } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const ledgerService = require('../ledger/ledger.service');

class PosExpenseService extends BaseCRUDService {
  constructor() {
    super('POS Expense', QUERIES.POS_EXPENSE);
  }

  /**
   * Approves a draft expense.
   * @param {string} id
   * @param {string} tenantId
   * @param {string} userEmail - Recorded as the approver.
   */
  async approve(id, tenantId, userEmail) {
    const existing = await this.getById(id, tenantId);
    if (existing.Status !== EXPENSE_STATUS.DRAFT) {
      throw new HttpError(MESSAGES.ERROR.EXPENSE_NOT_DRAFT, MESSAGES.HTTP_STATUS.CONFLICT);
    }
    return withTransaction(async (conn) => {
      await conn.execute(this.queries.APPROVE, [userEmail, userEmail, id, tenantId]);
      // Same connection: a pooled read sits outside this transaction and would
      // return the row as it was before the approval.
      return this.getByIdTx(conn, id, tenantId);
    });
  }

  /** Rejects a draft expense. Nothing was posted, so nothing is reversed. */
  async reject(id, tenantId, userEmail) {
    const existing = await this.getById(id, tenantId);
    if (existing.Status !== EXPENSE_STATUS.DRAFT) {
      throw new HttpError(MESSAGES.ERROR.EXPENSE_NOT_DRAFT, MESSAGES.HTTP_STATUS.CONFLICT);
    }
    return withTransaction(async (conn) => {
      await conn.execute(this.queries.REJECT, [userEmail, id, tenantId]);
      return this.getByIdTx(conn, id, tenantId);
    });
  }

  /**
   * Settles an approved expense: the money leaves, and a document records it.
   *
   * @param {string} id
   * @param {Object} data - { PaymentModeId? } — overrides the mode captured at entry.
   * @param {string} tenantId
   * @param {string} userEmail
   */
  async settle(id, data, tenantId, userEmail) {
    return withTransaction(async (conn) => {
      const existing = await this.getByIdTx(conn, id, tenantId);

      if (existing.Status !== EXPENSE_STATUS.APPROVED) {
        throw new HttpError(MESSAGES.ERROR.EXPENSE_NOT_APPROVED, MESSAGES.HTTP_STATUS.CONFLICT);
      }
      // The mode decides which account the money left, so an expense cannot be
      // settled without one — "paid, somehow" is not recordable.
      const paymentModeId = data?.PaymentModeId || existing.PaymentModeId;
      if (!paymentModeId) {
        throw new HttpError(MESSAGES.ERROR.EXPENSE_MODE_REQUIRED, MESSAGES.HTTP_STATUS.BAD_REQUEST);
      }

      const posted = await ledgerService.postExpense(
        conn,
        {
          expenseId: id,
          amount: existing.Amount,
          categoryId: existing.ExpenseCategoryId,
          paymentModeId,
          description: existing.Description,
          branchId: existing.BranchDetailId,
          expenseDate: existing.ExpenseDate,
        },
        tenantId,
        userEmail,
      );

      const expense = await this.getByIdTx(conn, id, tenantId);
      return { ...expense, ...posted };
    });
  }

  /** A settled expense is corrected by reversing its document, never by editing. */
  async update(id, data, tenantId, userEmail) {
    const existing = await this.getById(id, tenantId);
    if (existing.TransactionDetailLogId) {
      throw new HttpError(MESSAGES.ERROR.LEDGER_IMMUTABLE, MESSAGES.HTTP_STATUS.CONFLICT);
    }
    return super.update(id, data, tenantId, userEmail);
  }

  async delete(id, tenantId) {
    const existing = await this.getById(id, tenantId);
    if (existing.TransactionDetailLogId) {
      throw new HttpError(MESSAGES.ERROR.LEDGER_IMMUTABLE, MESSAGES.HTTP_STATUS.CONFLICT);
    }
    return super.delete(id, tenantId);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.ExpenseCategoryId ?? null,
      data.Description ?? null,
      data.Amount ?? 0,
      data.ExpenseDate ?? null,
      data.PaymentModeId ?? null,
      // Always born a draft: an expense cannot be created already approved, or
      // the approval gate would be bypassable from the client.
      EXPENSE_STATUS.DRAFT,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.ExpenseCategoryId !== undefined ? data.ExpenseCategoryId : existing.ExpenseCategoryId,
      data.Description !== undefined ? data.Description : existing.Description,
      data.Amount !== undefined ? data.Amount : existing.Amount,
      data.ExpenseDate !== undefined ? data.ExpenseDate : existing.ExpenseDate,
      data.PaymentModeId !== undefined ? data.PaymentModeId : existing.PaymentModeId,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosExpenseService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
  approve: (id, tenantId, userEmail) => service.approve(id, tenantId, userEmail),
  reject: (id, tenantId, userEmail) => service.reject(id, tenantId, userEmail),
  settle: (id, data, tenantId, userEmail) => service.settle(id, data, tenantId, userEmail),
};
