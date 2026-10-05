// src/utils/roleGuard.js
// Roles that no application path may grant, to anybody, ever.
//
// SUPER_ADMIN is the platform owner's role. The platform has exactly one owner
// and that account is established by the seed — there is no legitimate flow that
// hands the rank to a second person, so every path that accepts roleIds refuses
// it here rather than each one remembering to.
//
// Worth being precise about what this does and does not close, because the two
// are easy to conflate:
//
//   - The TENANT:SUPER_ADMIN SCOPE comes from user_tenants.is_super_admin, a
//     column no application code ever writes as 1 (provisionTenantIam and
//     invitation acceptance both hardcode 0). Granting the SUPER_ADMIN role
//     never conferred that scope, and still cannot.
//   - The SUPER_ADMIN ROLE does carry blanket READ+WRITE on every module and
//     every POS feature (see 02-seed-data.sql PART 4/8). THAT is the real
//     over-grant, and it is what this refuses — along with a picker that
//     advertised "Full system access" to anyone inviting a colleague.
//
// Tenant administration is unaffected: TENANT_ADMIN remains grantable, and
// admin rank itself is the is_admin flag, set through its own endpoint.

const { HttpError } = require('../middleware/errorHandler');
const MESSAGES = require('../config/messages');

/** Role names that may never be assigned to a user or attached to an invitation. */
const UNGRANTABLE_ROLE_NAMES = ['SUPER_ADMIN'];

/**
 * Refuses a role assignment that names a role outside the tenancy, or one that
 * may never be granted.
 *
 * Resolves the rows rather than trusting ids: role ids are per-tenant and a
 * caller supplies them directly, so the only trustworthy questions are whether
 * each id is a role of THIS tenancy and what it is actually called.
 *
 * The tenancy check is the important half. This used to look names up inside
 * the tenancy and act only on what it found, so an id from another tenancy was
 * simply not found — neither refused as SUPER_ADMIN nor as foreign — and the
 * caller went on to store it. Sign-in then read that role's grants into the
 * token. Every path that assigns roles (approval, auto-approval, Edit roles,
 * invitations) goes through here, so the check lives here.
 *
 * @param {Object} conn - Open connection (the caller's transaction).
 * @param {string[]} roleIds - Roles the caller is trying to grant.
 * @param {string} tenantId - Tenancy the roles must belong to.
 * @returns {Promise<void>} Throws 400 for a foreign or unknown id, 403 for an
 *   ungrantable role.
 */
const assertRolesGrantable = async (conn, roleIds, tenantId) => {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return;

  const wanted = [...new Set(roleIds)];
  const placeholders = wanted.map(() => '?').join(', ');
  const [rows] = await conn.execute(
    `SELECT id, name FROM roles WHERE tenant_id = ? AND id IN (${placeholders})`,
    [tenantId, ...wanted]
  );

  const found = new Set(rows.map((r) => r.id));
  if (wanted.some((id) => !found.has(id))) {
    throw new HttpError(MESSAGES.ERROR.ROLE_NOT_IN_TENANT, 400);
  }

  const blocked = rows
    .map((r) => r.name)
    .filter((name) => UNGRANTABLE_ROLE_NAMES.includes(name));

  if (blocked.length > 0) {
    throw new HttpError(MESSAGES.ERROR.ROLE_NOT_GRANTABLE, 403);
  }
};

module.exports = { assertRolesGrantable, UNGRANTABLE_ROLE_NAMES };
