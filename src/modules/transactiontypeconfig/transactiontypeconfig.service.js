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
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
