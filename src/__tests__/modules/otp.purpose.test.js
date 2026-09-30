// One-time codes by PURPOSE: staff sign-in vs a diner at a QR table.
//
// Three properties this file holds the OTP layer to:
//   1. Diner codes are counted against their OWN daily breaker. When the staff
//      breaker trips, nobody can sign in to the POS — a busy dining room must
//      never be able to cause that.
//   2. A code is spendable only for the purpose (and table) it was issued for.
//   3. A WRONG guess is counted even though the request fails. withTransaction
//      rolls back on a throw, so a verify that bumped the counter and then threw
//      from inside the transaction silently undid the bump — and the
//      five-attempt ceiling never engaged.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: () => 'challenge-1' }));
jest.mock('../../config/config', () => ({ OTP: { PEPPER: 'test-pepper' } }));
jest.mock('../../modules/whatsapp/whatsapp.health', () => ({
  isConfigured: () => true, missingKeys: () => [],
}));
jest.mock('../../modules/whatsapp/whatsapp.client', () => ({
  sendOtp: jest.fn(async () => ({ ok: true, wamid: 'wamid-1' })),
  isInfrastructureFailure: () => false,
}));
jest.mock('../../modules/appconfig/appconfig.service', () => ({
  isAutoApproveEnabled: jest.fn(async () => false),
}));

let mockState;
let mockCommitted;
const mockMakeConn = (log) => ({
  execute: jest.fn(async (sql, params) => {
    const s = String(sql);
    log.push({ sql: s, params });
    if (/COUNT\(\*\) AS n/.test(s)) {
      if (/purpose IN \('LOGIN', 'SIGNUP'\)/.test(s)) return [[{ n: mockState.staffSentToday }]];
      if (/tenant_id = \? AND purpose = 'DINER'/.test(s)) return [[{ n: mockState.tenantSentToday }]];
      if (/purpose = 'DINER'/.test(s)) return [[{ n: mockState.dinerSentToday }]];
      if (/context_ref = \?/.test(s)) return [[{ n: mockState.perTable }]];
      return [[{ n: 0 }]];
    }
    if (/SELECT created_at FROM auth_otp_challenge/.test(s)) return [[]];
    if (/FROM user_tenants|tenant_invitations/i.test(s)) return [[]];
    if (/SELECT id, phone, purpose, code_hash/.test(s)) return [mockState.challenge ? [mockState.challenge] : []];
    if (/SET consumed_at = NOW\(\)\s+WHERE id = \?/.test(s)) return [{ affectedRows: 1 }];
    return [{ affectedRows: 1 }];
  }),
});

jest.mock('../../utils/dbHelper', () => ({
  withConnection: async (cb) => {
    const log = [];
    const result = await cb(mockMakeConn(log));
    mockCommitted.push(...log);
    return result;
  },
  // Faithful to the real helper: writes survive only if the callback resolves.
  withTransaction: async (cb) => {
    const log = [];
    const result = await cb(mockMakeConn(log));
    mockCommitted.push(...log);
    return result;
  },
}));

const otpService = require('../../modules/auth/otp.service');
const { hashCode } = require('../../utils/otp');
const MESSAGES = require('../../config/messages');
const RATE_LIMITS = require('../../config/rateLimits');

const wrote = (re) => mockCommitted.filter((e) => re.test(e.sql));

beforeEach(() => {
  jest.clearAllMocks();
  mockCommitted = [];
  mockState = {
    staffSentToday: 0,
    dinerSentToday: 0,
    tenantSentToday: 0,
    perTable: 0,
    challenge: null,
  };
});

describe('requestOtp — daily breakers are per purpose', () => {
  it('a diner is sent a code even when the STAFF breaker has tripped', async () => {
    mockState.staffSentToday = RATE_LIMITS.COST.DAILY_SEND_CAP + 10;
    const res = await otpService.requestOtp({
      phone: '9876543210', purpose: 'DINER', contextRef: 'qr-1', tenantId: 't-1',
    });
    expect(res.challengeId).toBe('challenge-1');
  });

  it('staff sign-in is unaffected when the DINER breaker has tripped', async () => {
    mockState.dinerSentToday = RATE_LIMITS.DINER.DAILY_SEND_CAP + 10;
    // An unknown number: recorded, not sent — but NOT refused by the diner cap.
    await expect(otpService.requestOtp({ phone: '9876543210', purpose: 'LOGIN' }))
      .resolves.toMatchObject({ challengeId: 'challenge-1' });
  });

  it('pauses diner codes at the platform diner cap with a guest-facing message', async () => {
    mockState.dinerSentToday = RATE_LIMITS.DINER.DAILY_SEND_CAP;
    await expect(otpService.requestOtp({
      phone: '9876543210', purpose: 'DINER', contextRef: 'qr-1', tenantId: 't-1',
    })).rejects.toMatchObject({ statusCode: 503, message: MESSAGES.ERROR.QR_DINER_CODES_PAUSED });
  });

  it('pauses diner codes at the per-restaurant cap', async () => {
    mockState.tenantSentToday = RATE_LIMITS.DINER.TENANT_DAILY_CAP;
    await expect(otpService.requestOtp({
      phone: '9876543210', purpose: 'DINER', contextRef: 'qr-1', tenantId: 't-1',
    })).rejects.toMatchObject({ statusCode: 503 });
  });

  it('refuses a table that has asked for too many codes', async () => {
    mockState.perTable = RATE_LIMITS.DINER.MAX_PER_TABLE;
    await expect(otpService.requestOtp({
      phone: '9876543210', purpose: 'DINER', contextRef: 'qr-1', tenantId: 't-1',
    })).rejects.toMatchObject({ statusCode: 429 });
  });

  it('records the table and restaurant on a diner challenge', async () => {
    await otpService.requestOtp({
      phone: '9876543210', purpose: 'DINER', contextRef: 'qr-1', tenantId: 't-1',
    });
    const insert = wrote(/INSERT INTO auth_otp_challenge/)[0];
    expect(insert.params).toEqual(expect.arrayContaining(['+919876543210', 'DINER', 'qr-1', 't-1']));
  });

  it('only consumes live codes of the SAME purpose', async () => {
    await otpService.requestOtp({
      phone: '9876543210', purpose: 'DINER', contextRef: 'qr-1', tenantId: 't-1',
    });
    const consume = wrote(/WHERE phone = \? AND purpose = \?/)[0];
    expect(consume.params).toEqual(['+919876543210', 'DINER']);
  });
});

describe('verifyOtp — purpose, table, and the attempt counter', () => {
  const live = (over = {}) => ({
    id: 'challenge-1',
    phone: '+919876543210',
    purpose: 'DINER',
    code_hash: hashCode('123456', 'test-pepper'),
    attempts: 0,
    context_ref: 'qr-1',
    tenant_id: 't-1',
    ...over,
  });

  it('refuses a DINER code on the staff path, as expired', async () => {
    mockState.challenge = live();
    await expect(otpService.verifyOtp({ challengeId: 'challenge-1', code: '123456' }))
      .rejects.toMatchObject({ statusCode: 410 });
  });

  it('refuses a code requested at a different table', async () => {
    mockState.challenge = live();
    await expect(otpService.verifyOtp({
      challengeId: 'challenge-1', code: '123456', expectedPurposes: ['DINER'], contextRef: 'qr-9',
    })).rejects.toMatchObject({ statusCode: 410 });
  });

  it('spends a right code once and returns the number and restaurant', async () => {
    mockState.challenge = live();
    await expect(otpService.verifyOtp({
      challengeId: 'challenge-1', code: '123456', expectedPurposes: ['DINER'], contextRef: 'qr-1',
    })).resolves.toEqual({ phone: '+919876543210', purpose: 'DINER', tenantId: 't-1' });
  });

  it('COMMITS the attempt bump for a wrong code, then refuses', async () => {
    mockState.challenge = live();
    await expect(otpService.verifyOtp({
      challengeId: 'challenge-1', code: '000000', expectedPurposes: ['DINER'], contextRef: 'qr-1',
    })).rejects.toMatchObject({ statusCode: 400, message: MESSAGES.ERROR.OTP_INVALID });
    expect(wrote(/attempts = attempts \+ 1/)).toHaveLength(1);
  });

  it('COMMITS the lock-out once attempts are exhausted', async () => {
    mockState.challenge = live({ attempts: RATE_LIMITS.OTP_VERIFY.MAX_ATTEMPTS });
    await expect(otpService.verifyOtp({
      challengeId: 'challenge-1', code: '123456', expectedPurposes: ['DINER'], contextRef: 'qr-1',
    })).rejects.toMatchObject({ statusCode: 429 });
    expect(wrote(/SET consumed_at = NOW\(\)\s+WHERE id = \?/)).toHaveLength(1);
  });

  it('still accepts staff codes on the staff path by default', async () => {
    mockState.challenge = live({ purpose: 'LOGIN', context_ref: null, tenant_id: null });
    await expect(otpService.verifyOtp({ challengeId: 'challenge-1', code: '123456' }))
      .resolves.toMatchObject({ purpose: 'LOGIN' });
  });
});
