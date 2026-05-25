// src/modules/batchdetail/batchdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService')
const { QUERIES } = require('../../config/constants')

class BatchDetailService extends BaseCRUDService {
  constructor() {
    super('Batch Detail', QUERIES.BATCH_DETAIL)
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    const normalizeDate = (val) => {
      if (!val && val !== 0) return null
      if (val instanceof Date && !isNaN(val))
        return val.toISOString().split('.')[0].replace('T', ' ')
      if (typeof val === 'string') {
        // Try JS parse
        const d = new Date(val)
        if (!isNaN(d)) return d.toISOString().split('.')[0].replace('T', ' ')
        // Try DD-MM-YYYY or D-M-YYYY
        const m = val.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
        if (m) {
          const dd = m[1].padStart(2, '0')
          const mm = m[2].padStart(2, '0')
          const yyyy = m[3]
          const iso = `${yyyy}-${mm}-${dd}`
          const d2 = new Date(iso)
          if (!isNaN(d2))
            return d2.toISOString().split('.')[0].replace('T', ' ')
        }
        return null
      }
      return null
    }

    return [
      id,
      tenantId,
      data.BatchNo || data.BatchNumber || null,
      data.Barcode || null,
      normalizeDate(data.MfgDate || data.ManufacturedDate || null),
      normalizeDate(data.Expdate || data.ExpiryDate || null),
      normalizeDate(data.PurchaseDate || null),
      data.IsNonReturnable !== undefined ? data.IsNonReturnable : false,
      data.CostInfoId || null,
      data.UOMId || null,
      data.Quantity !== undefined ? data.Quantity : null,
      data.MapProviderLocationMapperId || null,
      data.BranchDetailId || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ]
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    const normalizeDate = (val) => {
      if (!val && val !== 0) return null
      if (val instanceof Date && !isNaN(val))
        return val.toISOString().split('.')[0].replace('T', ' ')
      if (typeof val === 'string') {
        const d = new Date(val)
        if (!isNaN(d)) return d.toISOString().split('.')[0].replace('T', ' ')
        const m = val.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
        if (m) {
          const dd = m[1].padStart(2, '0')
          const mm = m[2].padStart(2, '0')
          const yyyy = m[3]
          const iso = `${yyyy}-${mm}-${dd}`
          const d2 = new Date(iso)
          if (!isNaN(d2))
            return d2.toISOString().split('.')[0].replace('T', ' ')
        }
        return null
      }
      return null
    }

    return [
      data.BatchNo !== undefined ? data.BatchNo : existing.BatchNo,
      data.Barcode !== undefined ? data.Barcode : existing.Barcode,
      data.MfgDate !== undefined
        ? normalizeDate(data.MfgDate)
        : normalizeDate(existing.MfgDate),
      data.Expdate !== undefined
        ? normalizeDate(data.Expdate)
        : normalizeDate(existing.Expdate),
      data.PurchaseDate !== undefined
        ? normalizeDate(data.PurchaseDate)
        : normalizeDate(existing.PurchaseDate),
      data.IsNonReturnable !== undefined
        ? data.IsNonReturnable
        : existing.IsNonReturnable,
      data.CostInfoId !== undefined ? data.CostInfoId : existing.CostInfoId,
      data.UOMId !== undefined ? data.UOMId : existing.UOMId,
      data.Quantity !== undefined ? data.Quantity : existing.Quantity,
      data.MapProviderLocationMapperId !== undefined
        ? data.MapProviderLocationMapperId
        : existing.MapProviderLocationMapperId,
      data.BranchDetailId !== undefined
        ? data.BranchDetailId
        : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ]
  }
}

const service = new BatchDetailService()
module.exports = {
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
}
