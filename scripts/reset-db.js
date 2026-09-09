#!/usr/bin/env node
// scripts/reset-db.js
// Drops the database, recreates it, and applies database/01-schema-definition.sql
// then 02-seed-data.sql in that order.
//
// This project deploys by recreating rather than by migration, so this is the
// supported way to bring a database up to the current build. It exists because
// the documented `mysql -u … < file.sql` route needs a mysql client that is not
// always installed, and "the fix requires a tool you do not have" is how a
// database ends up six columns behind the code for a week.
//
// It performs the exact sequence 01-schema-definition.sql's own header
// documents:
//
//   DROP DATABASE IF EXISTS <db>; CREATE DATABASE <db>;
//   mysql <db> < database/01-schema-definition.sql
//   mysql <db> < database/02-seed-data.sql
//
// WHY DROP THE DATABASE AND NOT JUST THE TABLES
// 01-schema-definition.sql drops the tables it knows about. It cannot drop what
// it has never heard of — a table from an abandoned branch, a view somebody
// added by hand, a leftover from a rename. Those survive a table-level reset and
// then answer stale data or hold a foreign key that blocks the next one.
// Dropping the database is the only reset that actually leaves nothing behind.
//
// Uses mysql2, already a dependency, so there is nothing to install.
//
// DESTRUCTIVE: users, tenants, menu and trading history all go. It refuses to
// run without an explicit --yes, and refuses outright when NODE_ENV=production.
//
//   npm run db:reset -- --yes

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Read through envConfig rather than process.env directly: it is what the app
// itself uses, so the script cannot connect somewhere the server would not.
// It also carries DB_PORT (managed providers assign a per-service port, never
// 3306) and DB_CA_CERT (Aiven signs with its own CA, so TLS fails without it) —
// both of which this script previously ignored, leaving it unable to rebuild
// any database that was not a plaintext localhost.
const {
  DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT, DB_CA_CERT,
} = require('../src/config/envConfig');

const FILES = [
  'database/01-schema-definition.sql',
  'database/02-seed-data.sql',
];

/**
 * Connection options shared by both phases.
 * @param {string|undefined} database - omitted for the drop/create phase, which
 *   cannot connect to a database it is about to destroy.
 */
const connectionOptions = (database) => ({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  ...(database ? { database } : {}),
  ssl: DB_CA_CERT ? { ca: DB_CA_CERT, rejectUnauthorized: true } : undefined,
  // The schema files are plain multi-statement DDL — no procedures, no
  // DELIMITER blocks — so each can be handed over whole.
  multipleStatements: true,
  connectTimeout: 15000,
});

const main = async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run against NODE_ENV=production.');
    process.exit(1);
  }
  if (!DB_NAME) {
    console.error('DB_NAME is not set — check your .env.');
    process.exit(1);
  }
  // The name is interpolated into DDL below, where a placeholder is not legal.
  // Anything but a plain identifier is refused rather than escaped.
  if (!/^[A-Za-z0-9_]+$/.test(DB_NAME)) {
    console.error(`DB_NAME "${DB_NAME}" is not a plain identifier — refusing to build DDL from it.`);
    process.exit(1);
  }

  for (const f of FILES) {
    if (!fs.existsSync(path.resolve(f))) {
      console.error(`Missing ${f} — run this from the project root.`);
      process.exit(1);
    }
  }

  if (!process.argv.includes('--yes')) {
    console.log(`This DROPS the database "${DB_NAME}" on ${DB_HOST}:${DB_PORT} and rebuilds it.`);
    console.log('Users, tenants, menu items and all trading history are lost.');
    console.log('\nRe-run with:  npm run db:reset -- --yes');
    process.exit(1);
  }

  console.log(`Target: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}${DB_CA_CERT ? ' (TLS)' : ''}\n`);

  // ── Phase 1: drop and recreate the database itself ────────────────────────
  // Connected WITHOUT a database, because the one named below is about to stop
  // existing.
  const server = await mysql.createConnection(connectionOptions(undefined));
  try {
    process.stdout.write(`Dropping "${DB_NAME}" … `);
    await server.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
    console.log('ok');

    // CHARACTER SET but deliberately NO COLLATE. 02-seed-data.sql explains why:
    // the server default for utf8mb4 differs between MySQL 5.7
    // (utf8mb4_general_ci) and 8.x (utf8mb4_0900_ai_ci), and pinning one here
    // while the tables take the server default reintroduces the "Illegal mix of
    // collations" mismatch the seed's SET NAMES line exists to avoid.
    process.stdout.write(`Creating "${DB_NAME}" … `);
    await server.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4`);
    console.log('ok');
  } finally {
    await server.end();
  }

  // ── Phase 2: apply the two files, in order ────────────────────────────────
  const conn = await mysql.createConnection(connectionOptions(DB_NAME));
  let tables = 0;
  try {
    for (const f of FILES) {
      process.stdout.write(`Applying ${f} … `);
      await conn.query(fs.readFileSync(path.resolve(f), 'utf8'));
      console.log('ok');
    }

    const [[{ n }]] = await conn.execute(
      'SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [DB_NAME],
    );
    tables = n;
  } finally {
    await conn.end();
  }

  console.log(`\n"${DB_NAME}" rebuilt — ${tables} tables.`);

  // Prove it matches the code, rather than assuming the files were current.
  const { assertSchemaIsCurrent } = require('../src/config/schemaCheck');
  const ok = await assertSchemaIsCurrent();
  console.log(ok
    ? 'Schema check passed. Log in with the seeded number to run first-time setup.'
    : 'Schema check FAILED — see the error above.');
  process.exit(ok ? 0 : 1);
};

main().catch((err) => {
  console.error('\nReset failed:', err.sqlMessage || err.message);
  if (err.code === 'ER_DBACCESS_DENIED_ERROR' || err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error(`"${DB_USER}" needs DROP and CREATE on the server, not only on the database.`);
  }
  process.exit(1);
});
