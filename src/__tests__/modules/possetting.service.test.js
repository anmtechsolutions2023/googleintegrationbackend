// Per-branch POS settings. The behaviour that matters is what happens when a
// branch has NEVER been configured — that is the state every branch starts in,
// and it has to be a working one rather than an error.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

let rows;
const executed = [];
const mockConn = {
  execute: jest.fn(async (sql, params) => {
    executed.push({ sql, params });
    if (sql.includes('SELECT SettingValue')) {
      return [rows.value === undefined ? [] : [{ SettingValue: rows.value }]];
    }
    if (sql.includes('SELECT SettingKey')) return [rows.all || []];
    return [{ affectedRows: 1 }];
  }),
};

jest.mock('../../utils/dbHelper', () => ({
  withConnection: (fn) => fn(mockConn),
  withTransaction: (fn) => fn(mockConn),
}));

const service = require('../../modules/possetting/possetting.service');
const { POS_SETTING_KEYS } = require('../../config/constants');

const TENANT = 'tn';
const BRANCH = 'branch-a';

beforeEach(() => { executed.length = 0; rows = {}; mockConn.execute.mockClear(); });

describe('resolving the token numbering mode', () => {
  it('defaults to daily when the branch has no row', async () => {
    expect(await service.resolveTokenNumberingTx(mockConn, BRANCH, TENANT)).toBe('daily');
  });

  it('uses the branch\'s stored value', async () => {
    rows.value = 'series';
    expect(await service.resolveTokenNumberingTx(mockConn, BRANCH, TENANT)).toBe('series');
  });

  it('falls back rather than throwing on an unrecognised stored value', async () => {
    // A hand-edited row must not make the till unnumberable — this runs on the
    // sale path.
    rows.value = 'fortnightly';
    expect(await service.resolveTokenNumberingTx(mockConn, BRANCH, TENANT)).toBe('daily');
  });

  it('treats an empty stored value as unset', async () => {
    rows.value = '';
    expect(await service.resolveTokenNumberingTx(mockConn, BRANCH, TENANT)).toBe('daily');
  });

  it('defaults without querying when there is no branch', async () => {
    expect(await service.resolveTokenNumberingTx(mockConn, null, TENANT)).toBe('daily');
    expect(executed).toHaveLength(0);
  });
});

describe('reading a branch\'s settings', () => {
  it('fills in defaults for keys never set, so the UI renders something', async () => {
    rows.all = [];
    expect(await service.getBranchSettings(BRANCH, TENANT))
      .toEqual({
        'token.numbering': 'daily',
        'loyalty.rupees_per_point': '100',
        'kot.auto_print': 'on',
      });
  });

  it('stored values win over defaults', async () => {
    rows.all = [{ SettingKey: 'token.numbering', SettingValue: 'series' }];
    expect(await service.getBranchSettings(BRANCH, TENANT))
      .toEqual({
        'token.numbering': 'series',
        'loyalty.rupees_per_point': '100',
        'kot.auto_print': 'on',
      });
  });

  it('returns every key the settings endpoint accepts', async () => {
    // A key the reader knows but the whitelist rejects is a setting that
    // silently cannot be changed — which is how the loyalty rate shipped the
    // first time. Both sides read from POS_SETTING_KEYS so they cannot drift.
    rows.all = [];
    const rendered = Object.keys(await service.getBranchSettings(BRANCH, TENANT));
    Object.values(POS_SETTING_KEYS).forEach((key) => expect(rendered).toContain(key));
  });
});

describe('writing settings', () => {
  it('upserts each key against the branch', async () => {
    rows.all = [{ SettingKey: 'token.numbering', SettingValue: 'series' }];
    await service.setBranchSettings(BRANCH, { 'token.numbering': 'series' }, TENANT, 'u@x');
    const upsert = executed.find((e) => /INSERT INTO pos_setting/.test(e.sql));
    expect(upsert.sql).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(upsert.params.slice(1, 5)).toEqual([TENANT, BRANCH, 'token.numbering', 'series']);
  });
});
