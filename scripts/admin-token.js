#!/usr/bin/env node
// scripts/admin-token.js
// Break-glass access.
//
// ── Why this exists ────────────────────────────────────────────────────────
// Sign-in depends on WhatsApp, and WhatsApp depends on one Meta account staying
// in good standing. A template pause, a policy strike, a billing failure or a
// WABA suspension stops EVERY login at EVERY branch at once — and with Google
// retired there is no second door. See WHATSAPP_IDENTITY_MIGRATION.md §9.5.
//
// This mints a short-lived token directly, using the same signing path the
// application does, for someone who can already prove control of the server.
// Shell access IS the authentication: if an attacker has that, a token is the
// least of the problems.
//
// ── What it deliberately does not do ───────────────────────────────────────
// It never creates or elevates anything. It reads existing memberships and
// existing scopes and signs what is already true. A person with no membership
// gets no token. It does not call findAndGetPermissions, which claims
// invitations and can insert onboarding requests — side effects an emergency
// tool must not have on a mistyped identity.
//
// Every run writes an audit row. Emergency access that leaves no trace is how
// an incident becomes an unanswerable question later.
//
//   npm run admin:token -- --identity someone@example.com
//   npm run admin:token -- --identity someone@example.com --tenant <id> --minutes 30
//
// --identity is the mobile number in E.164, e.g. +919876543210. The flag is
// named for the concept rather than the format, so it survived the migration
// from email without renaming.

require('dotenv').config();

const jwt = require('jsonwebtoken');
const db = require('../src/config/db');
const config = require('../src/config/config');
const { QUERIES, SCOPES } = require('../src/config/constants');
const MESSAGES = require('../src/config/messages');
const { getScopesForTenant } = require('../src/modules/auth/auth.service');

const parseArgs = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    out[key.slice(2)] = value && !value.startsWith('--') ? value : true;
    if (out[key.slice(2)] !== true) i += 1;
  }
  return out;
};

const die = (message) => {
  process.stderr.write(`\n  ✗ ${message}\n\n`);
  process.exit(1);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const identity = typeof args.identity === 'string' ? args.identity.trim() : null;
  const minutes = Number(args.minutes) > 0 ? Number(args.minutes) : 15;

  if (!identity) {
    die('Usage: npm run admin:token -- --identity +919876543210 [--tenant <id>] [--minutes 15]');
  }
  if (!process.env.JWT_SECRET) {
    die('JWT_SECRET is not set. Load the same environment the API runs with.');
  }
  if (minutes > 60) {
    die('Refusing to mint a token valid for more than an hour. Break-glass access is meant to be short.');
  }

  const connection = await db.getConnection();
  try {
    const [tenantRows] = await connection.execute(QUERIES.USER_TENANTS.SELECT, [identity]);

    if (tenantRows.length === 0) {
      die(`No active membership found for ${identity}. This tool grants nothing that does not already exist.`);
    }

    // USER_TENANTS.SELECT is ordered by last_active_at, so [0] is the tenancy
    // the application itself would resume into.
    const target = args.tenant
      ? tenantRows.find((t) => t.tenant_id === args.tenant)
      : tenantRows[0];

    if (!target) {
      die(`${identity} is not a member of tenant ${args.tenant}. Available: ${tenantRows.map((t) => t.tenant_id).join(', ')}`);
    }

    const scopes = await getScopesForTenant(connection, target.tenant_id, identity);
    if (target.is_admin) scopes.push(SCOPES.TENANT_ADMIN);
    if (target.is_super_admin) scopes.push(SCOPES.TENANT_SUPER_ADMIN);

    const token = jwt.sign(
      {
        // The identity claim. This said `email` until the migration renamed
        // it, and a token with the wrong claim reads fine but fails EVERY
        // write — CreatedBy, the audit actor and invitedBy all resolve to
        // undefined, and mysql2 refuses undefined bind parameters.
        phone: identity,
        name: target.full_name || identity,
        tid: target.tenant_id,
        scopes,
        onboardingStatus: 'APPROVED',
        roles: [],
        associatedTenants: tenantRows.map((t) => ({
          tenantId: t.tenant_id,
          isAdmin: t.is_admin === 1 || t.is_admin === true,
        })),
        // Marks the token as emergency-issued. Nothing reads it today; it is
        // here so that a token found in a log or a support ticket can be
        // identified as break-glass rather than an ordinary session.
        breakGlass: true,
        iss: MESSAGES.JWT.ISSUER,
      },
      process.env.JWT_SECRET,
      { expiresIn: `${minutes}m` },
    );

    await connection.execute(QUERIES.AUDIT_LOGS.INSERT, [
      target.tenant_id,
      identity,
      'Break-glass token issued',
      'SUCCESS',
      '0.0.0.0',
      'WARN',
      'AUTH',
      null,
      `Issued from the server console for ${minutes} minutes. Scopes: ${scopes.length}.`,
    ]);

    process.stdout.write(
      [
        '',
        `  Tenant   ${target.tenant_id}`,
        `  Scopes   ${scopes.length}`,
        `  Expires  ${minutes} minutes`,
        '',
        token,
        '',
        '  Paste as the auth cookie or an Authorization: Bearer header.',
        '  This grants real access. Do not paste it into a chat or a ticket.',
        '',
      ].join('\n'),
    );
  } finally {
    connection.release();
    await db.end();
  }
};

main().catch((error) => die(error.message));
