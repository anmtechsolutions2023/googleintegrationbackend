// src/config/db.js
// Database configuration and connection pool setup for MySQL.

const mysql = require('mysql2/promise')
const config = require('./config')

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: config.DATABASE.CONNECTION_LIMIT,
  queueLimit: config.DATABASE.QUEUE_LIMIT,
})

module.exports = pool
