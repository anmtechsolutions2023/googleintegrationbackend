#!/usr/bin/env node
// scripts/run-migration.js
// Applies one ALTER script from database/migrations/ to the database named in
// your .env — including a production one.
//
// ── Why this exists ────────────────────────────────────────────────────────
// The migration files document `mysql -u … < file.sql`, and that is the right
// command when the client is installed. It often is not: the mysql CLI does not
// ship with Node, and this repository already has scripts/reset-db.js for the
// same reason. "The fix requires a tool you do not have" is how a production
// database ends up two columns behind the code it is serving.
//
// It also carries what a managed provider needs and a bare mysql invocation
// does not get for free: Aiven assigns a per-service PORT and signs with its
// OWN CA, so DB_PORT and DB_CA_CERT both have to reach the connection.
//
// ── The deliberate difference from reset-db ────────────────────────────────
// reset-db REFUSES to run against production, because dropping a live database
// is never what anyone meant. This is the opposite tool: applying a migration
// to production is precisely the job. So the guard is not a refusal, it is
// making the target impossible to misread — the host and database are printed
// and the run needs an explicit --yes.
//
// EVERY RESULT SET IS PRINTED. A migration's pre-flight and verification blocks
// are the whole point of running it; swallowing them would leave the operator
// with "it finished" and no idea whether it worked.
//
//   npm run db:migrate -- database/migrations/<file>.sql
//   npm run db:migrate -- database/migrations/<file>.sql --yes
//
// DDL IN MYSQL IS NOT TRANSACTIONAL. Each ALTER commits on its own, so this
// cannot roll the file back as a unit. The migrations are written to be
// re-runnable for exactly that reason: if one fails, fix it and run again.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const {
  DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT, DB_CA_CERT,
} = require('../src/config/envConfig');

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const file = args.find((a) => !a.startsWith('--'));

/**
 * Renders one result set: a table of rows, or a one-line summary of a write.
 *
 * Numbered over what is actually PRINTED, not over every statement in the
 * file. Raw statement indices jump — 1, 2, 12 — because the idempotency
 * checks in between return nothing, and an operator reading production output
 * should not have to wonder what happened to results 3 through 11.
 */
let shown = 0;
const report = (result) => {
  if (Array.isArray(result)) {
    shown += 1;
    if (result.length === 0) {
      console.log(`\n(${shown}) no rows`);
      return;
    }
    console.log(`\n(${shown})`);
    console.table(result.map((row) => ({ ...row })));
    return;
  }
  if (result && typeof result.affectedRows === 'number' && result.affectedRows > 0) {
    // Only worth a line when it actually did something. A migration is mostly
    // no-ops on a second run, and a wall of "0 rows" hides the one that matters.
    shown += 1;
    console.log(`\n(${shown}) ${result.affectedRows} row(s) affected`);
  }
};

const main = async () => {
  if (!file) {
    console.error('Usage: npm run db:migrate -- <path/to/migration.sql> [--yes]');
    process.exit(1);
  }
  const full = path.resolve(file);
  if (!fs.existsSync(full)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }
  if (!DB_NAME) {
    console.error('DB_NAME is not set — check your .env.');
    process.exit(1);
  }

  const target = `${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}${DB_CA_CERT ? ' (TLS)' : ''}`;
  console.log(`Migration : ${path.relative(process.cwd(), full)}`);
  console.log(`Target    : ${target}`);
  console.log(`NODE_ENV  : ${process.env.NODE_ENV || '(unset)'}`);

  if (!confirmed) {
    console.log('\nThis applies the file above to that database.');
    console.log('Back it up first:');
    console.log(`  mysqldump -u ${DB_USER} -h ${DB_HOST} -P ${DB_PORT} -p ${DB_NAME} > backup-$(date +%F).sql`);
    console.log('\nRe-run with:  npm run db:migrate -- ' + file + ' --yes');
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    ssl: DB_CA_CERT ? { ca: DB_CA_CERT, rejectUnauthorized: true } : undefined,
    // The migrations are plain multi-statement DDL plus PREPARE/EXECUTE — no
    // procedures, no DELIMITER blocks — so the file goes over whole.
    multipleStatements: true,
    connectTimeout: 15000,
  });

  try {
    console.log('\nApplying…');
    const [results] = await conn.query(fs.readFileSync(full, 'utf8'));
    (Array.isArray(results) ? results : [results]).forEach((r) => report(r));
    console.log('\nApplied. Read the tables above — the last one is the migration\'s own verification.');
  } finally {
    await conn.end();
  }
};

main().catch((err) => {
  console.error('\nMigration failed:', err.sqlMessage || err.message);
  if (err.sql) console.error('while running:', String(err.sql).trim().split('\n')[0], '…');
  console.error('\nNothing after that point ran. These files are re-runnable:');
  console.error('fix the cause and run the same command again.');
  process.exit(1);
});
