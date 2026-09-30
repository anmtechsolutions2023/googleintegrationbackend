// src/modules/posdine/dine.session.js
// The diner's session token: what one verified phone may do at one table.
//
// SIGNED WITH A DIFFERENT KEY FROM STAFF TOKENS, and that is the whole point.
// authenticateToken accepts any token carrying a `tid` and a `scopes` array, so
// a diner token signed with JWT_SECRET would open every staff route that has no
// checkScope of its own. With a separate key it fails signature verification
// there before any claim is read. QR_TABLE_ORDERING_DESIGN.md D3.
//
// The key is DINER_JWT_SECRET when set. When it is not, one is DERIVED from
// JWT_SECRET with an HMAC under a fixed label — a different key that no staff
// verifier will accept, without making a new secret a deployment prerequisite.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../../config/envConfig');
const { QR_ORDERING } = require('../../config/constants');
const RATE_LIMITS = require('../../config/rateLimits');

const DERIVATION_LABEL = 'restro-os/diner-session/v1';

const signingKey = () => {
  if (process.env.DINER_JWT_SECRET) return process.env.DINER_JWT_SECRET;
  if (!JWT_SECRET) throw new Error('JWT_SECRET is required to sign diner sessions');
  return crypto.createHmac('sha256', JWT_SECRET).update(DERIVATION_LABEL).digest('hex');
};

/**
 * @param {Object} s
 * @param {string} s.phone - E.164, verified.
 * @param {string} s.tenantId
 * @param {string} s.branchId
 * @param {string} s.tableId
 * @param {string} s.qrId - The code the session was opened with.
 * @param {string} s.customerId
 * @returns {{token: string, expiresInSeconds: number}}
 */
const issue = ({ phone, tenantId, branchId, tableId, qrId, customerId }) => {
  const expiresInSeconds = RATE_LIMITS.DINER.SESSION_TTL_SECONDS;
  const token = jwt.sign(
    { phone, tid: tenantId, bid: branchId, tableId, qrId, customerId },
    signingKey(),
    { audience: QR_ORDERING.SESSION_AUDIENCE, expiresIn: expiresInSeconds },
  );
  return { token, expiresInSeconds };
};

/**
 * Verifies signature, audience and expiry. Throws on anything else.
 * @param {string} token
 * @returns {Object} The claims, including `iat` (seconds).
 */
const verify = (token) =>
  jwt.verify(token, signingKey(), { audience: QR_ORDERING.SESSION_AUDIENCE });

module.exports = { issue, verify };
