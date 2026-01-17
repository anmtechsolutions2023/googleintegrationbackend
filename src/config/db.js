// src/config/db.js
// Database configuration and connection pool setup for MySQL.

const mysql = require('mysql2/promise')
const config = require('./config')
const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = require('./envConfig')

const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: config.DATABASE.CONNECTION_LIMIT,
  queueLimit: config.DATABASE.QUEUE_LIMIT,
})

module.exports = pool
