// src/modules/transactiondetaillog/transactiondetaillog.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { assertMutable } = require('../ledger/ledger.guard');

class TransactionDetailLogService extends BaseCRUDService {
  constructor() {
    super('Transaction Detail Log', QUERIES.TRANSACTION_DETAIL_LOG);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    const normalizeDate = (val) => {
      if (!val && val !== 0) return null
      if (val instanceof Date && !isNaN(val))
        return val.toISOString().split('T')[0]
      if (typeof val === 'string') {
        // DD-MM-YYYY must be checked FIRST — generic JS parse misreads it as MM-DD-YYYY
        const m = val.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
        if (m)
          return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
        // ISO or other standard formats — parse as UTC to avoid timezone shift
        const d = new Date(val.includes('T') ? val : val + 'T00:00:00Z')
        if (!isNaN(d)) return d.toISOString().split('T')[0]
        return null
      }
      return null
    }

    return [
      id,
      tenantId,
      data.TransactionNo,
      data.TransactionTypeConfigId,
      data.TransactionTypeStatusId || null,
      data.BranchId || null,
      normalizeDate(data.TransactionDate),
      data.Remarks || null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    const normalizeDate = (val) => {
      if (!val && val !== 0) return null
      if (val instanceof Date && !isNaN(val))
        return val.toISOString().split('T')[0]
      if (typeof val === 'string') {
        // DD-MM-YYYY must be checked FIRST — generic JS parse misreads it as MM-DD-YYYY
        const m = val.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
        if (m)
          return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
        // ISO or other standard formats — parse as UTC to avoid timezone shift
        const d = new Date(val.includes('T') ? val : val + 'T00:00:00Z')
        if (!isNaN(d)) return d.toISOString().split('T')[0]
        return null
      }
      return null
    }

    return [
      data.TransactionNo !== undefined ? data.TransactionNo : existing.TransactionNo,
      data.TransactionTypeConfigId !== undefined ? data.TransactionTypeConfigId : existing.TransactionTypeConfigId,
      data.TransactionTypeStatusId !== undefined ? data.TransactionTypeStatusId : existing.TransactionTypeStatusId,
      data.BranchId !== undefined ? data.BranchId : existing.BranchId,
      normalizeDate(data.TransactionDate !== undefined ? data.TransactionDate : existing.TransactionDate),
      data.Remarks !== undefined ? data.Remarks : existing.Remarks,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new TransactionDetailLogService();

// A settled document is immutable — corrections go through a refund, not an edit.
const guardedUpdate = async (id, data, tenantId, userPhone) => {
  await assertMutable(id, tenantId);
  return service.update(id, data, tenantId, userPhone);
};
const guardedDelete = async (id, tenantId) => {
  await assertMutable(id, tenantId);
  return service.delete(id, tenantId);
};
module.exports = {
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: guardedUpdate,
  delete: guardedDelete,
};
