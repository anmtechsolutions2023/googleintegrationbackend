// src/__tests__/utils/phone.test.js
// Every spelling of one number must become one string.
//
// The mobile number is the identity key. If two ways of writing the same number
// normalise differently they become two accounts, with two sets of roles and
// two audit trails, and the failure is invisible until somebody's permissions
// look wrong. That property is what this file is really testing; the individual
// format cases are just how it is demonstrated.

const { toE164, isE164, formatForDisplay, maskForLog } = require('../../utils/phone');

describe('toE164 — Indian national formats', () => {
  // Every one of these is the same human.
  const sameNumber = [
    '9876543210',
    '09876543210',
    '919876543210',
    '+919876543210',
    '+91 98765 43210',
    '+91-98765-43210',
    '+91 (98765) 43210',
    '0091 9876543210',
    '  +919876543210  ',
    '98765.43210',
  ];

  it.each(sameNumber)('normalises %p to +919876543210', (input) => {
    expect(toE164(input)).toBe('+919876543210');
  });

  it('collapses every spelling to exactly one canonical value', () => {
    const distinct = new Set(sameNumber.map((n) => toE164(n)));
    expect(distinct.size).toBe(1);
  });
});

describe('toE164 — what it refuses', () => {
  it.each([
    ['too short', '12345'],
    ['starts with 5 — not an Indian mobile', '+91 5876543210'],
    ['starts with 0 after the country code', '+910876543210'],
    ['eleven digits, no trunk prefix', '98765432101'],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['plus in the middle', '9876+543210'],
    ['double plus', '++919876543210'],
    ['trailing plus', '9876543210+'],
  ])('rejects %s', (_label, input) => {
    expect(toE164(input)).toBeNull();
  });

  // Letters are a typo, not formatting. Silently stripping 'a' out of
  // '4321a0' would mint an identity the user never typed.
  it.each(['98765 4321a0', 'tel:9876543210', '9876543210 (mobile)', 'O9876543210'])(
    'rejects %p rather than cleaning a letter away',
    (input) => {
      expect(toE164(input)).toBeNull();
    },
  );
});

describe('toE164 — the 91 ambiguity', () => {
  // '9198765432' is a valid 10-digit subscriber number that happens to open 91.
  // It must NOT be read as a country code, or a real user loses their identity.
  it('treats a ten-digit number starting 91 as national', () => {
    expect(toE164('9198765432')).toBe('+919198765432');
  });

  it('treats twelve digits starting 91 as a country code', () => {
    expect(toE164('919876543210')).toBe('+919876543210');
  });
});

describe('toE164 — outside India', () => {
  // No numbering plan on hand, so explicit E.164 is accepted as given rather
  // than rejected. Refusing a valid foreign number is worse than accepting one
  // we cannot fully check.
  it('passes through an explicit foreign E.164 number', () => {
    expect(toE164('+14155552671')).toBe('+14155552671');
  });

  it('does not apply Indian national rules to a foreign default', () => {
    expect(toE164('9876543210', 'US')).toBeNull();
    expect(toE164('+14155552671', 'US')).toBe('+14155552671');
  });
});

describe('isE164', () => {
  it('accepts canonical values', () => {
    expect(isE164('+919876543210')).toBe(true);
  });

  it.each([['9876543210'], [''], [null], [undefined], [919876543210]])(
    'rejects %p',
    (value) => {
      expect(isE164(value)).toBe(false);
    },
  );
});

describe('formatForDisplay', () => {
  it('groups an Indian number', () => {
    expect(formatForDisplay('+919876543210')).toBe('+91 98765 43210');
  });

  it('leaves a foreign number ungrouped rather than grouping it wrongly', () => {
    expect(formatForDisplay('+14155552671')).toBe('+14155552671');
  });

  it('returns non-canonical input unchanged', () => {
    expect(formatForDisplay('9876543210')).toBe('9876543210');
  });
});

describe('maskForLog', () => {
  it('hides the middle of the number', () => {
    expect(maskForLog('+919876543210')).toBe('+9198••••3210');
  });

  it('never returns anything resembling a full number for short input', () => {
    expect(maskForLog('123')).toBe('••••');
    expect(maskForLog(null)).toBe('••••');
  });

  it('leaves no more than eight digits of a real number visible', () => {
    const masked = maskForLog('+919876543210');
    expect(masked.replace(/\D/g, '')).toHaveLength(8);
  });
});
