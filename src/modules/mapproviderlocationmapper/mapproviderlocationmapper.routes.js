// src/modules/mapproviderlocationmapper/mapproviderlocationmapper.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./mapproviderlocationmapper.controller');

router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_READ, SCOPES.CONTACTS_WRITE), auditLogCrud('Map Provider Location Mapper'), ...controller.getAll);
router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_READ, SCOPES.CONTACTS_WRITE), auditLogCrud('Map Provider Location Mapper'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Map Provider Location Mapper'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Map Provider Location Mapper'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.CONTACTS_WRITE),
  auditLogCrud('Map Provider Location Mapper'),
  ...controller.deleteById
);

module.exports = router;
