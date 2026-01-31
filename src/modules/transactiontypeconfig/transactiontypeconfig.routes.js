// src/modules/transactiontypeconfig/transactiontypeconfig.routes.js
// Transaction Type Config management routes

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./transactiontypeconfig.controller');

router.get('/', authenticateToken, auditLog(), ...controller.getAll);
router.get('/:id', authenticateToken, auditLog(), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...controller.deleteById
);

module.exports = router;
