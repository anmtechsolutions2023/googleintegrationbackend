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
  // Both of these, or neither: mysql2 schedules its idle sweeper only when
  // maxIdle < connectionLimit, and maxIdle defaults to connectionLimit. Passing
  // idleTimeout alone is silently inert — the pool then never closes a
  // connection it has opened, which is exactly how production reached the
  // server's max_connections. See config.DATABASE.MAX_IDLE for the full story.
  maxIdle: config.DATABASE.MAX_IDLE,
  idleTimeout: config.DATABASE.IDLE_TIMEOUT_MS,
  // Use UTC timezone for consistent date handling between app and DB
  timezone: 'Z',
})

module.exports = pool
