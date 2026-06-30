// src/modules/contactdetail/contactdetail.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./contactdetail.controller');

router.get('/', authenticateToken, auditLogCrud('Contact Detail'), ...controller.getAll);
router.get('/:id', authenticateToken, auditLogCrud('Contact Detail'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Contact Detail'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Contact Detail'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Contact Detail'),
  ...controller.deleteById
);

module.exports = router;
