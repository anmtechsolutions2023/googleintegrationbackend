// src/modules/posonlineorder/posonlineorder.service.js
// POS Online Order service — CRUD over one table.
//
// The LIFECYCLE (accept → kitchen → bill → ledger) deliberately lives next door
// in posonlineorder.lifecycle.js: this class has one reason to change, which is
// the shape of the row, and that one has another, which is the workflow.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

// A number column that must never receive undefined (mysql2 throws) and must
// never silently become NULL where the DDL says NOT NULL DEFAULT 0.
const money = (v, fallback = 0) => (v === undefined || v === null ? fallback : v);

class PosOnlineOrderService extends BaseCRUDService {
  constructor() {
    super('POS Online Order', QUERIES.POS_ONLINE_ORDER);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.PortalId ?? null,
      // Platform is the snapshot of the portal's name at the time. It stays
      // NOT NULL, so a caller who names only the portal still needs one — the
      // controller resolves it before we get here.
      data.Platform ?? null,
      data.OrderId ?? null,
      data.PortalBranchId ?? null,
      data.ExternalRef ?? null,
      data.Status ?? 'new',
      toJson(data.Payload),
      toJson(data.OrderLines),
      data.HasUnmappedLines !== undefined ? (data.HasUnmappedLines ? 1 : 0) : 0,
      data.CustomerName ?? null,
      data.CustomerPhone ?? null,
      data.ExternalCustomerRef ?? null,
      money(data.ItemsTotal),
      money(data.PortalDiscount),
      money(data.PackingCharge),
      money(data.DeliveryCharge),
      money(data.TaxAmount),
      money(data.GrossAmount),
      money(data.CommissionAmount),
      money(data.NetPayout),
      data.IsPrepaid !== undefined ? (data.IsPrepaid ? 1 : 0) : 1,
      data.PlacedOn ?? new Date(),
      data.PromisedOn ?? null,
      data.AcceptedOn ?? null,
      data.ReadyOn ?? null,
      data.PickedUpOn ?? null,
      data.DeliveredOn ?? null,
      data.RiderName ?? null,
      data.RiderPhone ?? null,
      data.CancelReason ?? null,
      data.CancelledBy ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    const keep = (key) => (data[key] !== undefined ? data[key] : existing[key]);
    return [
      keep('PortalId'),
      keep('Platform'),
      keep('OrderId'),
      keep('PortalBranchId'),
      keep('ExternalRef'),
      keep('Status'),
      data.Payload !== undefined ? toJson(data.Payload) : toJson(existing.Payload),
      data.OrderLines !== undefined ? toJson(data.OrderLines) : toJson(existing.OrderLines),
      keep('HasUnmappedLines'),
      keep('CustomerName'),
      keep('CustomerPhone'),
      keep('ExternalCustomerRef'),
      keep('ItemsTotal'),
      keep('PortalDiscount'),
      keep('PackingCharge'),
      keep('DeliveryCharge'),
      keep('TaxAmount'),
      keep('GrossAmount'),
      keep('CommissionAmount'),
      keep('NetPayout'),
      keep('IsPrepaid'),
      keep('PlacedOn'),
      keep('PromisedOn'),
      keep('AcceptedOn'),
      keep('ReadyOn'),
      keep('PickedUpOn'),
      keep('DeliveredOn'),
      keep('RiderName'),
      keep('RiderPhone'),
      keep('CancelReason'),
      keep('CancelledBy'),
      keep('BranchDetailId'),
      keep('Active'),
      userEmail,
      id,
      tenantId,
    ];
  }

  /**
   * The live queue for a branch.
   *
   * Its own read rather than a filter over getAll because the expo screen wants
   * OPEN work newest-first and nothing else: a Friday night's finished orders
   * would otherwise push the four that need accepting off the first page.
   *
   * @param {Object} filters - { branchId?, statuses? }
   */
  async getQueue(tenantId, filters = {}) {
    return withConnection(async (connection) => {
      const clauses = ['o.TenantId = ?', 'o.Active = 1'];
      const params = [tenantId];

      if (filters.branchId) {
        clauses.push('o.BranchDetailId = ?');
        params.push(filters.branchId);
      }

      const statuses = Array.isArray(filters.statuses) && filters.statuses.length
        ? filters.statuses
        : ['new', 'accepted', 'processing', 'out for delivery'];
      clauses.push(`o.Status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);

      const sql = QUERIES.POS_ONLINE_ORDER.SELECT_ALL
        .replace('WHERE o.TenantId = ?', `WHERE ${clauses.join(' AND ')}`)
        // The order that has been waiting longest for a decision is the one
        // about to breach its accept SLA, so it sorts to the top.
        .replace('ORDER BY o.CreatedOn DESC', 'ORDER BY o.PlacedOn ASC, o.CreatedOn ASC');

      const [rows] = await connection.execute(sql, params);
      return rows;
    });
  }
}

const service = new PosOnlineOrderService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
  getQueue: (tenantId, filters) => service.getQueue(tenantId, filters),
};
