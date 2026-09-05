// src/modules/invitation/invitation.service.js
// A tenancy asking a person to join it.
//
// The counterpart to onboarding_requests, and the piece that was missing: a
// request is raised BY a person who wants in and carries no tenant until an
// admin picks one; an INVITATION is raised BY a tenancy, for a number that may
// have no account yet, and carries the tenancy and the roles from creation.
//
// Two responsibilities live here and nothing else does:
//   raising   — create / list / revoke, all confined to one tenancy
//   claiming  — acceptPendingTx(), called by the login path
//
// Claiming is deliberately NOT in auth.service: what an invitation means, when
// it may be claimed and what it grants belongs to invitations. auth only asks
// "is there anything to claim for this number?" at the right moment.

const { v4: uuidv4 } = require('uuid');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES, INVITATION } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { logger } = require('../../utils/logger');
const { assertRolesGrantable } = require('../../utils/roleGuard');
const { toE164, maskForLog } = require('../../utils/phone');

/**
 * Numbers are compared canonically, not case-insensitively: '+91 98765 43210'
 * and '09876543210' are the same person, and neither is a case variation of the
 * other. toE164 is the single normalisation used everywhere identity is read.
 */
const normalizePhone = (raw) => toE164(raw);

/** Default lifetime, from now. */
const defaultExpiry = () => {
  const d = new Date();
  d.setDate(d.getDate() + INVITATION.EXPIRY_DAYS);
  return d;
};

/**
 * Invite a mobile number into ONE tenancy.
 *
 * The tenancy is the caller's own — it is passed in from req.user.tid and never
 * read from the request body, so a tenant admin cannot inject a member into
 * somebody else's tenancy.
 *
 * @param {Object} p
 * @param {string} p.tenantId - The caller's tenancy.
 * @param {string} p.phone - As typed; normalised to E.164 here.
 * @param {string[]} [p.roleIds] - Roles to grant on acceptance.
 * @param {boolean} [p.isAdmin] - Whether they join as a tenant admin.
 * @param {Object} [p.profile] - { fullName, phone, branchDetailId }. Applied to
 *        the membership on acceptance, so a staff member arrives named rather
 *        than as a bare number somebody has to identify afterwards.
 * @param {string} p.invitedBy
 * @returns {Promise<Object>} The created invitation.
 */
const createInvitation = ({ tenantId, phone, roleIds = [], isAdmin = false, profile = {}, invitedBy }) =>
  withTransaction(async (conn) => {
    const invitee = normalizePhone(phone);
    if (!invitee) throw new HttpError(MESSAGES.ERROR.INVALID_PHONE, 400);

    // An invitation is a MEMBERSHIP request. Someone already in the tenancy has
    // a membership, so this would be a role edit wearing the wrong hat — and
    // there is already an endpoint for that.
    const [existing] = await conn.execute(
      QUERIES.INVITATIONS.SELECT_EXISTING_MEMBERSHIP, [invitee, tenantId],
    );
    if (existing.length > 0) {
      throw new HttpError(MESSAGES.ERROR.INVITE_ALREADY_MEMBER, 409);
    }

    // An invitation carries its roles from creation, so this is the moment the
    // grant is actually decided — refusing it at acceptance would strand a
    // PENDING row nobody can ever claim.
    await assertRolesGrantable(conn, roleIds, tenantId);

    // Roles must belong to the inviting tenancy. Without this check an admin
    // could name a role id belonging to another tenant and grant its
    // permissions inside their own.
    const [ownRoles] = await conn.execute(
      QUERIES.INVITATIONS.SELECT_ROLES_IN_TENANT, [tenantId],
    );
    const ownRoleIds = new Set(ownRoles.map((r) => r.id));
    const foreign = roleIds.filter((id) => !ownRoleIds.has(id));
    if (foreign.length > 0) {
      throw new HttpError(MESSAGES.ERROR.INVITE_ROLE_NOT_IN_TENANT, 400);
    }

    const id = uuidv4();
    const expiresAt = defaultExpiry();
    try {
      await conn.execute(QUERIES.INVITATIONS.INSERT, [
        id, tenantId, invitee, isAdmin ? 1 : 0,
        profile.fullName ?? null, profile.branchDetailId ?? null,
        invitedBy, expiresAt,
      ]);
    } catch (e) {
      // uq_invite_live is a PARTIAL unique index (see the schema): one live
      // invitation per tenant+number, unlimited closed history beside it.
      if (e.code === 'ER_DUP_ENTRY') {
        throw new HttpError(MESSAGES.ERROR.INVITE_ALREADY_PENDING, 409);
      }
      throw e;
    }

    for (const roleId of roleIds) {
      await conn.execute(QUERIES.INVITATIONS.INSERT_ROLE, [id, roleId]);
    }

    return { id, tenantId, phone: invitee, isAdmin: !!isAdmin, roleIds, profile, expiresAt };
  });

/** Every invitation this tenancy has raised, newest first. */
const listInvitations = (tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.INVITATIONS.SELECT_BY_TENANT, [tenantId]);
    return rows;
  });

/**
 * Withdraw a pending invitation.
 * The row is kept and marked REVOKED rather than deleted — who invited whom,
 * and who changed their mind, is worth being able to answer later.
 */
const revokeInvitation = (id, tenantId) =>
  withConnection(async (conn) => {
    const [result] = await conn.execute(QUERIES.INVITATIONS.REVOKE, [id, tenantId]);
    if (!result.affectedRows) {
      // Either it is not this tenancy's, or it is no longer pending. Both are
      // "nothing to revoke" from the caller's side.
      throw new HttpError(MESSAGES.ERROR.INVITE_NOT_PENDING, 404);
    }
  });

/**
 * Claim every live invitation for a verified number. Called by the login path.
 *
 * MUST run on the caller's transaction: a membership created here has to roll
 * back with the sign-in that created it.
 *
 * Idempotent by construction — an invitation is marked ACCEPTED in the same
 * transaction that writes the membership, and a duplicate membership is treated
 * as success. Two tabs completing OAuth at once cannot double-provision.
 *
 * @param {Object} conn - Open TRANSACTION connection.
 * @param {string} phone - The number just proven by a one-time code.
 * @returns {Promise<Array<{tenantId:string, roleCount:number}>>} What was claimed.
 */
const acceptPendingTx = async (conn, phone) => {
  const invitee = normalizePhone(phone);
  if (!invitee) return [];
  const [invitations] = await conn.execute(QUERIES.INVITATIONS.SELECT_CLAIMABLE, [invitee]);
  if (invitations.length === 0) return [];

  const claimed = [];
  for (const invite of invitations) {
    const [roleRows] = await conn.execute(QUERIES.INVITATIONS.SELECT_ROLE_IDS, [invite.id]);
    // Roles the invitation named may have been deleted since it was raised.
    // ON DELETE CASCADE has already removed those rows, so whatever survives is
    // what gets granted — the membership is still created, because locking
    // somebody out is worse than admitting them with fewer rights than intended.
    const roleIds = roleRows.map((r) => r.role_id);

    try {
      await conn.execute(QUERIES.ADMIN_USERS.INSERT_USER_TENANT_FLAGS, [
        uuidv4(), invitee, invite.full_name || invitee,
        invite.tenant_id, invite.is_admin ? 1 : 0, 0,
      ]);
    } catch (e) {
      // Already a member — a concurrent claim, or an invitation raised for
      // somebody who joined by another route in the meantime. Accepting the
      // invitation is still the right outcome.
      if (e.code !== 'ER_DUP_ENTRY') throw e;
    }

    for (const roleId of roleIds) {
      try {
        await conn.execute(QUERIES.USER_ROLES.INSERT, [
          uuidv4(), invitee, invite.tenant_id, roleId, invite.phone,
        ]);
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e;
      }
    }

    // The staff details the invitation carried. Applied after the membership
    // exists so a concurrent claim that lost the insert race still gets them.
    if (invite.full_name || invite.branch_detail_id) {
      await conn.execute(QUERIES.ADMIN_USERS.UPDATE_PROFILE, [
        invite.full_name ?? null, invite.branch_detail_id ?? null,
        invitee, invite.tenant_id,
      ]);
    }

    await conn.execute(QUERIES.INVITATIONS.MARK_ACCEPTED, [invite.id]);

    if (roleIds.length === 0) {
      // A membership with no roles yields no scopes at all — the person signs
      // in and can see nothing. Surfaced so an admin can fix it, rather than
      // failing the login.
      logger.warn('Invitation accepted with no surviving roles', {
        phone: maskForLog(invitee), tenantId: invite.tenant_id, invitationId: invite.id,
      });
    }
    claimed.push({ tenantId: invite.tenant_id, roleCount: roleIds.length });
  }

  logger.info('Invitations claimed at login', { phone: maskForLog(invitee), count: claimed.length });
  return claimed;
};

module.exports = {
  createInvitation,
  listInvitations,
  revokeInvitation,
  acceptPendingTx,
  normalizePhone,
};
