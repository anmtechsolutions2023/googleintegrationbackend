// src/modules/import/import.controller.js

const service = require('./import.service');
const schemas = require('./import.schemas');
const { asyncHandler, extractUserContext } = require('../../utils/controllerHelper');
const { validateBody } = require('../../middleware/validation');
const { successResponse } = require('../../utils/responseHelper');
const { captureAudit } = require('../../utils/logger');
const { AUDIT_CATEGORIES, STATUSES } = require('../../config/constants');

// Pass one: catalogue items.
//
// Always answers 200 with per-row outcomes. A blanket 4xx would tell the caller
// the file failed when 54 of 56 rows succeeded, and there would be no way to
// know which two to fix.
const importItems = [
  validateBody(schemas.importItemsSchema),
  asyncHandler(async (req, res) => {
    const { userPhone, tenantId } = extractUserContext(req);
    const { rows, onDuplicate } = req.validatedBody;

    const result = await service.importItems(rows, { onDuplicate }, tenantId, userPhone);

    // One audit line for the operation, carrying the counts. Auditing 56
    // individual creates would bury the fact that an import happened at all.
    await captureAudit(req, tenantId, userPhone,
      'ITEMS_BULK_IMPORTED',
      result.summary.failed > 0 ? STATUSES.PARTIAL : STATUSES.SUCCESS,
      AUDIT_CATEGORIES.MASTER_DATA, 'INFO',
      `${result.summary.created} created, ${result.summary.updated} updated, ` +
      `${result.summary.skipped} skipped, ${result.summary.failed} failed`);

    successResponse(res, 'Import finished', result);
  }),
];

// Pass two: publish those items onto one branch's menu.
const importMenuEntries = [
  validateBody(schemas.importMenuSchema),
  asyncHandler(async (req, res) => {
    const { userPhone, tenantId } = extractUserContext(req);
    const result = await service.importMenuEntries(req.validatedBody, tenantId, userPhone);

    await captureAudit(req, tenantId, userPhone,
      'MENU_BULK_PUBLISHED',
      result.summary.failed > 0 ? STATUSES.PARTIAL : STATUSES.SUCCESS,
      AUDIT_CATEGORIES.POS, 'INFO',
      `${result.summary.created} published to branch ${req.validatedBody.branchDetailId}`);

    successResponse(res, 'Menu publish finished', result);
  }),
];

// What the preview needs from the server: which of these tax groups would price
// at 0%. Writes nothing.
const previewTaxGroups = [
  validateBody(schemas.previewSchema),
  asyncHandler(async (req, res) => {
    const { tenantId } = extractUserContext(req);
    const emptyTaxGroups = await service.findEmptyTaxGroups(req.validatedBody.taxGroups, tenantId);
    successResponse(res, 'Preview checks complete', { emptyTaxGroups });
  }),
];

module.exports = { importItems, importMenuEntries, previewTaxGroups };
