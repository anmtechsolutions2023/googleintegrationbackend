// src/modules/export/export.routes.js
// CSV exports. One route serves every file; WHO may take which file is decided
// per export in export.catalogue.js, on the scope its own screen opens on —
// so the route itself only requires a signed-in member of the tenancy.
//
// Every download is audit-logged by the controller with the file name, the row
// count, the range and whether mobiles were masked. The route-level auditLog
// defers to that row and only writes when the request FAILED (no permission,
// bad range), so a refused attempt to take the customer list is on record too.

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./export.controller');

const audited = auditLog(AUDIT_CATEGORIES.REPORTS, 'INFO', 'Export attempted', { deferToCapture: true });

/** GET / — the exports the caller may take, with their columns and filters. */
router.get('/', authenticateToken, ...controller.list);

/** GET /bundle — every Insights report for a period, as one .zip. */
router.get('/bundle', authenticateToken, audited, ...controller.bundle);

/** GET /:key/preview — what a download would hold, without downloading it. */
router.get('/:key/preview', authenticateToken, ...controller.preview);

/** GET /:key — the file. */
router.get('/:key', authenticateToken, audited, ...controller.download);

module.exports = router;
