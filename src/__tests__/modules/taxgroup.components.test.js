// src/__tests__/modules/taxgroup.components.test.js
//
// A tax type is its NAME AND ITS RATE together.
//
// Every case here exists because the alternative — resolving on the name alone
// — failed silently and in the expensive direction: a restaurant running 5% food
// and 18% packaged goods had its 18% items billed at 5%, on every bill, with no
// error raised anywhere and nothing on any screen to say so.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

jest.mock('../../modules/taxtype/taxtype.service', () => ({
  createTx: jest.fn(async (_c, d) => ({ id: `type-${d.Name}-${d.Value}`, ...d })),
}));
jest.mock('../../modules/taxgrouptaxtypemapper/taxgrouptaxtypemapper.service', () => ({
  createTx: jest.fn(async (_c, d) => ({ id: 'map-id', ...d })),
}));

const components = require('../../modules/taxgroup/taxgroup.components');
const taxType = require('../../modules/taxtype/taxtype.service');
const taxMapper = require('../../modules/taxgrouptaxtypemapper/taxgrouptaxtypemapper.service');

const TENANT = 'tenant-1';
const USER = 'admin@test.com';

// A connection whose lookups answer from a table the test controls.
// `existingTypes` is keyed name|value, exactly as the unique key is.
const conn = (over = {}) => {
  const existingTypes = over.existingTypes || {};
  const existingMappings = over.existingMappings || [];
  return {
    execute: jest.fn(async (sql, params) => {
      const q = String(sql);
      if (/FROM TaxTypes WHERE Name = \? AND Value = \?/i.test(q)) {
        const hit = existingTypes[`${params[0]}|${params[1]}`];
        return [hit ? [{ Id: hit }] : []];
      }
      if (/FROM taxgrouptaxtypemapper WHERE TaxGroupId = \? AND TaxTypeId = \?/i.test(q)) {
        return [existingMappings.includes(params[1]) ? [{ Id: 'm' }] : []];
      }
      if (/SELECT tt\.Name, tt\.Value/i.test(q)) return [over.groupComponents || []];
      return [[]];
    }),
  };
};

const attach = (c, rates) => components.attachComponentsTx(c, {
  taxGroupId: 'group-1', components: rates, tenantId: TENANT, userPhone: USER,
});

beforeEach(() => jest.clearAllMocks());

describe('a tax type is its name AND its rate', () => {
  // THE bug. CGST standing at 2.5 must not answer for a group asking for 9.
  it('does not reuse a same-named type standing at a different rate', async () => {
    const c = conn({ existingTypes: { 'CGST|2.5': 'cgst-2point5' } });

    await attach(c, [{ name: 'CGST', value: 9 }]);

    expect(taxType.createTx).toHaveBeenCalledWith(
      c, expect.objectContaining({ Name: 'CGST', Value: '9' }), TENANT, USER,
    );
    // The 2.5 row was NOT the one mapped in.
    expect(taxMapper.createTx).toHaveBeenCalledWith(
      c, expect.objectContaining({ TaxTypeId: 'type-CGST-9' }), TENANT, USER,
    );
  });

  it('does reuse the type when the name AND the rate both match', async () => {
    const c = conn({ existingTypes: { 'CGST|2.5': 'cgst-2point5' } });

    const out = await attach(c, [{ name: 'CGST', value: 2.5 }]);

    expect(taxType.createTx).not.toHaveBeenCalled();
    expect(out.taxTypes).toBe(0);
    expect(taxMapper.createTx).toHaveBeenCalledWith(
      c, expect.objectContaining({ TaxTypeId: 'cgst-2point5' }), TENANT, USER,
    );
  });

  // '9' and 9 and 9.0 are one rate. Left unnormalised, the unique key happily
  // admits three rows that all mean the same thing.
  it.each([[9], ['9'], ['9.0'], [' 9 ']])('treats %p as the same rate', async (value) => {
    const c = conn({ existingTypes: { 'CGST|9': 'cgst-nine' } });
    await attach(c, [{ name: 'CGST', value }]);
    expect(taxType.createTx).not.toHaveBeenCalled();
  });

  it('trims the name rather than creating a second type for " CGST "', async () => {
    const c = conn({ existingTypes: { 'CGST|9': 'cgst-nine' } });
    await attach(c, [{ name: ' CGST ', value: 9 }]);
    expect(taxType.createTx).not.toHaveBeenCalled();
  });
});

describe('attaching rates to a group', () => {
  it('maps every component in, and reports what it created', async () => {
    const c = conn();
    const out = await attach(c, [{ name: 'CGST', value: 9 }, { name: 'SGST', value: 9 }]);

    expect(taxMapper.createTx).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ taxTypes: 2, mappings: 2 });
  });

  // Re-running the same file must be a no-op, not a unique-key failure that
  // reports the row as failed.
  it('skips a mapping that already exists', async () => {
    const c = conn({
      existingTypes: { 'CGST|9': 'cgst-nine' },
      existingMappings: ['cgst-nine'],
    });

    const out = await attach(c, [{ name: 'CGST', value: 9 }]);

    expect(taxMapper.createTx).not.toHaveBeenCalled();
    expect(out).toEqual({ taxTypes: 0, mappings: 0 });
  });

  it('does nothing at all for an empty or missing list', async () => {
    const c = conn();
    await expect(attach(c, [])).resolves.toEqual({ taxTypes: 0, mappings: 0 });
    await expect(attach(c, undefined)).resolves.toEqual({ taxTypes: 0, mappings: 0 });
    expect(taxType.createTx).not.toHaveBeenCalled();
  });

  // A 56-row file naming CGST on every row must resolve it once.
  it('resolves a repeated component once when given a cache', async () => {
    const c = conn();
    const cache = new Map();
    const args = {
      taxGroupId: 'group-1', components: [{ name: 'CGST', value: 9 }],
      tenantId: TENANT, userPhone: USER, cache,
    };

    await components.attachComponentsTx(c, args);
    await components.attachComponentsTx(c, { ...args, taxGroupId: 'group-2' });

    expect(taxType.createTx).toHaveBeenCalledTimes(1);
    // Both groups still got their mapping.
    expect(taxMapper.createTx).toHaveBeenCalledTimes(2);
  });
});

describe('the default split', () => {
  // A menu priced at 0% is the worse failure. Stated here so both callers —
  // the wizard and the bulk import — inherit one answer.
  it('is the standard intra-state 2.5 + 2.5', () => {
    expect(components.defaultComponents()).toEqual([
      { name: 'CGST', value: '2.5' },
      { name: 'SGST', value: '2.5' },
    ]);
  });
});

describe('comparing two sets of rates', () => {
  // Order is not a difference: a file spelling CGST first on one row and SGST
  // first on another is not asking for two different things.
  it('ignores order', () => {
    const a = components.signature([{ name: 'CGST', value: 2.5 }, { name: 'SGST', value: 2.5 }]);
    const b = components.signature([{ name: 'SGST', value: '2.5' }, { name: 'CGST', value: 2.5 }]);
    expect(a).toBe(b);
  });

  it('does not ignore the rate', () => {
    const five = components.signature([{ name: 'CGST', value: 2.5 }]);
    const eighteen = components.signature([{ name: 'CGST', value: 9 }]);
    expect(five).not.toBe(eighteen);
  });
});

describe('reading a group back', () => {
  it('returns the rates currently mapped in', async () => {
    const c = conn({ groupComponents: [{ Name: 'CGST', Value: '9' }, { Name: 'SGST', Value: '9' }] });
    await expect(components.readComponentsTx(c, 'group-1', TENANT)).resolves.toEqual([
      { name: 'CGST', value: '9' }, { name: 'SGST', value: '9' },
    ]);
  });

  it('returns an empty list for a group with no rates — the 0% case', async () => {
    const c = conn({ groupComponents: [] });
    await expect(components.readComponentsTx(c, 'group-1', TENANT)).resolves.toEqual([]);
  });
});
