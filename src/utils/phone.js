// src/utils/phone.js
// The one place a phone number is turned into its canonical form.
//
// This matters more than its size suggests. The mobile number IS the identity
// key (see WHATSAPP_IDENTITY_MIGRATION.md), and identity keys must compare
// exactly. If two spellings of the same number normalise differently they
// become two accounts, with two sets of roles and two audit trails, and nobody
// notices until somebody's permissions look wrong weeks later.
//
// So every boundary — login, invitation, onboarding, admin edit, import — calls
// toE164() before the value reaches a query. There is deliberately no second
// implementation anywhere.
//
// ── On the email helper this replaces ──────────────────────────────────────
// normalizeEmail() lower-cased, and that was the whole job: addresses are
// case-insensitive and otherwise compared as typed. Numbers are different in
// kind. '+91 98765-43210', '09876543210' and '919876543210' are the same
// human, and none of them is a case variation of another.

/**
 * Digits and a leading plus. Spaces, dashes, dots and brackets are formatting
 * and get stripped; LETTERS are not. A letter in a phone number is a typo, and
 * silently cleaning '4321a0' into a valid number would mint an identity the
 * user did not type. Strictness is cheap here and a wrong identity is not.
 */
const HAS_LETTER = /[A-Za-z]/;
const strip = (raw) => {
  const s = String(raw ?? '');
  if (HAS_LETTER.test(s)) return '';
  return s.replace(/[^\d+]/g, '');
};

/** Indian mobile numbers are 10 digits and begin 6-9. Landlines are not valid here. */
const IN_MOBILE = /^[6-9]\d{9}$/;

/** E.164 permits 8-15 digits after the plus. Used for numbers outside India. */
const E164_ANY = /^\+\d{8,15}$/;

/**
 * Canonicalises a phone number to E.164 (`+919876543210`).
 *
 * Indian national formats are understood and converted. A number already
 * carrying some other country code is accepted if it is shaped like E.164, but
 * is NOT validated against that country's numbering plan — we have no data for
 * that, and silently rejecting a valid foreign number is worse than accepting
 * one we cannot fully check.
 *
 * @param {string} raw - As typed, pasted or imported.
 * @param {string} [defaultCountry='IN'] - Country assumed for national formats.
 * @returns {string|null} E.164 with the leading '+', or null if unusable.
 */
const toE164 = (raw, defaultCountry = 'IN') => {
  let s = strip(raw);
  if (!s) return null;

  // A plus anywhere but the front is a typo, not a country code.
  if (s.indexOf('+') > 0) return null;

  if (defaultCountry !== 'IN') {
    // No numbering plan on hand for anything else: accept only explicit E.164.
    return E164_ANY.test(s) ? s : null;
  }

  if (s.startsWith('+')) {
    if (s.startsWith('+91')) {
      const national = s.slice(3);
      return IN_MOBILE.test(national) ? `+91${national}` : null;
    }
    return E164_ANY.test(s) ? s : null;
  }

  // 00 is the international prefix dialled from India; treat 0091 as +91.
  if (s.startsWith('0091')) s = s.slice(4);
  // A single leading 0 is the national trunk prefix: 09876543210.
  else if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  // 12 digits opening 91 is the country code without its plus. A bare 10-digit
  // number may legitimately START with 91 (919876543 is a valid subscriber
  // number), which is why this tests the length first and not the prefix alone.
  else if (s.length === 12 && s.startsWith('91')) s = s.slice(2);

  return IN_MOBILE.test(s) ? `+91${s}` : null;
};

/**
 * True when the value is already canonical.
 * Cheap guard for code paths that should never be normalising again.
 */
const isE164 = (value) => typeof value === 'string' && E164_ANY.test(value);

/**
 * Groups a number for display: '+919876543210' -> '+91 98765 43210'.
 * Indian numbers only; anything else is returned untouched rather than grouped
 * wrongly.
 */
const formatForDisplay = (e164) => {
  if (!isE164(e164)) return String(e164 ?? '');
  if (!e164.startsWith('+91') || e164.length !== 13) return e164;
  return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
};

/**
 * Masks a number for logs: '+919876543210' -> '+9198••••3210'.
 *
 * Application logs must never carry a full identity. See the logging rules in
 * WHATSAPP_IDENTITY_MIGRATION.md §9.6 — the Google path used to log the whole
 * email address at info level, and that habit must not follow the migration.
 */
const maskForLog = (e164) => {
  const s = String(e164 ?? '');
  if (s.length < 8) return '••••';
  return `${s.slice(0, 5)}••••${s.slice(-4)}`;
};

module.exports = { toE164, isE164, formatForDisplay, maskForLog };
