// src/modules/assetcategory/assetcategory.routes.js
// Asset category master routes — same ASSET scopes as the register itself.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./assetcategory.controller');

const audit = auditLogCrud('Asset Category', AUDIT_CATEGORIES.POS);

const READ = [
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.ASSET_READ, SCOPES.ASSET_WRITE,
];
const WRITE = [SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.ASSET_WRITE];

router.get('/', authenticateToken, checkScope(...READ), audit, ...controller.getAll);
router.get('/:id', authenticateToken, checkScope(...READ), audit, ...controller.getById);
router.post('/', authenticateToken, checkScope(...WRITE), audit, ...controller.create);
router.put('/:id', authenticateToken, checkScope(...WRITE), audit, ...controller.update);
router.delete('/:id', authenticateToken, checkScope(...WRITE), audit, ...controller.deleteById);

module.exports = router;
