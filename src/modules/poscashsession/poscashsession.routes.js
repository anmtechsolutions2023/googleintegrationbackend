// src/modules/poscashsession/poscashsession.routes.js
// Cash session routes — open a till, check it mid-shift, close and reconcile it.
//
// Opening and closing a till is billing work, so it rides on POS_BILLING scopes:
// the person taking money is the person accountable for the drawer.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLogCrud, auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./poscashsession.controller');

const audit = auditLogCrud('Cash Session', AUDIT_CATEGORIES.POS);

const READ = [
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE,
];
const WRITE = [SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_BILLING_WRITE];

/** GET / — list cash sessions, newest first. */
router.get('/', authenticateToken, checkScope(...READ), audit, ...controller.getAll);

/** GET /:id/summary — live expected cash for an open till. */
router.get('/:id/summary', authenticateToken, checkScope(...READ), audit, ...controller.summary);

/** GET /:id — one cash session. */
router.get('/:id', authenticateToken, checkScope(...READ), audit, ...controller.getById);

/** POST /open — open a till for a cashier at a branch. */
router.post(
  '/open',
  authenticateToken,
  checkScope(...WRITE),
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'INFO', 'Till opened'),
  ...controller.open,
);

/** POST /:id/close — count the drawer and record the variance. */
router.post(
  '/:id/close',
  authenticateToken,
  checkScope(...WRITE),
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'WARN', 'Till closed and reconciled'),
  ...controller.close,
);

module.exports = router;
