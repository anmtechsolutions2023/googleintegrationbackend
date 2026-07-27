// src/modules/paymentbreakup/paymentbreakup.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PaymentBreakupService extends BaseCRUDService {
  constructor() {
    super('Payment Breakup', QUERIES.PAYMENT_BREAKUP);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    const normalizeDate = (val) => {
      if (!val && val !== 0) return null
      if (val instanceof Date && !isNaN(val))
        return val.toISOString().split('.')[0].replace('T', ' ')
      if (typeof val === 'string') {
        const m = val.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
        if (m) {
          const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
          return iso + ' 00:00:00'
        }
        const d = new Date(val.includes('T') ? val : val + 'T00:00:00Z')
        if (!isNaN(d)) return d.toISOString().split('.')[0].replace('T', ' ')
        return null
      }
      return null
    }

    return [
      id,
      tenantId,
      data.AccountTypeBaseId,
      data.PaymentDetailId,
      data.PaymentModeTransactionDetailId,
      data.PaymentReceivedTypeId,
      // How much of the bill this payment mode covered. Without it a split
      // settlement (part cash, part card) could not be recorded at all.
      data.Amount !== undefined ? data.Amount : 0,
      data.UserId || null,
      normalizeDate(data.Timestamp),
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    const normalizeDate = (val) => {
      if (!val && val !== 0) return null
      if (val instanceof Date && !isNaN(val))
        return val.toISOString().split('.')[0].replace('T', ' ')
      if (typeof val === 'string') {
        const m = val.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
        if (m) {
          const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
          return iso + ' 00:00:00'
        }
        const d = new Date(val.includes('T') ? val : val + 'T00:00:00Z')
        if (!isNaN(d)) return d.toISOString().split('.')[0].replace('T', ' ')
        return null
      }
      return null
    }

    return [
      data.AccountTypeBaseId !== undefined ? data.AccountTypeBaseId : existing.AccountTypeBaseId,
      data.PaymentDetailId !== undefined ? data.PaymentDetailId : existing.PaymentDetailId,
      data.PaymentModeTransactionDetailId !== undefined ? data.PaymentModeTransactionDetailId : existing.PaymentModeTransactionDetailId,
      data.PaymentReceivedTypeId !== undefined ? data.PaymentReceivedTypeId : existing.PaymentReceivedTypeId,
      data.Amount !== undefined ? data.Amount : existing.Amount,
      data.UserId !== undefined ? (data.UserId || null) : existing.UserId,
      normalizeDate(data.Timestamp !== undefined ? data.Timestamp : existing.Timestamp),
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PaymentBreakupService();
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
