// filepath: src/config/config.js
// Centralized configuration for all hard-coded values
// This allows easy adjustment without changing source code

module.exports = {
  // ============================================
  // DATABASE CONFIGURATION
  // ============================================
  DATABASE: {
    // Connection pool settings
    // Per *instance*, not per deployment: every warm serverless instance holds
    // its own pool, so this multiplies by concurrency. Managed plans cap total
    // connections (Aiven's smaller MySQL plans in the low tens), and exhausting
    // that trades timeouts for "too many connections" — which is harder to read.
    //
    // Sized against the server's real ceiling, which is what this multiplies
    // into: Aiven reports max_connections = 46, and a few of those belong to the
    // provider's own monitoring rather than to us. At 4 per instance roughly ten
    // instances can be warm at once before the server is the thing that refuses,
    // which is far more headroom than this workload needs. Raise it only after
    // re-checking max_connections — the pool is per instance, so this number is
    // multiplied by however many Vercel has warm, never a total.
    //
    // A request must cost exactly ONE connection for this arithmetic to hold.
    // Helpers that take a second one while the caller holds the first deadlock
    // the pool once enough requests overlap, at any size: everyone holds one and
    // waits for another that nobody is left to release, and mysql2 has no
    // acquire timeout to break the tie. withConnection takes an existing
    // connection for exactly this reason — pass yours down rather than nesting.
    CONNECTION_LIMIT: 4, // Maximum number of connections in the pool
    // Bounded so an overloaded instance fails fast instead of queueing without
    // limit. Unlimited queueing turns a busy minute into requests that hang until
    // the caller times out, which reads as an outage; a refusal reads as load.
    QUEUE_LIMIT: 20, // Maximum number of connection requests to queue
    CONNECT_TIMEOUT_MS: 5000, // Give up on an unreachable host well before the platform does

    // Cache configuration
    CACHE_TTL: 5 * 60 * 1000, // User tenants cache time-to-live: 5 minutes (in milliseconds)
  },

  // ============================================
  // CORS CONFIGURATION
  // ============================================
  CORS: {
    // How long a browser may reuse one preflight result.
    //
    // Every login POST carries a JSON body, so it is not a "simple" request and
    // the browser insists on an OPTIONS preflight first. Unanswered, that
    // preflight is a second cold serverless invocation that the real request
    // then waits behind — measured at ~0.9s for the OPTIONS plus ~1.0s of the
    // POST sitting blocked, close to two seconds spent before the login request
    // is allowed to leave the browser.
    //
    // Caching the result removes that pair from every subsequent sign-in for
    // the life of the entry. 7200 is not arbitrary: Chromium clamps this header
    // to two hours, so a larger number buys nothing there while still being
    // honoured by browsers with a longer ceiling.
    PREFLIGHT_MAX_AGE_S: 7200,
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
