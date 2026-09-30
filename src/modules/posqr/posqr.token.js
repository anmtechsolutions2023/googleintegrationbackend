// src/modules/posqr/posqr.token.js
// The value printed inside a table's QR code.
//
// Random, not derived: a token built from tenant/branch/table ids could be
// guessed by walking them, and could never be revoked without renaming the
// table. 128 bits from the CSPRNG, hex-encoded — 32 characters, which still
// fits a small QR code that scans from across a table.

const crypto = require('crypto');
const { QR_ORDERING } = require('../../config/constants');

const TOKEN_PATTERN = new RegExp(`^[0-9a-f]{${QR_ORDERING.TOKEN_BYTES * 2}}$`);

/** @returns {string} A fresh token. */
const generateToken = () => crypto.randomBytes(QR_ORDERING.TOKEN_BYTES).toString('hex');

/**
 * Shape check before any database read, so a malformed path segment costs
 * nothing. Deliberately NOT a timing-sensitive compare: the lookup is by
 * indexed equality and the answer for "wrong" and "malformed" is the same 404.
 * @param {string} token
 * @returns {boolean}
 */
const isWellFormed = (token) => typeof token === 'string' && TOKEN_PATTERN.test(token);

module.exports = { generateToken, isWellFormed, TOKEN_PATTERN };
