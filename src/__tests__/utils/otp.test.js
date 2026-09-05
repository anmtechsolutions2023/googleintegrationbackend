// src/__tests__/utils/otp.test.js
// The code must be unguessable, unreadable from the database, and unleakable
// through timing.
//
// These three properties are the whole security value of the OTP flow. The
// service layer adds single-use, expiry and attempt limits on top, but if any
// of the properties below fail then none of that matters.

const crypto = require('crypto');
const { generateCode, hashCode, verifyCode, expiryFrom, CODE_DIGITS } = require('../../utils/otp');

const PEPPER = 'test-pepper-value';

describe('generateCode', () => {
  it('returns exactly six digits', () => {
    expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('returns a string, so a leading zero survives', () => {
    // Number('012345') would silently become 12345 and the user's code would
    // no longer match what they were sent.
    expect(typeof generateCode()).toBe('string');
    expect(generateCode()).toHaveLength(CODE_DIGITS);
  });

  it('draws from crypto, never Math.random', () => {
    // Math.random is a per-process PRNG: observing a few outputs narrows the
    // next one. For a value that grants a session that is disqualifying.
    const spy = jest.spyOn(crypto, 'randomInt');
    const mathSpy = jest.spyOn(Math, 'random');
    generateCode();
    expect(spy).toHaveBeenCalled();
    expect(mathSpy).not.toHaveBeenCalled();
    spy.mockRestore();
    mathSpy.mockRestore();
  });

  it('spreads across the keyspace', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i += 1) seen.add(generateCode());
    // 5000 draws from 900,000 collide a little; anything clustered would show
    // up here as a dramatically smaller set.
    expect(seen.size).toBeGreaterThan(4900);
  });

  it('never produces a value outside the six-digit range', () => {
    for (let i = 0; i < 2000; i += 1) {
      const n = Number(generateCode());
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThan(1000000);
    }
  });
});

describe('hashCode', () => {
  it('produces 64 hex characters', () => {
    expect(hashCode('483920', PEPPER)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never contains the code itself', () => {
    expect(hashCode('483920', PEPPER)).not.toContain('483920');
  });

  it('is deterministic for the same code and pepper', () => {
    expect(hashCode('483920', PEPPER)).toBe(hashCode('483920', PEPPER));
  });

  it('differs when the pepper differs', () => {
    // This is the property that makes a database dump insufficient: the same
    // code under a different pepper is a different hash, and the pepper is not
    // in the database.
    expect(hashCode('483920', PEPPER)).not.toBe(hashCode('483920', 'other'));
  });

  it('refuses to hash without a pepper', () => {
    expect(() => hashCode('483920', '')).toThrow(/pepper/i);
    expect(() => hashCode('483920', undefined)).toThrow(/pepper/i);
  });
});

describe('verifyCode', () => {
  const CODE = '483920';
  const HASH = hashCode(CODE, PEPPER);

  it('accepts the right code', () => {
    expect(verifyCode(CODE, HASH, PEPPER)).toBe(true);
  });

  it('rejects a wrong code', () => {
    expect(verifyCode('000000', HASH, PEPPER)).toBe(false);
  });

  it('rejects a code that is right under a different pepper', () => {
    expect(verifyCode(CODE, HASH, 'wrong-pepper')).toBe(false);
  });

  it('compares in constant time', () => {
    const spy = jest.spyOn(crypto, 'timingSafeEqual');
    verifyCode(CODE, HASH, PEPPER);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns false rather than throwing on a malformed stored hash', () => {
    // timingSafeEqual throws on length mismatch. A corrupt row must fail the
    // login, not crash the request.
    expect(verifyCode(CODE, 'short', PEPPER)).toBe(false);
    expect(verifyCode(CODE, null, PEPPER)).toBe(false);
    expect(verifyCode(CODE, undefined, PEPPER)).toBe(false);
  });

  it('returns false rather than throwing when the pepper is missing', () => {
    expect(verifyCode(CODE, HASH, '')).toBe(false);
  });

  it.each([[null], [undefined], [''], [123456], [{}]])(
    'handles submitted value %p without throwing',
    (submitted) => {
      expect(() => verifyCode(submitted, HASH, PEPPER)).not.toThrow();
    },
  );

  it('matches a numeric submission of the right code', () => {
    // Some clients will send the code as a number; String() coercion in the
    // helper is what makes that safe.
    expect(verifyCode(Number(CODE), HASH, PEPPER)).toBe(true);
  });
});

describe('expiryFrom', () => {
  it('adds the TTL to the given instant', () => {
    const now = new Date('2026-09-05T10:00:00.000Z');
    expect(expiryFrom(300, now).toISOString()).toBe('2026-09-05T10:05:00.000Z');
  });

  it('does not mutate the instant it was given', () => {
    const now = new Date('2026-09-05T10:00:00.000Z');
    expiryFrom(300, now);
    expect(now.toISOString()).toBe('2026-09-05T10:00:00.000Z');
  });
});
