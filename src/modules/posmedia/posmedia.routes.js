// src/modules/posmedia/posmedia.routes.js
//
// A branch's logo and payment QR.
//
// READS are open to every scope that can operate a till, matching
// receipt.format.routes for the same reason stated there: the person pressing
// Print has to be able to fetch what goes on the paper, and a cashier holds
// neither POS_CONFIG:READ nor ORGANIZATION:READ. Gating the read on a config scope
// would mean a bill prints without its logo for exactly the people printing bills.
//
// WRITES are POS_CONFIG:WRITE or ORGANIZATION:WRITE. Branding is a business-details
// act as much as a POS-configuration one — the same reasoning that put the branch
// GSTIN endpoint behind both, since whoever manages the business's identity should
// be able to set the mark that identifies it.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posmedia.controller');

const readAccess = checkScope(...SCOPE_SETS.POS_REFERENCE_READ);
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_CONFIG_WRITE, SCOPES.ORGANIZATION_WRITE,
);

/** GET /?branchId= — both kinds' metadata. Cheap: no bytes. */
router.get('/', authenticateToken, readAccess, ...controller.list);

/**
 * POST /?branchId= — { kind, dataUri }. Upsert: a branch has one of each.
 *
 * A data URI in a JSON body rather than a multipart upload. JSON_LIMIT is already
 * 10mb, this is called twice in a branch's lifetime, and the onboarding wizard
 * sends its logo inside the same JSON tree that creates the tenancy — adding a
 * multipart parser would mean the branch and its picture arrive by two routes.
 */
router.post('/', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'Branch media updated'), ...controller.put);

/** GET /:kind?branchId= — one image, as a data URI. */
router.get('/:kind', authenticateToken, readAccess, ...controller.get);

/** DELETE /:kind?branchId= — remove it. Idempotent. */
router.delete('/:kind', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'WARN', 'Branch media removed'), ...controller.remove);

module.exports = router;
