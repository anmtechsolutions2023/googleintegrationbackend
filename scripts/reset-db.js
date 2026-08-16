#!/usr/bin/env node
// scripts/reset-db.js
// Rebuilds the database from database/01-schema-definition.sql + 02-seed-data.sql.
//
// This project deploys by recreating rather than by migration, so this is the
// supported way to bring a database up to the current build. It exists because
// the documented `mysql -u … < file.sql` route needs a mysql client that is not
// always installed, and "the fix requires a tool you do not have" is how a
// database ends up six columns behind the code for a week.
//
// Uses mysql2, already a dependency, so there is nothing to install.
//
// DESTRUCTIVE: 01-schema-definition.sql drops every application table before
// recreating it. Users, tenants, menu and trading history all go. It therefore
// refuses to run without an explicit --yes, and refuses outright when
// NODE_ENV=production.
//
//   npm run db:reset -- --yes

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const FILES = [
  'database/01-schema-definition.sql',
  'database/02-seed-data.sql',
];

const main = async () => {
  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, NODE_ENV } = process.env;

  if (NODE_ENV === 'production') {
    console.error('Refusing to run against NODE_ENV=production.');
    process.exit(1);
  }
  if (!DB_NAME) {
    console.error('DB_NAME is not set — check your .env.');
    process.exit(1);
  }

  if (!process.argv.includes('--yes')) {
    console.log(`This DROPS AND RECREATES every table in "${DB_NAME}".`);
    console.log('Users, tenants, menu items and all trading history are lost.');
    console.log('\nRe-run with:  npm run db:reset -- --yes');
    process.exit(1);
  }

  for (const f of FILES) {
    if (!fs.existsSync(path.resolve(f))) {
      console.error(`Missing ${f} — run this from the project root.`);
      process.exit(1);
    }
  }

  const conn = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    // The schema files are plain multi-statement DDL — no procedures, no
    // DELIMITER blocks — so they can be handed over whole.
    multipleStatements: true,
  });

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
    console.log(`\n"${DB_NAME}" rebuilt — ${n} tables.`);
  } finally {
    await conn.end();
  }

  // Prove it matches the code, rather than assuming the files were current.
  const { assertSchemaIsCurrent } = require('../src/config/schemaCheck');
  const ok = await assertSchemaIsCurrent();
  console.log(ok
    ? 'Schema check passed. Log in to run first-time setup.'
    : 'Schema check FAILED — see the error above.');
  process.exit(ok ? 0 : 1);
};

main().catch((err) => {
  console.error('Reset failed:', err.sqlMessage || err.message);
  process.exit(1);
});
