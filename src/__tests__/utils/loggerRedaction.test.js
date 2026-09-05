// src/__tests__/utils/loggerRedaction.test.js
// A phone number must never reach a log in full.
//
// The number is the identity now, and ~250 call sites pass it into log objects
// the way they used to pass an email address. An email in a log is untidy; a
// number is personal data sitting in plaintext in whatever aggregator the logs
// land in.
//
// This runs in the winston format pipeline rather than at each call site, so a
// logger.info added next month is covered without anyone remembering a rule.
// That is the property worth testing.

const { maskNumbers } = require('../../utils/logger');

describe('maskNumbers', () => {
  it('masks a number passed as a field', () => {
    const out = maskNumbers({ phone: '+919876543210' });
    expect(out.phone).not.toContain('+919876543210');
    expect(out.phone).toBe('+9198••••3210');
  });

  it('masks a number embedded in a message string', () => {
    expect(maskNumbers('call +919876543210 back')).toBe('call +9198••••3210 back');
  });

  it('masks every number in one string', () => {
    const out = maskNumbers('+919876543210 and +919000011122');
    expect(out).not.toMatch(/\+\d{8,15}(?!•)/);
  });

  it('reaches numbers nested in objects and arrays', () => {
    const out = maskNumbers({ a: { b: ['+919876543210'] } });
    expect(JSON.stringify(out)).not.toContain('+919876543210');
  });

  it('leaves everything else untouched', () => {
    const out = maskNumbers({ tenantId: 'tenant-a', count: 3, flag: true, nothing: null });
    expect(out).toEqual({ tenantId: 'tenant-a', count: 3, flag: true, nothing: null });
  });

  it('does not mangle a short number that is not an identity', () => {
    expect(maskNumbers('order +12')).toBe('order +12');
  });

  it('stops rather than recursing forever on a cyclic object', () => {
    const cyclic = { phone: '+919876543210' };
    cyclic.self = cyclic;
    expect(() => maskNumbers(cyclic)).not.toThrow();
  });
});
