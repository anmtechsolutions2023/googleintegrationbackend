// src/modules/addressdetail/addressdetail.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./addressdetail.controller');

router.get('/', authenticateToken, auditLogCrud('Address Detail'), ...controller.getAll);
router.get('/:id', authenticateToken, auditLogCrud('Address Detail'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Address Detail'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Address Detail'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Address Detail'),
  ...controller.deleteById
);

module.exports = router;
