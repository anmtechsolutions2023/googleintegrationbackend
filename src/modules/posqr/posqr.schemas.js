// src/modules/posqr/posqr.schemas.js
// Joi schemas for the staff QR ordering endpoints.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { QR_ORDERING } = require('../../config/constants');

const branchQuerySchema = Joi.object({
  branchId: entityId.required(),
});

// The review queue may span every branch, so the branch is optional there.
const optionalBranchQuerySchema = Joi.object({
  branchId: entityId.optional().allow(null, ''),
});

const tableParamSchema = Joi.object({ tableId: entityId.required() });
const orderParamSchema = Joi.object({ id: entityId.required() });

const settingsUpdateSchema = Joi.object({
  enabled: Joi.boolean().optional(),
  mode: Joi.string().valid(...Object.values(QR_ORDERING.MODES)).optional(),
}).min(1);

const rejectSchema = Joi.object({
  reasonId: entityId.required(),
  // The guest reads this on their phone, so it is short and plain.
  note: Joi.string().trim().max(200).allow('', null).optional(),
});

module.exports = {
  branchQuerySchema,
  optionalBranchQuerySchema,
  tableParamSchema,
  orderParamSchema,
  settingsUpdateSchema,
  rejectSchema,
};
