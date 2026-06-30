// src/modules/onboarding/onboarding.controller.js

const Joi = require('joi');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateBody } = require('../../middleware/validation');
const service = require('./onboarding.service');
const MESSAGES = require('../../config/messages');

const noteSchema = Joi.object({
  requestNote: Joi.string().max(500).optional().allow(''),
});

const getStatus = [
  asyncHandler(async (req, res) => {
    const status = await service.getStatus(req.user.email);
    successResponse(res, 'Onboarding status retrieved', status);
  }),
];

const updateNote = [
  validateBody(noteSchema),
  asyncHandler(async (req, res) => {
    await service.updateNote(req.user.email, req.body.requestNote ?? '');
    successResponse(res, MESSAGES.SUCCESS.ONBOARDING_REQUEST_SUBMITTED);
  }),
];

module.exports = { getStatus, updateNote };
