// src/modules/contactaddresstype/contactaddresstype.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

class ContactAddressTypeService extends BaseCRUDService {
  constructor() {
    super('Contact Address Type', QUERIES.CONTACT_ADDRESS_TYPE);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  /**
   * Find an address type by Name (unique per tenant) or create it if absent,
   * reusing a caller-supplied transaction connection. Used by the master-data
   * bootstrap so a repeated onboarding reuses the existing type instead of
   * violating the UNIQUE(Name, TenantId) constraint.
   * @param {Object} connection - Active DB connection (inside withTransaction)
   * @param {string} name - Address type name to look up / create
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - Acting user's email
   * @returns {Promise<Object>} { id, Name, reused } — reused=true when found
   */
  async getOrCreateByNameTx(connection, name, tenantId, userPhone) {
    const [rows] = await connection.execute(
      this.queries.SELECT_BY_NAME,
      [name, tenantId],
    );
    if (rows.length > 0) {
      logger.info('Reusing existing Contact Address Type', { name, tenantId });
      return { id: rows[0].Id, Name: rows[0].Name, reused: true };
    }
    const created = await this.createTx(connection, { Name: name }, tenantId, userPhone);
    return { ...created, reused: false };
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new ContactAddressTypeService();
module.exports = {
  createTx: (conn, data, tenantId, userPhone) => service.createTx(conn, data, tenantId, userPhone),
  getOrCreateByNameTx: (conn, name, tenantId, userPhone) =>
    service.getOrCreateByNameTx(conn, name, tenantId, userPhone),
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
