// src/modules/auth/access.js
// What a member may do in a tenancy, read from the database.
//
// The one place that turns a membership, its roles and their grants into scope
// strings. Sign-in, tenant switching and the per-request access check all call
// it, so a token minted by any of them carries the same claims for the same
// person. Before this, the tenant-switch path built its own list and dropped
// TENANT:SUPER_ADMIN and the role names.

const { QUERIES, SCOPES } = require('../../config/constants');

/**
 * Feature scopes a member holds through their roles in one tenancy.
 *
 * Only roles that belong to THIS tenancy and are active count — the query joins
 * roles on both. A user_roles row pointing at another tenancy's role, or at a
 * role somebody deactivated, grants nothing.
 *
 * @param {Object} conn - A connection or the pool; only .execute is used.
 * @param {string} tenantId
 * @param {string} phone - E.164 identity.
 * @returns {Promise<string[]>} Deduplicated "FEATURE:SCOPE" strings.
 */
const getScopesForTenant = async (conn, tenantId, phone) => {
  const [rows] = await conn.execute(QUERIES.PERMISSIONS.SELECT_ALL_GRANTS, [tenantId, phone]);
  return [...new Set(rows.map((r) => `${r.feature_short_name}:${r.scope}`))];
};

/**
 * Feature scopes plus the two membership flags.
 *
 * TENANT:ADMIN and TENANT:SUPER_ADMIN come from user_tenants and never from a
 * role: a role named TENANT_ADMIN grants its feature scopes and nothing more.
 *
 * @param {Object} conn
 * @param {Object} membership - Needs is_admin and is_super_admin.
 * @param {string} tenantId
 * @param {string} phone
 * @returns {Promise<string[]>}
 */
const buildScopes = async (conn, membership, tenantId, phone) => {
  const scopes = await getScopesForTenant(conn, tenantId, phone);
  if (membership.is_admin) scopes.push(SCOPES.TENANT_ADMIN);
  if (membership.is_super_admin) scopes.push(SCOPES.TENANT_SUPER_ADMIN);
  return scopes;
};

/**
 * The names of the roles a member holds in one tenancy, for the token's
 * `roles` claim. Same tenancy and active rules as the grants.
 *
 * @param {Object} conn
 * @param {string} tenantId
 * @param {string} phone
 * @returns {Promise<string[]>}
 */
const getRoleNames = async (conn, tenantId, phone) => {
  const [rows] = await conn.execute(QUERIES.USER_ROLES.SELECT_BY_USER_TENANT, [phone, tenantId]);
  // role_is_active is absent only in fixtures that predate the column.
  return rows.filter((r) => r.role_is_active !== 0 && r.role_is_active !== false).map((r) => r.role_name);
};

module.exports = { getScopesForTenant, buildScopes, getRoleNames };
