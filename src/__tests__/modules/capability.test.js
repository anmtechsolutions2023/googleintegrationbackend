// src/__tests__/modules/capability.test.js
//
// The promise this feature makes: a scope somebody holds is ALWAYS shown in
// words. Not most of them, and not the ones that happened to have a features
// row on the day it was written — every value in the SCOPES constant, plus
// anything added to it later, plus anything a token carries that the constant
// has never heard of.

const { SCOPES } = require('../../config/constants');
const {
  humanise, NAMES, SCREENS, RANKS, GROUPS,
} = require('../../modules/user/capability.catalogue');
const scopeScreens = require('../../config/scope-screens.json');

// The database layer is stubbed OUT here on purpose: this suite is about the
// guarantee holding when the catalogue gives nothing back, which is the worst
// case and the one no fixture would cover.
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (fn) => fn({ execute: async () => [[]] })),
}));

const { resolveForScopes } = require('../../modules/user/capability.service');

const everyCapability = (r) => r.groups.flatMap((g) => g.capabilities);
const looksRaw = (s) => /^[A-Za-z_]+:[A-Za-z_]*$/.test(s);

describe('every scope becomes readable text', () => {
  const all = Object.values(SCOPES);

  it('covers every value in the SCOPES constant', async () => {
    const r = await resolveForScopes(all);
    const shown = [...r.ranks.map((x) => x.label), ...everyCapability(r).map((c) => c.label)];
    expect(shown.length).toBeGreaterThan(0);
    shown.forEach((label) => {
      expect(label).toBeTruthy();
      // The failure this guards: a scope reaching a screen as POS_ORDER:WRITE.
      expect(looksRaw(label)).toBe(false);
    });
  });

  it('accounts for every scope it was given — none silently dropped', async () => {
    const r = await resolveForScopes(all);
    const accounted = new Set([
      ...r.ranks.map((x) => x.scope),
      ...everyCapability(r).flatMap((c) => c.scopes),
    ]);
    all.forEach((s) => expect(accounted.has(s)).toBe(true));
  });

  // The case that actually happens: somebody adds a scope and forgets the rest.
  it('names a scope nothing has ever heard of', async () => {
    const r = await resolveForScopes(['SOMETHING_NEW:WRITE']);
    const [cap] = everyCapability(r);
    expect(cap.label).toBe('Something new — Manage');
    expect(looksRaw(cap.label)).toBe(false);
    // Flagged, so the gap is visible rather than merely survivable.
    expect(cap.named).toBe(false);
  });

  it('puts an unrecognised scope in a group rather than hiding it', async () => {
    const r = await resolveForScopes(['SOMETHING_NEW:WRITE']);
    expect(everyCapability(r)).toHaveLength(1);
  });
});

describe('levels', () => {
  it('collapses READ and WRITE on one subject into a single full-access line', async () => {
    const r = await resolveForScopes(['POS_ORDER:READ', 'POS_ORDER:WRITE']);
    const caps = everyCapability(r);
    expect(caps).toHaveLength(1);
    expect(caps[0].levelLabel).toBe('Full access');
    expect(caps[0].scopes).toEqual(['POS_ORDER:READ', 'POS_ORDER:WRITE']);
  });

  it('says view only when that is all there is', async () => {
    const r = await resolveForScopes(['POS_REPORTS:READ']);
    expect(everyCapability(r)[0].levelLabel).toBe('View only');
  });

  it('keeps APPROVE distinct from manage — signing off is not editing', async () => {
    const r = await resolveForScopes([SCOPES.EXPENSE_APPROVE]);
    expect(everyCapability(r)[0].levelLabel).toBe('Approve');
  });

  it('never downgrades: WRITE arriving after READ still reads as full', async () => {
    const a = await resolveForScopes(['POS_ORDER:WRITE', 'POS_ORDER:READ']);
    const b = await resolveForScopes(['POS_ORDER:READ', 'POS_ORDER:WRITE']);
    expect(everyCapability(a)[0].level).toBe('full');
    expect(everyCapability(b)[0].level).toBe('full');
  });
});

describe('ranks are not capabilities', () => {
  it('separates admin from the list of things it can do', async () => {
    const r = await resolveForScopes([SCOPES.TENANT_ADMIN, 'POS_ORDER:READ']);
    expect(r.ranks.map((x) => x.scope)).toEqual([SCOPES.TENANT_ADMIN]);
    expect(everyCapability(r).map((c) => c.scopes[0])).toEqual(['POS_ORDER:READ']);
  });

  it('every rank carries a label and an explanation', () => {
    Object.entries(RANKS).forEach(([scope, v]) => {
      expect(v.label).toBeTruthy();
      expect(v.note).toBeTruthy();
      expect(looksRaw(v.label)).toBe(false);
    });
  });
});

describe('edge cases', () => {
  it('an empty token yields nothing rather than throwing', async () => {
    const r = await resolveForScopes([]);
    expect(r.groups).toEqual([]);
    expect(r.ranks).toEqual([]);
  });

  it('deduplicates a scope granted twice by two roles', async () => {
    const r = await resolveForScopes(['POS_ORDER:READ', 'POS_ORDER:READ']);
    expect(everyCapability(r)[0].scopes).toEqual(['POS_ORDER:READ']);
  });

  it('returns the raw strings too, for support', async () => {
    const r = await resolveForScopes(['POS_ORDER:READ', 'AUDIT:READ']);
    expect(r.scopes).toEqual(['AUDIT:READ', 'POS_ORDER:READ']);
  });
});

describe('humanise — the last resort', () => {
  it.each([
    ['POS_ORDER:WRITE', 'Pos order — Manage'],
    ['REPORTS:READ', 'Reports — View'],
    ['billing:WRITE', 'Billing — Manage'],
    ['EXPENSE:APPROVE', 'Expense — Approve'],
  ])('%s → %s', (scope, expected) => expect(humanise(scope)).toBe(expected));

  it('handles a scope with no action at all', () => {
    expect(humanise('WEIRD')).toBe('Weird');
  });

  // The corrupted row that started this: EXPENSE with a blank scope.
  it('handles a trailing colon with nothing after it', () => {
    expect(humanise('EXPENSE:')).toBe('Expense');
  });

  it('every NAMES entry is prose, not a code', () => {
    Object.values(NAMES).forEach((l) => expect(looksRaw(l)).toBe(false));
  });
});

// ── The generated binding ───────────────────────────────────────────────────
// scope-screens.json is derived from the frontend's navigation.js. The names
// beside it are written by hand, and this is what stops the two drifting: add a
// menu item under a new scope and the suite fails until it has a name.
describe('names and the generated screen binding stay in step', () => {
  const subjects = scopeScreens.subjects.map((s) => s.subject);

  it('every generated subject has a name', () => {
    const unnamed = subjects.filter((s) => !NAMES[s] && s !== 'admin');
    expect(unnamed).toEqual([]);
  });

  it('every named Front Desk subject appears in a group', () => {
    const grouped = new Set(GROUPS.flatMap((g) => g.members));
    subjects.filter((s) => s !== 'admin').forEach((s) => {
      expect(grouped.has(s)).toBe(true);
    });
  });

  it('no subject claims a screen twice', () => {
    scopeScreens.subjects.forEach((s) => {
      expect(new Set(s.screens).size).toBe(s.screens.length);
    });
  });

  // The four labels that were wrong before this file was generated. Pinned so
  // they cannot regress into prose somebody made up.
  it('POS_OPS does not claim the Tables screen', () => {
    expect(SCREENS.POS_OPS).not.toContain('Tables');
  });

  it('POS_ORDER opens Billing and Tables, which its old label omitted', () => {
    expect(SCREENS.POS_ORDER).toEqual(expect.arrayContaining(['Billing & KOT', 'Tables']));
  });

  it('POS_CONFIG opens the whole setup section, not one settings screen', () => {
    expect(SCREENS.POS_CONFIG.length).toBeGreaterThanOrEqual(9);
  });

  it('POS_BILLING opens the cash drawer, not the billing screen', () => {
    expect(SCREENS.POS_BILLING).toEqual(['Cash Sessions']);
  });
});

describe('a capability carries the screens it opens', () => {
  it('so the reader never has to guess what a name covers', async () => {
    const r = await resolveForScopes(['POS_CONFIG:READ']);
    const [cap] = r.groups.flatMap((g) => g.capabilities);
    expect(cap.screens).toContain('Menu Master');
    expect(cap.screens).toContain('Campaigns');
  });

  it('is empty rather than wrong for a scope with no Front Desk screen', async () => {
    const r = await resolveForScopes(['CONTACTS:READ']);
    const [cap] = r.groups.flatMap((g) => g.capabilities);
    expect(cap.screens).toEqual([]);
  });
});
