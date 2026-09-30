// src/modules/pospaymentmethod/pospaymentmethod.schemas.js

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');

/** Every route here is per-outlet, so the branch is never optional. */
const branchQuerySchema = Joi.object({
  branchId: entityId.required(),
});

/**
 * A save. `methods` may name ONE entry or every one — a partial list is the
 * normal case, since the screen saves a switch at a time.
 *
 * `.min(1)` rather than allowing an empty array: an empty save is a request that
 * asks for nothing, and answering 200 to it would tell a screen its toggle had
 * been stored when nothing was written.
 */
const saveSchema = Joi.object({
  methods: Joi.array().items(Joi.object({
    paymentModeId: entityId.required(),
    enabled: Joi.boolean().required(),
  })).min(1).required(),
});

module.exports = { branchQuerySchema, saveSchema };
