// src/modules/poswebhook/poswebhook.auth.js
// The only authentication path in this codebase that is not a tenant JWT.
//
// ── Why it has to be different ──────────────────────────────────────────────
// Every other route is authenticateToken + checkScope. An aggregator cannot
// hold a tenant JWT — it has no user, no login and no session. What it has is a
// shared secret and a signature over the request body.
//
// ── The three rules that make it safe ───────────────────────────────────────
//   1. THE TENANT COMES FROM THE CREDENTIAL, NEVER FROM THE PAYLOAD. Everything
//      in the body is attacker-controlled. Only the row whose secret verified
//      the signature is allowed to say which tenant this is.
//   2. VERIFY BEFORE ANYTHING ELSE. No database write, no logging of contents,
//      no parsing beyond what verification needs.
//   3. AN UNCONFIGURED PORTAL IS CLOSED, NOT OPEN. A portal with no secret
//      refuses every request. The absence of configuration must never be the
//      absence of a check.
//
// A portal code can legitimately exist in more than one tenant, so the lookup
// returns every candidate and each is tried. The one whose secret verifies is
// the tenant; if none verify, the request is refused without saying which part
// was wrong.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');
const { resolveAdapter } = require('../posportal/adapters');

/**
 * Which tenant's portal signed this request?
 *
 * @param {Object} req - Express request; needs headers and rawBody.
 * @param {string} code - Portal code from the URL.
 * @returns {Promise<{ portal: Object, credential: Object, tenantId: string }|null>}
 */
const authenticatePortalRequest = async (req, code) => {
  const candidates = await withConnection(async (conn) => {
    const [rows] = await conn.execute(
      QUERIES.POS_PORTAL_CREDENTIAL.SELECT_FOR_VERIFY,
      [String(code || '').toUpperCase()],
    );
    return rows;
  });

  if (!candidates.length) {
    // Deliberately the same outcome as a bad signature. Telling a caller that a
    // portal code exists but is unconfigured is telling them what to try next.
    logger.warn('Portal webhook: no configured portal for code', { code });
    return null;
  }

  for (const row of candidates) {
    const adapter = resolveAdapter(row.Adapter);
    let ok = false;
    try {
      ok = adapter.verify(req, row);
    } catch (err) {
      // A throwing verifier is a failed verification, never a passed one.
      logger.warn('Portal webhook verification threw', {
        code, adapter: row.Adapter, error: err.message,
      });
      ok = false;
    }

    if (ok) {
      return {
        portal: {
          Id: row.PortalId,
          Code: row.PortalCode,
          Adapter: row.Adapter,
          TenantId: row.TenantId,
          // Name is read fresh below — the verify query does not carry it, and
          // the ingest pipeline snapshots it onto the order.
        },
        credential: row,
        tenantId: row.TenantId,
      };
    }
  }

  logger.warn('Portal webhook: signature did not verify', { code });
  return null;
};

/**
 * The portal row proper, once the request is authenticated.
 *
 * A second read rather than widening the verify query, so the security-critical
 * lookup stays narrow and obviously correct.
 */
const loadVerifiedPortal = async (portalId, tenantId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(QUERIES.POS_PORTAL.SELECT_BY_ID, [portalId, tenantId]);
  return rows.length ? rows[0] : null;
});

module.exports = { authenticatePortalRequest, loadVerifiedPortal };
