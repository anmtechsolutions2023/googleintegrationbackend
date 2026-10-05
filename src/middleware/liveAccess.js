// src/middleware/liveAccess.js
// Re-reads a member's access on each request instead of trusting the token's
// scopes for the whole of its life.
//
// A token is signed once at sign-in and lives an hour, and its scopes used to
// be the only thing checkScope consulted. Suspending somebody, removing them,
// withdrawing Admin or editing one of their roles therefore reached them only
// at their next sign-in — up to an hour later, during which a suspended person
// kept working.
//
// This replaces req.user.scopes with what the database says now. A membership
// that is gone, suspended or inactive is refused with 401, which the browser
// treats as "sign in again". When the scopes merely changed, the response
// carries a re-signed token (same expiry, fresh scopes) so the screens catch up
// without anybody being signed out.
//
// The answer is cached per member for a few seconds: a page load fires several
// calls at once, and they should not each cost two queries. The admin service
// drops the entry the moment it changes somebody's access, so the instance that
// made the change applies it on the very next request; other instances (each
// serverless instance has its own cache) within TTL_MS.

const jwt = require('jsonwebtoken');
const db = require('../config/db');
const MESSAGES = require('../config/messages');
const { JWT_SECRET } = require('../config/envConfig');
const { QUERIES } = require('../config/constants');
const { HttpError } = require('./errorHandler');
const { buildScopes, getRoleNames } = require('../modules/auth/access');

const TTL_MS = 15 * 1000;
// A bound on memory, not a working set: a cache this size is far beyond any
// one instance's live members, so clearing it outright is rare and harmless.
const MAX_ENTRIES = 5000;
// Read by the frontend's API client, which swaps it in for the stored token.
const REFRESH_HEADER = 'X-Access-Token';

const cache = new Map();

// Off under Jest unless a test opts in: the integration suites mock the pool
// with canned rows, and a membership lookup on every request would read those
// as "no such member" and refuse everything.
const enabled = () =>
  process.env.NODE_ENV !== 'test' || process.env.LIVE_ACCESS_IN_TESTS === '1';

const keyOf = (tenantId, phone) => `${tenantId}|${phone}`;

/**
 * The member's access as the database has it now, or null when the membership
 * no longer lets them in.
 *
 * Sequential, not Promise.all: each query takes a pool connection, and a
 * request that holds two at once is the shape that starves the pool under
 * concurrent page loads (see config.js).
 */
const load = async (tenantId, phone) => {
  const [rows] = await db.execute(QUERIES.ADMIN_USERS.SELECT_ACCESS_FLAGS, [phone, tenantId]);
  const membership = rows[0];
  if (!membership || !membership.is_active) return null;
  if (membership.status && membership.status !== 'ACTIVE') return null;

  const scopes = await buildScopes(db, membership, tenantId, phone);
  const roles = await getRoleNames(db, tenantId, phone);
  return { scopes, roles };
};

const currentAccess = async (tenantId, phone) => {
  const key = keyOf(tenantId, phone);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.access;

  const access = await load(tenantId, phone);
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { at: Date.now(), access });
  return access;
};

const sameScopes = (a = [], b = []) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((s) => y.has(s));
};

/**
 * The caller's token with today's scopes. The expiry is carried over rather
 * than renewed: a change of access must never lengthen a session.
 */
const reissue = (claims, access) => {
  const next = { ...claims, scopes: access.scopes, roles: access.roles };
  delete next.iat;
  return jwt.sign(next, JWT_SECRET);
};

/** True when this request's user is a tenant member whose access can change. */
const applies = (user) => enabled() && !!user && !!user.tid;

/**
 * Brings req.user up to date. Throws 401 when the membership no longer admits
 * them; otherwise replaces the scopes and, when they changed, sets the refresh
 * header on the response.
 *
 * @param {Object} req
 * @param {Object} res
 */
const refresh = async (req, res) => {
  const user = req.user;
  const access = await currentAccess(user.tid, user.phone);
  if (!access) {
    throw new HttpError(MESSAGES.ERROR.ACCESS_REVOKED, MESSAGES.HTTP_STATUS.UNAUTHORIZED);
  }
  if (!sameScopes(user.scopes, access.scopes)) {
    req.user = { ...user, scopes: access.scopes, roles: access.roles };
    if (res && typeof res.setHeader === 'function') {
      res.setHeader(REFRESH_HEADER, reissue(user, access));
    }
  }
};

/**
 * Forget a cached answer so the next request reads the database. With a phone,
 * one member; without, everybody in the tenancy (a role's grants changed).
 *
 * @param {string} tenantId
 * @param {string} [phone]
 */
const invalidate = (tenantId, phone) => {
  if (phone) {
    cache.delete(keyOf(tenantId, phone));
    return;
  }
  const prefix = `${tenantId}|`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
};

module.exports = { applies, refresh, invalidate, REFRESH_HEADER, TTL_MS, _cache: cache };
