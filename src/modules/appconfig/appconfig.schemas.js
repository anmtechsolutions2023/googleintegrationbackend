// src/modules/appconfig/appconfig.schemas.js
// Joi validation for the Application Configuration endpoints.

const Joi = require('joi');

// PATCH body — at least one setting must be present. Global on/off for now.
const updateConfigSchema = Joi.object({
  autoApproveOnboarding: Joi.boolean(),
}).min(1);

module.exports = { updateConfigSchema };
