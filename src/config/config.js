// filepath: src/config/config.js
// Centralized configuration for all hard-coded values
// This allows easy adjustment without changing source code

module.exports = {
  // ============================================
  // DATABASE CONFIGURATION
  // ============================================
  DATABASE: {
    // Connection pool settings
    CONNECTION_LIMIT: 10, // Maximum number of connections in the pool
    QUEUE_LIMIT: 0, // Maximum number of connection requests to queue (0 = unlimited)

    // Cache configuration
    CACHE_TTL: 5 * 60 * 1000, // User tenants cache time-to-live: 5 minutes (in milliseconds)
  },

  // ============================================
  // RATE LIMITING CONFIGURATION
  // ============================================
  RATE_LIMIT: {
    // Authentication endpoint rate limiting
    AUTH_WINDOW_MS: 15 * 60 * 1000,                               // 15 minutes
    AUTH_MAX_REQUESTS: parseInt(process.env.AUTH_RATE_LIMIT, 10) || 30, // override via AUTH_RATE_LIMIT env var
    // AUTH_MESSAGE is in messages.js - see messages.ERROR.RATE_LIMIT_EXCEEDED

    // Standard headers: Include rate limit info in response headers
    STANDARD_HEADERS: true,
    // Legacy headers: Disable X-RateLimit-* headers (use RateLimit-* instead)
    LEGACY_HEADERS: false,
  },

  // ============================================
  // JWT & TOKEN CONFIGURATION
  // ============================================
  JWT: {
    // Token expiration time
    EXPIRATION: '1h', // JWT token validity: 1 hour
    GUEST_EXPIRATION: '15m', // Guest (pending/rejected) tokens expire faster
    // NOTE: JWT_SECRET should come from environment variable (process.env.JWT_SECRET)
  },

  // ============================================
  // AUDIT LOGGING CONFIGURATION
  // ============================================
  AUDIT: {
    // Default pagination limits for audit logs
    DEFAULT_LIMIT: 100, // Default number of records to return per query
    DEFAULT_OFFSET: 0, // Default starting position for pagination

    // Default IP address when actual IP cannot be determined
    DEFAULT_IP: '0.0.0.0',
  },

  // ============================================
  // HTTP & SERVER CONFIGURATION
  // ============================================
  SERVER: {
    // Default port if not set in environment
    DEFAULT_PORT: 5000, // Server will listen on this port if PORT env var not set

    // JSON request body size limit
    JSON_LIMIT: '10mb', // Maximum size for JSON payloads

    // CORS configuration
    CORS_ORIGIN: '*', // Allow all origins (should be restricted in production)
  },

  // ============================================
  // LOGGING CONFIGURATION
  // ============================================
  LOGGING: {
    // Default log level
    DEFAULT_LEVEL: 'info', // Log levels: error, warn, info, http, debug, verbose, silly
    // Can be overridden with LOG_LEVEL environment variable
  },

  // ============================================
  // VALIDATION CONFIGURATION
  // ============================================
  VALIDATION: {
    // Joi schema validation settings
    ABORT_EARLY: true, // Stop validation at first error
    STRIP_UNKNOWN: false, // Keep unknown fields in validated object
  },

  // ============================================
  // IP ADDRESS DETECTION
  // ============================================
  IP_DETECTION: {
    // Headers to check for client IP (in order of priority)
    IP_HEADERS: [
      'x-forwarded-for', // Proxy/load-balancer header
      'x-real-ip', // Nginx header
      'cf-connecting-ip', // Cloudflare header
    ],
  },

  // ============================================
  // FEATURE FLAGS
  // ============================================
  FEATURES: {
    // Enable/disable specific features
    ENABLE_AUDIT_LOGGING: true, // Log all user actions
    ENABLE_CACHE: true, // Cache user tenants data
    STRICT_SCOPE_CHECK: true, // Enforce scope validation
  },
}
