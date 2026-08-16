// src/modules/expensecategory/expensecategory.routes.js
// Expense category master routes.
//
// Reading is open to anyone who can raise an expense (they must pick a
// category); changing the master needs approval rights, because renaming or
// deleting a category rewrites how every past expense reports.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./expensecategory.controller');

const audit = auditLogCrud('Expense Category', AUDIT_CATEGORIES.POS);

const READ = [
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE, SCOPES.EXPENSE_APPROVE,
];
const WRITE = [SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.EXPENSE_APPROVE];

router.get('/', authenticateToken, checkScope(...READ), audit, ...controller.getAll);
router.get('/:id', authenticateToken, checkScope(...READ), audit, ...controller.getById);
router.post('/', authenticateToken, checkScope(...WRITE), audit, ...controller.create);
router.put('/:id', authenticateToken, checkScope(...WRITE), audit, ...controller.update);
router.delete('/:id', authenticateToken, checkScope(...WRITE), audit, ...controller.deleteById);

module.exports = router;
