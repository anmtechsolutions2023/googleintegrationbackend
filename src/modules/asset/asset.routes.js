// src/modules/asset/asset.routes.js
// Asset register routes — finance-owned reference data, so it has its own
// ASSET scopes rather than riding on POS floor operations.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./asset.controller');

const audit = auditLogCrud('Asset', AUDIT_CATEGORIES.POS);

const READ = [
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.ASSET_READ, SCOPES.ASSET_WRITE,
];
const WRITE = [SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.ASSET_WRITE];

/** GET /summary — register value by branch and category. Before /:id. */
router.get('/summary', authenticateToken, checkScope(...READ), audit, ...controller.summary);

/** GET / — list assets. */
router.get('/', authenticateToken, checkScope(...READ), audit, ...controller.getAll);

/** GET /:id — one asset. */
router.get('/:id', authenticateToken, checkScope(...READ), audit, ...controller.getById);

/** POST / — register an asset. */
router.post('/', authenticateToken, checkScope(...WRITE), audit, ...controller.create);

/** PUT /:id — update an asset. */
router.put('/:id', authenticateToken, checkScope(...WRITE), audit, ...controller.update);

/** DELETE /:id — remove an asset from the register. */
router.delete('/:id', authenticateToken, checkScope(...WRITE), audit, ...controller.deleteById);

module.exports = router;
