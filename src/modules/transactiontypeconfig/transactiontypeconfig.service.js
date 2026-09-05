// src/modules/transactiontypeconfig/transactiontypeconfig.service.js
// Transaction Type Config Service extending BaseCRUDService

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

class TransactionTypeConfigService extends BaseCRUDService {
  constructor() {
    super('Transaction Type Config', QUERIES.TRANSACTION_TYPE_CONFIG);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.StartCounterNo,
      data.Prefix || '',
      data.Format,
      data.TagName,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
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
   * @param {string} userPhone - Acting user's email
   * @returns {Promise<Object>} { id, ...row/data, reused } — reused=true when found
   */
  async getOrCreateByTagNameTx(connection, data, tenantId, userPhone) {
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
    const created = await this.createTx(connection, data, tenantId, userPhone);
    return { ...created, reused: false };
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.StartCounterNo !== undefined
        ? data.StartCounterNo
        : existing.StartCounterNo,
      data.Prefix !== undefined ? data.Prefix : existing.Prefix,
      data.Format !== undefined ? data.Format : existing.Format,
      data.TagName !== undefined ? data.TagName : existing.TagName,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
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

  async create(data, tenantId, userPhone) {
    logger.info('TransactionTypeConfigService.create called', {
      tenantId,
      userPhone,
    });
    return await super.create(data, tenantId, userPhone);
  }

  async update(id, data, tenantId, userPhone) {
    logger.info('TransactionTypeConfigService.update called', {
      id,
      tenantId,
      userPhone,
    });
    return await super.update(id, data, tenantId, userPhone);
  }

  async delete(id, tenantId) {
    logger.info('TransactionTypeConfigService.delete called', { id, tenantId });
    return await super.delete(id, tenantId);
  }
}

const service = new TransactionTypeConfigService();

module.exports = {
  createTx: (conn, data, tenantId, userPhone) => service.createTx(conn, data, tenantId, userPhone),
  getOrCreateByTagNameTx: (conn, data, tenantId, userPhone) =>
    service.getOrCreateByTagNameTx(conn, data, tenantId, userPhone),
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
