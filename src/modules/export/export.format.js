// src/modules/export/export.format.js
// How a value is written into an export. One set of rules for every file, so
// a date, an amount or a mobile reads the same whichever screen it came from.
//
// The rules, and why:
//   * DATES are ISO (2026-10-05). They sort as text and Excel reads them as
//     dates in any locale; 05/10/2026 is the 5th of October or the 10th of May
//     depending on whose laptop opens it.
//   * TIMESTAMPS are local wall-clock (2026-10-05 15:30). The pool hands back
//     DATETIMEs as UTC instants (config/db.js, timezone 'Z'); the business day
//     is local, so a stamp is read in the server's zone — the same clock
//     utils/dateRange builds every report's day from.
//   * MONEY is two decimals, no symbol, no grouping, minus for money going
//     back. Anything else stops being a number the moment Excel opens it.
//   * MOBILES are written "98450 12345". The space keeps Excel from turning
//     them into 9.85E+09, and there is no leading "+", which a spreadsheet
//     reads as the start of a formula.

const { toISODate } = require('../../utils/dateRange');
const { money } = require('../../utils/csv');

const pad = (n) => String(n).padStart(2, '0');

/**
 * A DATE column as YYYY-MM-DD. A DATE arrives as UTC midnight, so its UTC
 * calendar day IS the stored day — reading it locally would move it a day
 * back west of Greenwich.
 */
const date = (v) => {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** A DATETIME column as local "YYYY-MM-DD HH:MM". */
const dateTime = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const d = v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${toISODate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** A TIME column as HH:MM. */
const time = (v) => (v ? String(v).slice(0, 5) : '');

/** Money with a sign. */
const amount = (v, sign = 1) => money((Number(v) || 0) * sign);

/** A plain number without trailing zeros: 2, 2.5 — quantities and rates. */
const qty = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '';
};

/** A percentage with one decimal and no sign: 61.2. */
const percent = (part, whole) => (whole ? (Math.round((part / whole) * 1000) / 10).toFixed(1) : '0.0');

const yesNo = (v) => (v === null || v === undefined ? '' : (Number(v) ? 'Yes' : 'No'));

/**
 * The ten digits of an Indian mobile, or every digit of anything else. A
 * leading 91 / 0 is dropped only when what is left is exactly ten digits.
 */
const mobileDigits = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
};

/**
 * A mobile for a file: "98450 12345", or "98450 •••45" when masked.
 * Masking keeps the first five and last two — enough to tell two guests apart
 * on a list, not enough to call either of them.
 */
const mobile = (v, { mask = true } = {}) => {
  const d = mobileDigits(v);
  if (!d) return '';
  if (d.length !== 10) return mask ? `•••${d.slice(-2)}` : d;
  return mask ? `${d.slice(0, 5)} •••${d.slice(-2)}` : `${d.slice(0, 5)} ${d.slice(5)}`;
};

/** A value that is really a mobile number (sign-in fills names with one). */
const isPhoneLike = (v) => {
  const text = String(v || '').trim();
  return /^[+\d\s().-]+$/.test(text) && text.replace(/\D/g, '').length >= 7;
};

/**
 * Who did something, from the phone the row stores, as a NAME. Staff mobiles
 * never leave the server in an export: an unnamed member is "•••• 1234".
 *
 * @param {Map<string,{name:string}>} names - From writeoff.report memberNames.
 */
const staffName = (names, phone) => {
  if (!phone) return '';
  const hit = names.get(phone);
  if (hit) return hit.name;
  return isPhoneLike(phone) ? `•••• ${String(phone).replace(/\D/g, '').slice(-4)}` : String(phone);
};

/** Parses a JSON column whether the driver already did or not. */
const json = (v, fallback = []) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

/** "Large (+20)" / "Toppings: Olives (+30); Dips: Mint" from a line's snapshot. */
const choices = (list, { withGroup = false } = {}) => json(list)
  .map((c) => {
    const price = Number(c.price) ? ` (+${qty(c.price)})` : '';
    const group = withGroup && c.groupName ? `${c.groupName}: ` : '';
    return `${group}${c.name || ''}${price}`;
  })
  .filter((s) => s.trim())
  .join('; ');

/**
 * A document's tax footer split into the columns a GST register uses. Anything
 * that is not CGST, SGST or IGST is summed into Other, so the four always add
 * up to the document's TaxAmount.
 */
const taxSplit = (components) => {
  const out = { CGST: 0, SGST: 0, IGST: 0, Other: 0 };
  json(components).forEach((c) => {
    const name = String(c.name || '').toUpperCase();
    const key = ['CGST', 'SGST', 'IGST'].find((k) => name.startsWith(k)) || (name.startsWith('UTGST') ? 'SGST' : 'Other');
    out[key] += Number(c.amount) || 0;
  });
  return out;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "13:00–14:00" for an hour of the day. */
const hourBand = (h) => `${pad(h)}:00–${pad((Number(h) + 1) % 24)}:00`;

/** Lower-case, hyphenated, ASCII — for the file name. */
const slug = (v) => String(v || '').toLowerCase().normalize('NFKD')
  .replace(/[^\w\s-]/g, '').trim()
  .replace(/[\s_]+/g, '-')
  .replace(/-+/g, '-')
  .slice(0, 40) || 'branch';

module.exports = {
  date, dateTime, time, amount, qty, percent, yesNo,
  mobile, mobileDigits, isPhoneLike, staffName, json, choices, taxSplit,
  DAYS, hourBand, slug,
};
