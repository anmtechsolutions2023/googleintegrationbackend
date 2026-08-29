// src/modules/posoffer/offer.routes.js
//
// Campaigns and offers.
//
// WRITES are POS_CONFIG:WRITE and audited. Creating an offer is authorising the
// business to give money away on every till at once — the same kind of act as
// editing the menu, not the same kind as taking an order.
//
// The PREVIEW is open to every scope that can operate a till: the cashier
// pressing "Check offers" holds neither POS_CONFIG:READ nor POS_REPORTS:READ,
// and gating the read on config scopes would mean the one person who needs it
// cannot call it.
//
// The REPORT is POS_REPORTS:READ — what a campaign cost is a management
// question, not a counter one.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const c = require('./offer.controller');

const readAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
);
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE,
);
const reportAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_REPORTS_READ, SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
);
// A till has to evaluate offers to show them.
const tillAccess = checkScope(...SCOPE_SETS.POS_REFERENCE_READ);

/** POST /preview — what would apply to this cart. Writes nothing. */
router.post('/preview', authenticateToken, tillAccess, ...c.previewOffers);

// ── Campaigns ────────────────────────────────────────────────────────────────
router.get('/campaigns', authenticateToken, readAccess, ...c.listCampaigns);
router.post('/campaigns', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'Campaign created'), ...c.createCampaign);
router.get('/campaigns/:id', authenticateToken, readAccess, ...c.getCampaign);
router.put('/campaigns/:id', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'Campaign updated'), ...c.updateCampaign);

/**
 * PUT /campaigns/:id/status — the switch.
 *
 * Its own route, audited at WARN: this is what somebody reaches for when a
 * promotion is going wrong, and who flipped it matters more than who renamed it.
 */
router.put('/campaigns/:id/status', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'WARN', 'Campaign paused or resumed'), ...c.setCampaignStatus);

router.delete('/campaigns/:id', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'WARN', 'Campaign deleted'), ...c.deleteCampaign);

/** GET /campaigns/:id/report — what it cost, and what those bills came to. */
router.get('/campaigns/:id/report', authenticateToken, reportAccess, ...c.campaignReport);

// ── Offers ───────────────────────────────────────────────────────────────────
router.get('/campaigns/:id/offers', authenticateToken, readAccess, ...c.listOffers);
router.post('/campaigns/:id/offers', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'Offer created'), ...c.createOffer);
router.put('/offers/:id', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'Offer updated'), ...c.updateOffer);
router.delete('/offers/:id', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'WARN', 'Offer deleted'), ...c.deleteOffer);

module.exports = router;
