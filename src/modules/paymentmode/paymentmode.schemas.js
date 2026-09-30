// src/modules/paymentmode/paymentmode.schemas.js
const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.PAYMENT_MODE),
  Type: Joi.string().required().max(50).trim(),
  // REQUIRED, not optional-with-a-null-default. A tender says where money lands;
  // one with no account books nowhere and vanishes from every report that groups
  // by account. Every method the provisioner creates has one, and letting the API
  // create the only kind that does not is how that hole stays open under a new
  // name. The UI must therefore offer an account picker on create.
  DefaultAccountTypeBaseId: entityId.required(),
  // Whether the till demands a reference number. Replaces a hardcoded match on
  // the mode's NAME, which meant renaming 'Card' silently dropped the rule.
  RequiresReference: Joi.boolean().optional().default(false),
  // What an outlet that has never been configured does with this method.
  EnabledByDefault: Joi.boolean().optional().default(true),
  Active: Joi.boolean().optional().default(true),
  // Not user input — assigned from the tenant's current maximum on create.
  SortOrder: Joi.any().optional().strip(),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.PAYMENT_MODE),
  Type: Joi.string().optional().max(50).trim(),
  // entityId.optional(), NOT optionalEntityId: the latter maps a blank control to
  // NULL, which would let an edit form clear the account and put the method
  // straight back into the state this field exists to prevent. Changing it is
  // fine; emptying it is not.
  DefaultAccountTypeBaseId: entityId.optional(),
  RequiresReference: Joi.boolean().optional(),
  EnabledByDefault: Joi.boolean().optional(),
  Active: Joi.boolean().optional(),
  // Ordering is not editable here; see the column comment.
  SortOrder: Joi.any().optional().strip(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
};
