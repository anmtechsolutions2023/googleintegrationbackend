// src/modules/posreturnreason/posreturnreason.routes.js
// The return-reason master. Every route is audit-logged (AUDIT_CATEGORIES.POS).
//
// READ is offered to POS_OPS and TRANSACTIONS as well as POS_CONFIG: the return
// picker at the till needs the list to populate its dropdown, and a cashier
// holds POS_OPS. Gating the read on POS_CONFIG alone would offer the Return
// button and then refuse it the reasons it requires — the same mistake that
// once had Billing refuse its own menu.
//
// WRITE stays POS_CONFIG: editing the taxonomy is master-data work.

const express = require('express');

const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posreturnreason.controller');

const audit = auditLogCrud('POS Return Reason', AUDIT_CATEGORIES.POS);

const READ = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
  SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE,
  SCOPES.TRANSACTIONS_READ, SCOPES.TRANSACTIONS_WRITE,
);
const WRITE = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE,
);

/** GET / — the reasons a return may be recorded against. */
router.get('/', authenticateToken, READ, audit, ...controller.getAll);
/** GET /:id — one reason. */
router.get('/:id', authenticateToken, READ, audit, ...controller.getById);
/** POST / — add a reason. */
router.post('/', authenticateToken, WRITE, audit, ...controller.create);
/** PUT /:id — edit a reason. */
router.put('/:id', authenticateToken, WRITE, audit, ...controller.update);
/** DELETE /:id — remove a reason. */
router.delete('/:id', authenticateToken, WRITE, audit, ...controller.deleteById);

module.exports = router;
