// src/modules/paymentmode/paymentmode.service.js
//
// The tenant-wide CATALOGUE of tenders. Which outlet offers which is a separate
// concern with its own module (pospaymentmethod) — this one owns what a method
// IS, not where it is accepted.
//
// THE ACCOUNT IS THE POINT.
// A tender exists to say where money LANDS. DefaultAccountTypeBaseId has been a
// column since the ledger shipped and the list query has always joined its name,
// but no INSERT or UPDATE ever wrote it — so every method created through this
// API booked to nothing, while the UI displayed an account column that could only
// ever be blank for them. It is written here, and required on create, because a
// tender with no account is not a half-configured tender: it is one that silently
// loses money in every report that groups by account.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PaymentModeService extends BaseCRUDService {
  constructor() {
    super('Payment Mode', QUERIES.PAYMENT_MODE);
  }

  /**
   * Insert, with SortOrder assigned from the tenant's current maximum.
   *
   * Overridden rather than folded into prepareInsertParams because the next
   * value is a QUERY, and prepareInsertParams is synchronous and connectionless
   * by contract across every module that extends this base. Taking the number on
   * the connection the insert is about to use keeps the two inside one
   * transaction when the caller has opened one.
   *
   * SortOrder is not user input. It exists so the till's list — and therefore the
   * tender a sale defaults to — is deterministic; see the column comment in
   * 01-schema-definition.sql.
   *
   * @param {Object} connection - Active DB connection.
   * @param {Object} data
   * @param {string} tenantId
   * @param {string} userPhone
   * @returns {Promise<Object>}
   */
  async createTx(connection, data, tenantId, userPhone) {
    const [rows] = await connection.execute(
      QUERIES.PAYMENT_MODE.NEXT_SORT_ORDER, [tenantId],
    );
    const nextSortOrder = rows?.[0]?.nextSortOrder ?? 1;

    return super.createTx(
      connection, { ...data, SortOrder: nextSortOrder }, tenantId, userPhone,
    );
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Type,
      // Joi requires this on create, so a null here means a caller bypassed
      // validation rather than a user leaving a box empty.
      data.DefaultAccountTypeBaseId ?? null,
      data.RequiresReference !== undefined ? data.RequiresReference : false,
      data.EnabledByDefault !== undefined ? data.EnabledByDefault : true,
      data.SortOrder,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    // Every field falls back to what is stored, so a PATCH-shaped body that
    // names one field does not blank the rest.
    const keep = (key) => (data[key] !== undefined ? data[key] : existing[key]);

    return [
      keep('Type'),
      keep('DefaultAccountTypeBaseId'),
      keep('RequiresReference'),
      keep('EnabledByDefault'),
      keep('Active'),
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new PaymentModeService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
