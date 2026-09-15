// src/modules/positemmeta/positemmeta.controller.js
// Controller layer for POS Item Meta — HTTP request/response handling.

const service = require('./positemmeta.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const {
  successResponse,
  paginatedResponse,
  createdResponse,
  noContentResponse,
} = require('../../utils/responseHelper');
const {
  validateBody,
  validateQuery,
  validateParams,
} = require('../../middleware/validation');
const {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  bulkUpdateSchema,
} = require('./positemmeta.schemas');
const { writeAuditLog, getIp } = require('../../middleware/auditLogger');
const { STATUSES, AUDIT_CATEGORIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosItemMeta.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'POS Item Metas retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosItemMeta.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Item Meta retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('PosItemMeta.create called', { tenantId, phone });
  const created = await service.create(req.body, tenantId, phone);
  createdResponse(res, created, 'POS Item Meta created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosItemMeta.update called', { id, tenantId, phone });
  const updated = await service.update(id, req.body, tenantId, phone);
  successResponse(res, updated, 'POS Item Meta updated successfully');
});

/** "turned off", "TagIds add 1" — what a bulk change did, for the audit log. */
const describeChanges = (changes) => Object.entries(changes)
  .map(([field, value]) => {
    if (field === 'Active') return value ? 'turned on' : 'turned off';
    if (value && typeof value === 'object' && value.mode) return `${field} ${value.mode} ${value.ids.length}`;
    return `${field} ${value === null ? 'cleared' : 'set'}`;
  })
  .join(', ');

// Past this many dishes one summary entry is written instead of one per dish:
// the entries are written before the response, and a request must not wait on
// five hundred inserts.
const AUDIT_PER_DISH_MAX = 50;

const bulkUpdate = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const { ids, changes } = req.body;
  logger.info('PosItemMeta.bulkUpdate called', { tenantId, phone, count: ids.length, fields: Object.keys(changes) });
  const result = await service.bulkUpdate(ids, changes, tenantId, phone);

  // One entry per dish, so the audit log can answer "who turned Paneer 65 off?"
  // rather than only "someone changed some menu items".
  const what = describeChanges(changes);
  const ip = getIp(req);
  const entries = result.items.length <= AUDIT_PER_DISH_MAX
    ? result.items.map((item) => `Bulk updated menu item "${item.ItemName || item.Id}": ${what}`)
    : [`Bulk updated ${result.items.length} menu items: ${what}`];
  for (const action of entries) {
    try {
      await writeAuditLog(tenantId, phone, action, STATUSES.SUCCESS, ip, 'INFO', AUDIT_CATEGORIES.POS);
    } catch (err) {
      logger.error('Audit logging failed', { err: err.message });
    }
  }

  successResponse(res, result, `${result.updated} menu item${result.updated === 1 ? '' : 's'} updated`);
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosItemMeta.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Item Meta deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  bulkUpdate: [validateBody(bulkUpdateSchema), bulkUpdate],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
