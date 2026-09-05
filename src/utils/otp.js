// src/utils/otp.js
// Minting and checking one-time codes.
//
// Pure and dependency-free on purpose: no database, no network, no config
// lookup. Everything security-critical about the OTP flow lives in these three
// functions, so they can be tested exhaustively without a WhatsApp account or a
// running MySQL.
//
// ── Three rules this file exists to enforce ────────────────────────────────
//
//  1. Codes come from crypto.randomInt, never Math.random. Math.random is a
//     PRNG seeded per process; observing a handful of outputs narrows the next
//     one enormously. For a value that grants a session that is disqualifying.
//
//  2. The code is never stored. Only sha256(code + pepper) reaches the
//     database, with the pepper held in the environment. A dump of
//     auth_otp_challenge must not be enough to sign in as somebody.
//
//  3. Comparison is constant-time. A byte-by-byte compare that returns early
//     leaks how much of the code was right, which over enough attempts is a
//     practical oracle.
//
// See WHATSAPP_IDENTITY_MIGRATION.md §9.1.

const crypto = require('crypto');

/** Six digits: 1-in-a-million, against a five-attempt ceiling. */
const CODE_DIGITS = 6;
const CODE_MIN = 10 ** (CODE_DIGITS - 1);       // 100000
const CODE_MAX = 10 ** CODE_DIGITS;             // 1000000 (exclusive)

/**
 * A fresh one-time code.
 *
 * Returned as a string, and never re-parsed as a number anywhere: leading
 * zeros are significant to the person typing it in, and Number('012345') would
 * quietly discard one.
 *
 * @returns {string} Six digits.
 */
const generateCode = () =>
  String(crypto.randomInt(CODE_MIN, CODE_MAX));

/**
 * The only representation of a code that may be persisted.
 *
 * The pepper is a server-side secret, NOT a per-row salt. A salt would defend
 * against rainbow tables across rows; with a six-digit space that is beside the
 * point — the entire keyspace is a million entries and precomputable in
 * seconds. What actually helps is a secret the database does not contain, so an
 * attacker holding a dump still cannot derive the code.
 *
 * @param {string} code - The plaintext code.
 * @param {string} pepper - OTP_PEPPER from the environment.
 * @returns {string} Lowercase hex, 64 chars.
 */
const hashCode = (code, pepper) => {
  if (!pepper) throw new Error('OTP pepper is required');
  return crypto.createHash('sha256').update(`${code}${pepper}`).digest('hex');
};

/**
 * Constant-time check of a submitted code against a stored hash.
 *
 * Both operands are sha256 hex, so they are always 64 characters and
 * timingSafeEqual's equal-length requirement is satisfied by construction —
 * hashing first is what makes the comparison safe for user input of any shape.
 *
 * @param {string} submitted - What the user typed.
 * @param {string} storedHash - auth_otp_challenge.code_hash.
 * @param {string} pepper - OTP_PEPPER from the environment.
 * @returns {boolean}
 */
const verifyCode = (submitted, storedHash, pepper) => {
  if (typeof storedHash !== 'string' || storedHash.length !== 64) return false;

  let candidate;
  try {
    candidate = hashCode(String(submitted ?? ''), pepper);
  } catch {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(candidate, 'hex'),
    Buffer.from(storedHash, 'hex'),
  );
};

/**
 * When a challenge minted now should stop being accepted.
 * Kept here so the TTL and the code are produced by the same module.
 *
 * @param {number} ttlSeconds
 * @param {Date} [now=new Date()]
 * @returns {Date}
 */
const expiryFrom = (ttlSeconds, now = new Date()) =>
  new Date(now.getTime() + ttlSeconds * 1000);

module.exports = { generateCode, hashCode, verifyCode, expiryFrom, CODE_DIGITS };
