// src/modules/pricing/pricing.routes.js
// Stateless tax & price calculation over the
// costinfo → taxgroup → mapper → TaxTypes chain.
//
// Read-level scopes only: quoting stores nothing and reveals no more than the
// master-data read endpoints already do. POS roles are included so the Billing
// cart can quote live totals without a master-data grant.

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { SCOPES } = require('../../config/constants');
const controller = require('./pricing.controller');

const READ_SCOPES = [
  SCOPES.TENANT_ADMIN,
  SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.MASTER_DATA_READ,
  SCOPES.MASTER_DATA_WRITE,
  SCOPES.POS_ORDER_READ,
  SCOPES.POS_BILLING_READ,
];

router.post(
  '/quote',
  authenticateToken,
  checkScope(...READ_SCOPES),
  ...controller.quote
);

router.get(
  '/tax-groups/:taxGroupId/rate',
  authenticateToken,
  checkScope(...READ_SCOPES),
  ...controller.taxGroupRate
);

module.exports = router;
