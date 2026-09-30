// src/modules/posdine/dine.auth.service.js
// A guest proving their number at a table — the same WhatsApp OTP as staff
// sign-in, spent for a different thing.
//
// otp.service does the cryptography and the spend-once; the DINER policy in
// otp.policies decides the limits. This file only composes the three steps a
// verify is made of: prove the number, recognise the customer, open a session
// bound to this one table.

const otpService = require('../auth/otp.service');
const contextService = require('./dine.context.service');
const customerService = require('./dine.customer.service');
const session = require('./dine.session');

/**
 * Sends a code for this table.
 * @param {string} token - The scanned QR token.
 * @param {string} phone - As typed; normalised by otp.service.
 * @param {string|null} ip
 */
const requestCode = async (token, phone, ip) => {
  const ctx = await contextService.resolve(token);
  return otpService.requestOtp({
    phone,
    purpose: otpService.PURPOSE.DINER,
    ip,
    contextRef: ctx.qrId,
    tenantId: ctx.tenantId,
  });
};

/**
 * Spends the code and opens the diner's session.
 * @param {string} token
 * @param {{challengeId: string, code: string, name?: string}} body
 * @returns {Promise<{token: string, expiresInSeconds: number, customer: Object, venue: Object}>}
 */
const verifyCode = async (token, { challengeId, code, name }) => {
  const ctx = await contextService.resolve(token);
  const { phone } = await otpService.verifyOtp({
    challengeId,
    code,
    expectedPurposes: [otpService.PURPOSE.DINER],
    contextRef: ctx.qrId,
  });
  const customer = await customerService.findOrCreate({
    phone, name, tenantId: ctx.tenantId, branchId: ctx.branchId,
  });
  const issued = session.issue({
    phone,
    tenantId: ctx.tenantId,
    branchId: ctx.branchId,
    tableId: ctx.tableId,
    qrId: ctx.qrId,
    customerId: customer.id,
  });
  return {
    token: issued.token,
    expiresInSeconds: issued.expiresInSeconds,
    customer: { name: customer.name, isNew: customer.isNew },
    venue: contextService.toPublic(ctx),
  };
};

module.exports = { requestCode, verifyCode };
