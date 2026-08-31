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
  // Managed MySQL providers (Aiven, PlanetScale) rarely listen on 3306 — they
  // assign a per-service port. Defaulting to 3306 is what a stock local install
  // uses, so a laptop needs no DB_PORT at all.
  DB_PORT: Number(process.env.DB_PORT) || 3306,
  // PEM contents (not a path) of the provider's CA certificate. Aiven signs with
  // a per-project CA that is not in the system trust store, so without this the
  // TLS handshake cannot be verified. Absent locally, where MySQL is plaintext.
  // Vercel preserves newlines in env vars, but a value pasted through a tool that
  // escapes them still arrives as literal backslash-n; normalise both forms.
  DB_CA_CERT: process.env.DB_CA_CERT
    ? process.env.DB_CA_CERT.replace(/\\n/g, '\n')
    : undefined,

  // ============================================
  // SERVER CONFIGURATION (With Defaults)
  // ============================================
  PORT: process.env.PORT || 5000,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
}
