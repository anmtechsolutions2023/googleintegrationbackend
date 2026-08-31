// src/config/db.js
// Database configuration and connection pool setup for MySQL.

const mysql = require('mysql2/promise')
const config = require('./config')
const {
  DB_HOST,
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  DB_PORT,
  DB_CA_CERT,
} = require('./envConfig')

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  // Managed providers require TLS. Verification needs their CA, so TLS turns on
  // only when DB_CA_CERT is supplied — a plaintext local MySQL keeps working
  // untouched, and a misconfigured deploy fails loudly rather than silently
  // downgrading to an unverified connection.
  ssl: DB_CA_CERT ? { ca: DB_CA_CERT, rejectUnauthorized: true } : undefined,
  // Without this, an unreachable host burns the platform's whole request budget
  // before mysql2 gives up — the failure reads as a hung app instead of a dead
  // database. Fail fast and let the error handler say what actually happened.
  connectTimeout: config.DATABASE.CONNECT_TIMEOUT_MS,
  waitForConnections: true,
  connectionLimit: config.DATABASE.CONNECTION_LIMIT,
  queueLimit: config.DATABASE.QUEUE_LIMIT,
  // Use UTC timezone for consistent date handling between app and DB
  timezone: 'Z',
})

module.exports = pool
