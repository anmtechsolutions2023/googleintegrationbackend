// src/modules/transactiontypeconfig/transactiontypeconfig.service.js
// Transaction Type Config Service extending BaseCRUDService

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

class TransactionTypeConfigService extends BaseCRUDService {
  constructor() {
    super('Transaction Type Config', QUERIES.TRANSACTION_TYPE_CONFIG);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.StartCounterNo,
      data.Prefix || '',
      data.Format,
      data.TagName,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  /**
   * Find a transaction type config by TagName (unique) or create it if absent,
   * reusing a caller-supplied transaction connection. Used by the master-data
   * bootstrap so a repeated onboarding reuses the existing config instead of
   * violating the UNIQUE TagName constraint.
   * @param {Object} connection - Active DB connection (inside withTransaction)
   * @param {Object} data - Config data (must include TagName)
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - Acting user's email
   * @returns {Promise<Object>} { id, ...row/data, reused } — reused=true when found
   */
  async getOrCreateByTagNameTx(connection, data, tenantId, userEmail) {
    const [rows] = await connection.execute(
      this.queries.SELECT_BY_TAGNAME,
      [data.TagName, tenantId],
    );
    if (rows.length > 0) {
      logger.info('Reusing existing Transaction Type Config', {
        tagName: data.TagName,
        tenantId,
      });
      return { id: rows[0].Id, ...rows[0], reused: true };
    }
    const created = await this.createTx(connection, data, tenantId, userEmail);
    return { ...created, reused: false };
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.StartCounterNo !== undefined
        ? data.StartCounterNo
        : existing.StartCounterNo,
      data.Prefix !== undefined ? data.Prefix : existing.Prefix,
      data.Format !== undefined ? data.Format : existing.Format,
      data.TagName !== undefined ? data.TagName : existing.TagName,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }

  async getAll(tenantId, page, limit) {
    logger.info('TransactionTypeConfigService.getAll called', {
      tenantId,
      page,
      limit,
    });
    return await super.getAll(tenantId, page, limit);
  }

  async getById(id, tenantId) {
    logger.info('TransactionTypeConfigService.getById called', {
      id,
      tenantId,
    });
    return await super.getById(id, tenantId);
  }

  async create(data, tenantId, userEmail) {
    logger.info('TransactionTypeConfigService.create called', {
      tenantId,
      userEmail,
    });
    return await super.create(data, tenantId, userEmail);
  }

  async update(id, data, tenantId, userEmail) {
    logger.info('TransactionTypeConfigService.update called', {
      id,
      tenantId,
      userEmail,
    });
    return await super.update(id, data, tenantId, userEmail);
  }

  async delete(id, tenantId) {
    logger.info('TransactionTypeConfigService.delete called', { id, tenantId });
    return await super.delete(id, tenantId);
  }
}

const service = new TransactionTypeConfigService();

module.exports = {
  createTx: (conn, data, tenantId, userEmail) => service.createTx(conn, data, tenantId, userEmail),
  getOrCreateByTagNameTx: (conn, data, tenantId, userEmail) =>
    service.getOrCreateByTagNameTx(conn, data, tenantId, userEmail),
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
