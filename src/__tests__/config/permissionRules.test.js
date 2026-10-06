// src/__tests__/config/permissionRules.test.js
// A role can no longer be saved in a shape whose screens never appear.
//
// The frontend offers each screen on its READ scope, so "Manage" without
// "View" produced a role whose API calls worked and whose menu was empty.

const { requirementsOf, withRequirements, REQUIRES } = require('../../config/permissionRules');

describe('requirementsOf', () => {
  it('Manage needs View', () => {
    expect(requirementsOf('POS_ORDER:WRITE')).toEqual(['POS_ORDER:READ']);
  });

  it('View needs nothing', () => {
    expect(requirementsOf('POS_ORDER:READ')).toEqual([]);
  });

  it('approving an expense needs the screen expenses are listed on', () => {
    expect(requirementsOf('EXPENSE:APPROVE')).toEqual(['POS_OPS:READ']);
  });

  it('approving a refund needs the ledger', () => {
    expect(requirementsOf('REFUND:APPROVE')).toEqual(['TRANSACTIONS:READ']);
  });

  it('exporting customer data needs the customer screen', () => {
    expect(requirementsOf('CUSTOMER:EXPORT')).toEqual(['POS_CRM:READ']);
  });
});

describe('withRequirements', () => {
  const CATALOGUE = ['POS_ORDER:READ', 'POS_ORDER:WRITE', 'POS_OPS:READ', 'EXPENSE:APPROVE', 'TRANSACTIONS:READ'];

  it('adds what each choice needs, sorted', () => {
    expect(withRequirements(['POS_ORDER:WRITE', 'EXPENSE:APPROVE'], CATALOGUE))
      .toEqual(['EXPENSE:APPROVE', 'POS_OPS:READ', 'POS_ORDER:READ', 'POS_ORDER:WRITE']);
  });

  it('never adds a permission the catalogue does not have (or has switched off)', () => {
    expect(withRequirements(['ASSET:WRITE'], CATALOGUE)).toEqual(['ASSET:WRITE']);
  });

  it('leaves a set that already holds its requirements unchanged', () => {
    expect(withRequirements(['POS_ORDER:READ', 'POS_ORDER:WRITE'], new Set(CATALOGUE)))
      .toEqual(['POS_ORDER:READ', 'POS_ORDER:WRITE']);
  });

  it('every extra requirement names a key of the form FEATURE:SCOPE', () => {
    for (const [key, needs] of Object.entries(REQUIRES)) {
      expect(key).toMatch(/^[A-Z_]+:(READ|WRITE|APPROVE|EXPORT)$/);
      needs.forEach((n) => expect(n).toMatch(/^[A-Z_]+:(READ|WRITE|APPROVE|EXPORT)$/));
    }
  });
});
