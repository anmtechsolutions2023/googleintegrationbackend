// src/modules/accounttypebase/accounttypebase.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./accounttypebase.controller');

// Which account a spend books against. Configuring an expense CATEGORY needs
// this list, and that screen is gated on POS_OPS — so a POS manager setting up
// categories would otherwise face an empty Account dropdown unless they were
// also handed MASTER_DATA:READ. Reading the chart of accounts is part of the
// task; changing it stays master-data work.
const READ = [
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.MASTER_DATA_READ, SCOPES.MASTER_DATA_WRITE,
  SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE,
  // Expense Categories is also reachable on approval authority alone.
  SCOPES.EXPENSE_APPROVE,
];

router.get('/', authenticateToken,
  checkScope(...READ), auditLogCrud('Account Type Base'), ...controller.getAll);
router.get('/:id', authenticateToken,
  checkScope(...READ), auditLogCrud('Account Type Base'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Account Type Base'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Account Type Base'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Account Type Base'),
  ...controller.deleteById
);

module.exports = router;
