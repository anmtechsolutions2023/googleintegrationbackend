// src/modules/posreport/posreport.routes.js
// POS Reports route — read-only aggregation endpoint.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posreport.controller');

/** GET / — POS summary: revenue, orders, KOTs, tables, trends, recent orders. */
router.get(
  '/',
  authenticateToken,
  checkScope(SCOPES.POS_REPORTS_READ, SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLogCrud('POS Report', AUDIT_CATEGORIES.POS),
  ...controller.getSummary
);

module.exports = router;
