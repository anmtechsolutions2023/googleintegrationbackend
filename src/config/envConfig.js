// src/config/envConfig.js
// Centralized environment variables with fallbacks
// Single point of access for all environment-specific configuration

module.exports = {
  // ============================================
  // APPLICATION SECRETS (Required)
  // ============================================
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  JWT_SECRET: process.env.JWT_SECRET,

  // ============================================
  // DATABASE CREDENTIALS (Required)
  // ============================================
  DB_HOST: process.env.DB_HOST,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME,

  // ============================================
  // SERVER CONFIGURATION (With Defaults)
  // ============================================
  PORT: process.env.PORT || 5000,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
}
