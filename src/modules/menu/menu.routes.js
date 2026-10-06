// src/modules/menu/menu.routes.js
// The Menu workspace: dishes, the dish editor, the menu file, the prices
// grid and dish photos.
//
// Reading the menu opens on POS_CONFIG:READ, as Menu Master always has;
// changing it needs POS_CONFIG:WRITE. Admins pass both.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./menu.controller');

const READ = checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE);
const WRITE = checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE);
const audit = (label) => auditLog(AUDIT_CATEGORIES.MASTER_DATA, 'INFO', label);
// The controller writes the detailed row; this one only records a failure.
const auditFailures = (label) => auditLog(AUDIT_CATEGORIES.MASTER_DATA, 'INFO', label, { deferToCapture: true });

/** GET /options — everything the editor's pickers offer. */
router.get('/options', authenticateToken, READ, ...controller.options);

/** GET /dishes — one line per dish. */
router.get('/dishes', authenticateToken, READ, ...controller.list);
/** POST /dishes — a new dish, creating any master it names. */
router.post('/dishes', authenticateToken, WRITE, audit('Dish created'), ...controller.create);
/** POST /dishes/bulk — hide, show, tag or (un)list many dishes. */
router.post('/dishes/bulk', authenticateToken, WRITE, audit('Dishes changed in bulk'), ...controller.bulk);
router.get('/dishes/:itemId', authenticateToken, READ, ...controller.getOne);
router.put('/dishes/:itemId', authenticateToken, WRITE, audit('Dish saved'), ...controller.update);

router.get('/dishes/:itemId/photo', authenticateToken, READ, ...controller.getPhoto);
router.put('/dishes/:itemId/photo', authenticateToken, WRITE, audit('Dish photo saved'), ...controller.putPhoto);
router.delete('/dishes/:itemId/photo', authenticateToken, WRITE, audit('Dish photo removed'), ...controller.deletePhoto);

/** POST /import/preview — what a menu file would do. Writes nothing. */
router.post('/import/preview', authenticateToken, WRITE, ...controller.importPreview);
/** POST /import/apply — apply a menu file. */
router.post('/import/apply', authenticateToken, WRITE, auditFailures('Menu file import attempted'), ...controller.importApply);

/** GET /prices — base, branch and portal prices for every dish. */
router.get('/prices', authenticateToken, READ, ...controller.prices);
/** PUT /prices — a batch of price and listing changes, all or nothing. */
router.put('/prices', authenticateToken, WRITE, auditFailures('Menu price change attempted'), ...controller.savePrices);

module.exports = router;
