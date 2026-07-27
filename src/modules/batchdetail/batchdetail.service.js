// src/modules/batchdetail/batchdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService')
const { QUERIES } = require('../../config/constants')
const { attachBreakdown, attachBreakdownToOne } = require('../pricing/pricing.enrich')

// batchdetail is the one non-POS table with BOTH a cost link and a quantity, so
// its breakdown is scaled to the whole batch rather than left at unit price.
const PRICING_OPTS = { idField: 'CostInfoId', quantityField: 'Quantity' }

class BatchDetailService extends BaseCRUDService {
  constructor() {
    super('Batch Detail', QUERIES.BATCH_DETAIL)
  }

  async getAll(tenantId, page, limit, expand) {
    const result = await super.getAll(tenantId, page, limit, expand)
    if (!expand) return result
    return { ...result, data: await attachBreakdown(result.data, tenantId, PRICING_OPTS) }
  }

  async getById(id, tenantId, expand) {
    const row = await super.getById(id, tenantId, expand)
    if (!expand) return row
    return attachBreakdownToOne(row, tenantId, PRICING_OPTS)
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    const normalizeDate = (val) => {
      if (!val && val !== 0) return null
      if (val instanceof Date && !isNaN(val))
        return val.toISOString().split('.')[0].replace('T', ' ')
      if (typeof val === 'string') {
        // DD-MM-YYYY must be checked FIRST — generic JS parse misreads it as MM-DD-YYYY
        const m = val.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
        if (m) {
          const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
          return iso + ' 00:00:00'
        }
        // ISO or other standard formats — parse as UTC to avoid timezone shift
        const d = new Date(val.includes('T') ? val : val + 'T00:00:00Z')
        if (!isNaN(d)) return d.toISOString().split('.')[0].replace('T', ' ')
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
        // DD-MM-YYYY must be checked FIRST — generic JS parse misreads it as MM-DD-YYYY
        const m = val.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
        if (m) {
          const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
          return iso + ' 00:00:00'
        }
        // ISO or other standard formats — parse as UTC to avoid timezone shift
        const d = new Date(val.includes('T') ? val : val + 'T00:00:00Z')
        if (!isNaN(d)) return d.toISOString().split('.')[0].replace('T', ' ')
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
