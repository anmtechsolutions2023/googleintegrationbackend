// src/config/rateLimits.js
// Every request throttle and spend ceiling in one place.
//
// They used to be spread across config.js, auth.routes.js and otp.service.js,
// with the counting window hardcoded in two of them. Tuning anything meant
// finding all the places first — which is how a limit ends up changed in one
// spot and not the other.
//
// ── The one distinction worth understanding ────────────────────────────────
// HTTP below is express-rate-limit: in memory, per instance, reset by every
// deploy, and skipped entirely in development. It is a guard on an endpoint.
//
// Everything under OTP_REQUEST and COST is counted in auth_otp_challenge — in
// the database. It survives restarts, holds across instances, and applies in
// every environment. That is what actually stands between an open endpoint and
// your Meta invoice, and it is why the two are not interchangeable.

/**
 * parseInt with a default, that respects an explicit 0.
 *
 * `parseInt(v, 10) || fallback` looks equivalent and is not: it returns the
 * fallback for "0", so a limit can never be set to zero. Someone disabling a
 * throttle would silently get the default instead.
 */
const num = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (value, fallback) =>
  value === undefined ? fallback : /^(1|true|yes)$/i.test(String(value));

module.exports = {
  // ── HTTP layer ───────────────────────────────────────────────────────────
  // Coarse per-IP guard on the auth routes. NOT the spend control.
  HTTP: {
    WINDOW_MS: num(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    MAX_REQUESTS: num(process.env.AUTH_RATE_LIMIT, 30),
    // All local requests share one loopback IP, which exhausts the window
    // while testing multi-user flows. Configurable rather than hardcoded so a
    // staging box can behave like production.
    SKIP_IN_DEVELOPMENT: bool(process.env.AUTH_RATE_LIMIT_SKIP_DEV, true),
    STANDARD_HEADERS: true,
    LEGACY_HEADERS: false,
  },

  // ── Asking for a code ────────────────────────────────────────────────────
  // Counted in the database. MAX_PER_PHONE and the cooldown count only
  // messages actually SENT: a request for an unregistered number sends
  // nothing, floods no handset and costs nothing, so charging it against the
  // number's budget would lock it out at the moment it became valid.
  // MAX_PER_IP counts every request, which is what bounds that path.
  OTP_REQUEST: {
    WINDOW_SECONDS: num(process.env.OTP_WINDOW_SECONDS, 15 * 60),
    MAX_PER_PHONE: num(process.env.OTP_MAX_PER_PHONE, 3),
    MAX_PER_IP: num(process.env.OTP_MAX_PER_IP, 10),
    RESEND_COOLDOWN_SECONDS: num(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
  },

  // ── Spending a code ──────────────────────────────────────────────────────
  OTP_VERIFY: {
    MAX_ATTEMPTS: num(process.env.OTP_MAX_ATTEMPTS, 5),
    // Keep in step with the expiry line printed inside the WhatsApp template,
    // or the message tells the user something untrue.
    TTL_SECONDS: num(process.env.OTP_TTL_SECONDS, 300),
  },

  // ── Money ────────────────────────────────────────────────────────────────
  COST: {
    // The circuit breaker. Applies in EVERY environment, unlike HTTP above: a
    // runaway local test sends real messages and spends real money. When it
    // trips, sign-in stops platform-wide and logs at ERROR.
    DAILY_SEND_CAP: num(process.env.OTP_DAILY_SEND_CAP, 500),
  },
};

// Not here, deliberately — these are concurrency and pagination bounds, not
// request throttles:
//   DATABASE.CONNECTION_LIMIT / QUEUE_LIMIT   config.js  (pool size)
//   AUDIT_MAX_LIMIT                           constants.js (page size)
//   WHATSAPP.SEND_TIMEOUT_MS                  config.js  (one request's patience)
