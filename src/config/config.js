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
    // How many of those may sit IDLE, and for how long.
    //
    // MAX_IDLE is not a nicety, it is what makes IDLE_TIMEOUT_MS run at all.
    // mysql2 starts its idle sweeper only when maxIdle < connectionLimit, and
    // maxIdle DEFAULTS TO connectionLimit (mysql2/lib/base/pool.js, and
    // lib/pool_config.js) — so leaving it unset does not mean "keep four idle",
    // it means the sweeper is never scheduled and idleTimeout is never
    // consulted. Every connection the pool opened stayed open for the life of
    // the process.
    //
    // On a long-lived server that is only wasteful. On Vercel it is the outage:
    // instances are kept warm and new ones are added on each concurrency spike,
    // so every instance that had served a burst sat on up to CONNECTION_LIMIT
    // connections it would never use again. The total at the server only ever
    // went up, until MySQL itself began refusing new ones with
    // ER_CON_COUNT_ERROR — a 1040 from the server, not pool exhaustion here,
    // which is why it surfaced as an unhandled 500 rather than DB_BUSY.
    //
    // At 1, a burst still opens up to CONNECTION_LIMIT and is trimmed back to a
    // single warm connection within a second of the burst ending. The steady
    // state per instance is therefore MAX_IDLE, not CONNECTION_LIMIT — that is
    // the number to multiply by warm instances when checking it against
    // max_connections.
    MAX_IDLE: 1,
    // Long enough that someone clicking between screens keeps reusing the same
    // connection — a new one costs a TCP and TLS handshake to a managed host —
    // and short enough that an instance the platform has finished with hands
    // its last connection back instead of parking it until the process dies.
    // The sweeper ticks once a second, so this value is the resolution that
    // matters rather than the poll interval.
    IDLE_TIMEOUT_MS: 30000,
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
  // Kept as a delegating alias. Every value now lives in config/rateLimits.js
  // so there is one place to tune throttles; this exists only so a consumer
  // written against the old shape does not silently read undefined.
  get RATE_LIMIT() {
    const rl = require('./rateLimits');
    return {
      AUTH_WINDOW_MS: rl.HTTP.WINDOW_MS,
      AUTH_MAX_REQUESTS: rl.HTTP.MAX_REQUESTS,
      STANDARD_HEADERS: rl.HTTP.STANDARD_HEADERS,
      LEGACY_HEADERS: rl.HTTP.LEGACY_HEADERS,
    };
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
  // WHATSAPP CLOUD API CONFIGURATION
  // ============================================
  // Every value is environment-supplied. SECRETS DELIBERATELY HAVE NO DEFAULT:
  // a missing one must stop the server at boot with a clear message, not start
  // successfully and fail on the first person signing in during a dinner rush.
  // With Google sign-in retired there is no second way in, so a misconfigured
  // deploy is a total outage rather than a degraded one.
  //
  // Only src/modules/whatsapp/whatsapp.client.js reads ACCESS_TOKEN, and only
  // the webhook reads APP_SECRET — one place each can leak from.
  // See WHATSAPP_IDENTITY_MIGRATION.md §8.5.
  WHATSAPP: {
    // Pinned, not floating: Meta deprecates Graph versions on a published
    // clock, and a silent bump changes payload shapes under us.
    GRAPH_VERSION: process.env.WA_GRAPH_VERSION || 'v21.0',
    GRAPH_BASE_URL: 'https://graph.facebook.com',

    PHONE_NUMBER_ID: process.env.WA_PHONE_NUMBER_ID,
    BUSINESS_ACCOUNT_ID: process.env.WA_BUSINESS_ACCOUNT_ID,

    ACCESS_TOKEN: process.env.WA_ACCESS_TOKEN,           // secret
    APP_SECRET: process.env.WA_APP_SECRET,               // secret
    WEBHOOK_VERIFY_TOKEN: process.env.WA_WEBHOOK_VERIFY_TOKEN,

    // Must match the approved template EXACTLY. 'en' is not 'en_US', and the
    // mismatch surfaces as Meta error 132001 rather than anything readable.
    TEMPLATE_OTP_NAME: process.env.WA_TEMPLATE_OTP_NAME || 'login_otp',
    TEMPLATE_OTP_LANG: process.env.WA_TEMPLATE_OTP_LANG || 'en_US',

    SEND_TIMEOUT_MS: parseInt(process.env.WA_SEND_TIMEOUT_MS, 10) || 10000,
  },

  // ============================================
  // OTP CONFIGURATION
  // ============================================
  // Only the secret. Every OTP THROTTLE — window, per-number, per-IP, cooldown,
  // attempts, TTL and the daily cost cap — lives in config/rateLimits.js.
  OTP: {
    // No default on purpose: a shared default would mean every deployment that
    // forgot to set it uses one secret.
    PEPPER: process.env.OTP_PEPPER,
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
