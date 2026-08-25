// src/modules/itemdetail/itemdetail.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./itemdetail.controller');

// The catalogue item behind a menu entry. The till reads it for every dish on
// the grid — the name resolved here is what goes on the order line, into the
// KOT snapshot and onto the kitchen display, so without it the cook is handed a
// raw uuid. That makes reading an item part of taking an order rather than an
// inventory privilege, and admitting the POS read scopes is what lets a cashier
// keep a role that does not include the whole Inventory section.
//
// WRITE stays with INVENTORY:WRITE — creating catalogue items is stock work.
const READ = [
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.INVENTORY_READ, SCOPES.INVENTORY_WRITE,
  SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE,
  SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
  SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE,
];

router.get('/', authenticateToken,
  checkScope(...READ), auditLogCrud('Item Detail'), ...controller.getAll);
router.get('/:id', authenticateToken,
  checkScope(...READ), auditLogCrud('Item Detail'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.INVENTORY_WRITE),
  auditLogCrud('Item Detail'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.INVENTORY_WRITE),
  auditLogCrud('Item Detail'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.INVENTORY_WRITE),
  auditLogCrud('Item Detail'),
  ...controller.deleteById
);

module.exports = router;
