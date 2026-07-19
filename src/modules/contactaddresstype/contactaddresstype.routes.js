// src/modules/contactaddresstype/contactaddresstype.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./contactaddresstype.controller');

router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_READ, SCOPES.MASTER_DATA_WRITE, SCOPES.CONTACTS_READ, SCOPES.CONTACTS_WRITE), auditLogCrud('Contact Address Type'), ...controller.getAll);
router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_READ, SCOPES.MASTER_DATA_WRITE, SCOPES.CONTACTS_READ, SCOPES.CONTACTS_WRITE), auditLogCrud('Contact Address Type'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Contact Address Type'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Contact Address Type'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Contact Address Type'),
  ...controller.deleteById
);

module.exports = router;
