// src/modules/onboarding/onboarding.routes.js
// Routes for pending/rejected users: status check and note update.
// Both endpoints require a valid JWT AND the guest:explore scope.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkGuestScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const controller = require('./onboarding.controller');

router.get('/status',
  authenticateToken, checkGuestScope,
  auditLog(AUDIT_CATEGORIES.ONBOARDING, 'DEBUG', AUDIT_ACTIONS.CHECK_ONBOARDING_STATUS),
  ...controller.getStatus);

router.put('/note',
  authenticateToken, checkGuestScope,
  auditLog(AUDIT_CATEGORIES.ONBOARDING, 'INFO', AUDIT_ACTIONS.UPDATE_ONBOARDING_NOTE),
  ...controller.updateNote);

module.exports = router;
