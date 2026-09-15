// src/utils/csv.js
// CSV writing for exports that leave the system — to an accountant, a tax portal,
// a spreadsheet.
//
// Two hazards shape this file:
//   * QUOTING. A dish called `Paneer, 2 pcs` must stay one cell. RFC 4180:
//     quote any field holding a comma, quote or line break; double inner quotes.
//   * FORMULA INJECTION. A spreadsheet executes a cell beginning with = + @ (and
//     some with -). A customer name typed as `=HYPERLINK(...)` would run on the
//     CA's machine. Such TEXT is prefixed with an apostrophe. Numbers are passed
//     as numbers and never touched, so -247.62 stays a negative amount.

const FORMULA_START = /^[=+@\t\r]|^-(?![\d.])/;

/**
 * One cell.
 * @param {*} value
 * @returns {string}
 */
const cell = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let s = String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * A whole file.
 *
 * @param {string[]} headers
 * @param {Array<Array<*>>} rows
 * @param {Object} [options]
 * @param {boolean} [options.bom=false] - Prefix a UTF-8 byte-order mark. Right
 *        for files a PERSON opens in Excel (it otherwise mangles ₹ and accented
 *        names); wrong for files a portal's import tool reads, which may treat
 *        the mark as part of the first header.
 * @returns {string}
 */
const toCsv = (headers, rows, { bom = false } = {}) => {
  const lines = [headers.map(cell).join(',')];
  (rows || []).forEach((r) => lines.push((r || []).map(cell).join(',')));
  return `${bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
};

/** Money as the portals expect it: two decimals, no grouping, no symbol. */
const money = (v) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);

module.exports = { cell, toCsv, money };
