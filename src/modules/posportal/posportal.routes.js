// src/modules/posportal/posportal.routes.js
// POS Portal routes — the master, its store mappings and its listings.
// Every route is audit-logged (AUDIT_CATEGORIES.POS).
//
// ── Scope split, and why it follows the existing model ──────────────────────
// Configuring a portal is POS_CONFIG work that a manager holds — it is master
// data, like channels and food types. The one exception is the availability
// kill switch and bulk stock toggles: those are POS_OPS work that counter staff
// do several times a day, and gating "we've run out of prawns" behind a manager
// scope would mean it does not get done.

const express = require('express');

const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posportal.controller');

const audit = auditLogCrud('POS Portal', AUDIT_CATEGORIES.POS);

// Reading the portal list is offered to POS_OPS as well as POS_CONFIG: the
// order queue needs a portal's colour, monogram and commission to render at
// all, and a cashier holds POS_OPS. Gating the read on POS_CONFIG alone would
// offer the queue to someone and then refuse it its own contents — the same
// mistake that had Billing refuse its own menu.
const READ = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
  SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE,
);
const CONFIG_WRITE = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE,
);
const OPS_WRITE = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_OPS_WRITE, SCOPES.POS_CONFIG_WRITE,
);

// ── Listings ────────────────────────────────────────────────────────────────
// Declared BEFORE /:id so 'listings' is never captured as a portal uuid.

/** POST /listings/availability — bulk stock toggle. Counter work, so OPS. */
router.post('/listings/availability', authenticateToken, OPS_WRITE, audit, ...controller.setAvailability);

/** POST /listings — list an item on a portal. */
router.post('/listings', authenticateToken, CONFIG_WRITE, audit, ...controller.createListing);

/** PUT /listings/:id — change how a portal lists an item. */
router.put('/listings/:id', authenticateToken, CONFIG_WRITE, audit, ...controller.updateListing);

/** DELETE /listings/:id — take an item off a portal. */
router.delete('/listings/:id', authenticateToken, CONFIG_WRITE, audit, ...controller.deleteListing);

// ── Store mappings ──────────────────────────────────────────────────────────

/** POST /branches — map one of our branches to a portal's store. */
router.post('/branches', authenticateToken, CONFIG_WRITE, audit, ...controller.createBranch);

/** PUT /branches/:id — change a store mapping. */
router.put('/branches/:id', authenticateToken, CONFIG_WRITE, audit, ...controller.updateBranch);

/** DELETE /branches/:id — remove a store mapping. */
router.delete('/branches/:id', authenticateToken, CONFIG_WRITE, audit, ...controller.deleteBranch);

/**
 * PUT /branches/:id/online — the kill switch.
 * OPS, not CONFIG: this is what someone reaches for when the kitchen is
 * underwater, and it must not need a manager.
 */
router.put('/branches/:id/online', authenticateToken, OPS_WRITE, audit, ...controller.setOnline);

// ── The portal master ───────────────────────────────────────────────────────

/** GET / — list all portals for the tenant. */
router.get('/', authenticateToken, READ, audit, ...controller.getAll);

/** GET /:id — one portal. */
router.get('/:id', authenticateToken, READ, audit, ...controller.getById);

/** GET /:id/branches — a portal's store mappings. */
router.get('/:id/branches', authenticateToken, READ, audit, ...controller.listBranches);

/** GET /:id/listings — a portal's catalogue, priced. */
router.get('/:id/listings', authenticateToken, READ, audit, ...controller.listListings);

/** POST / — add a portal. */
router.post('/', authenticateToken, CONFIG_WRITE, audit, ...controller.create);

/** PUT /:id — edit a portal. */
router.put('/:id', authenticateToken, CONFIG_WRITE, audit, ...controller.update);

/** DELETE /:id — remove a portal that has never taken an order. */
router.delete('/:id', authenticateToken, CONFIG_WRITE, audit, ...controller.deleteById);

/**
 * PUT /:id/credentials — write a portal's secrets.
 *
 * Write-only by design: there is no GET counterpart anywhere, and the response
 * is a receipt rather than the values. Admin-or-config only.
 */
router.put('/:id/credentials', authenticateToken, CONFIG_WRITE, audit, ...controller.saveCredential);

/** POST /:id/publish-menu — push the catalogue and record what was accepted. */
router.post('/:id/publish-menu', authenticateToken, CONFIG_WRITE, audit, ...controller.publishMenu);

module.exports = router;
