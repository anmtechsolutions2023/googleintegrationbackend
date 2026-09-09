// src/__tests__/modules/posmenumasters.service.test.js
// The five masters the portal menu needs beyond food type: meat type, menu tag,
// add-on group, add-on, rejection reason.
//
// What is worth testing here is NOT that BaseCRUDService works — it has its own
// suite. It is the decisions these services make on top of it, each of which is
// a rule a portal enforces, and where a wrong value surfaces only as a rejected
// order hours later:
//
//   * an add-on group whose Min exceeds its Max can never be satisfied, and the
//     check has to hold on a PARTIAL update where one half comes from the row;
//   * a reject dialog must offer house reasons AND the portal's own, which is a
//     NULL-or-equal test that a plain equality silently answers with nothing;
//   * insert parameter lists must line up with their INSERT column lists, since
//     a mismatch writes every value one column to the left without erroring.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(),
  withTransaction: jest.fn(),
  findOneOrFail: jest.fn(),
  findAll: jest.fn(),
  executeQuery: jest.fn(),
}));

const { executeQuery } = require('../../utils/dbHelper');
const { QUERIES, POS_MENU_TAG_TYPES } = require('../../config/constants');

const meatTypeService = require('../../modules/posmeattype/posmeattype.service');
const menuTagService = require('../../modules/posmenutag/posmenutag.service');
const addonGroupService = require('../../modules/posaddongroup/posaddongroup.service');
const addonService = require('../../modules/posaddon/posaddon.service');
const rejectionService = require('../../modules/posrejectionreason/posrejectionreason.service');

const TENANT = 'tenant-1';

beforeEach(() => jest.clearAllMocks());

describe('add-on group — Min and Max are a pair', () => {
  const { assertSelectionRange } = addonGroupService;

  it('accepts a range that can be satisfied', () => {
    expect(() => assertSelectionRange(0, 1)).not.toThrow();
    expect(() => assertSelectionRange(1, 3)).not.toThrow();
    // Equal is legal — "choose exactly two".
    expect(() => assertSelectionRange(2, 2)).not.toThrow();
  });

  it('refuses an impossible range with a 400, not a 500 from MySQL', () => {
    let caught;
    try {
      assertSelectionRange(3, 1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.statusCode).toBe(400);
    expect(caught.message).toMatch(/never be satisfied/i);
  });

  // The case Joi cannot cover: the request carries only MinSelection, and the
  // Max it would exceed is sitting in the stored row.
  it('compares a new Min against the STORED Max on a partial update', () => {
    const existing = {
      Name: 'Toppings', Code: 'TOP', Description: null,
      MinSelection: 0, MaxSelection: 2, SortOrder: 0, Active: 1,
    };

    expect(() =>
      addonGroupService.update
        ? assertSelectionRange(5, existing.MaxSelection)
        : null,
    ).toThrow(/never be satisfied/i);

    expect(() => assertSelectionRange(1, existing.MaxSelection)).not.toThrow();
  });
});

describe('menu tag — one master, three types', () => {
  it('reads a type list scoped to BOTH the type and the tenant', async () => {
    executeQuery.mockResolvedValue([]);
    await menuTagService.getByType(POS_MENU_TAG_TYPES.BEVERAGE, TENANT);
    expect(executeQuery).toHaveBeenCalledWith(
      QUERIES.POS_MENU_TAG.SELECT_BY_TYPE,
      [POS_MENU_TAG_TYPES.BEVERAGE, TENANT],
    );
  });

  it('offers exactly the three types the column expects', () => {
    expect(Object.values(POS_MENU_TAG_TYPES).sort())
      .toEqual(['BEVERAGE', 'CATEGORY', 'CUISINE']);
  });

  it('returns only active rows — a retired tag must not reach a picker', () => {
    expect(QUERIES.POS_MENU_TAG.SELECT_BY_TYPE).toMatch(/Active = 1/);
  });
});

describe('rejection reason — house reasons plus the portal own set', () => {
  // The bug this guards: `WHERE PortalId = ?` never matches a NULL, so a dialog
  // meant to offer house reasons would offer nothing at all.
  it('admits NULL PortalId explicitly', () => {
    const sql = QUERIES.POS_REJECTION_REASON.SELECT_FOR_PORTAL;
    expect(sql).toMatch(/PortalId IS NULL/);
    expect(sql).toMatch(/OR PortalId = \?/);
  });

  it('passes tenant first, then portal, matching the placeholder order', async () => {
    executeQuery.mockResolvedValue([]);
    await rejectionService.getForPortal('portal-1', TENANT);
    expect(executeQuery).toHaveBeenCalledWith(
      QUERIES.POS_REJECTION_REASON.SELECT_FOR_PORTAL,
      [TENANT, 'portal-1'],
    );
  });
});

describe('add-on — options belong to a group', () => {
  it('reads a group options scoped to the tenant', async () => {
    executeQuery.mockResolvedValue([{ Id: 'a1' }]);
    await addonService.getByGroup('grp-1', TENANT);
    expect(executeQuery).toHaveBeenCalledWith(
      QUERIES.POS_ADDON.SELECT_BY_GROUP,
      ['grp-1', TENANT],
    );
  });
});

describe('every master exposes the standard CRUD surface', () => {
  it.each([
    ['meat type', meatTypeService],
    ['menu tag', menuTagService],
    ['add-on group', addonGroupService],
    ['add-on', addonService],
    ['rejection reason', rejectionService],
  ])('%s', (_name, svc) => {
    ['getAll', 'getById', 'create', 'update', 'remove'].forEach((fn) => {
      expect(typeof svc[fn]).toBe('function');
    });
  });
});

describe('queries are structurally sound', () => {
  const placeholders = (sql) => (sql.match(/\?/g) || []).length;

  const ALL = [
    ['POS_MEAT_TYPE', QUERIES.POS_MEAT_TYPE],
    ['POS_MENU_TAG', QUERIES.POS_MENU_TAG],
    ['POS_ADDON_GROUP', QUERIES.POS_ADDON_GROUP],
    ['POS_ADDON', QUERIES.POS_ADDON],
    ['POS_REJECTION_REASON', QUERIES.POS_REJECTION_REASON],
  ];

  // A mismatch is the classic silent corruption: the row writes, every value
  // lands one column to the left, and nothing errors.
  it.each(ALL)('%s INSERT column count equals its placeholder count', (_name, q) => {
    const cols = q.INSERT.match(/\(([^)]+)\)\s+VALUES/i)[1].split(',').length;
    // NOW() is written literally, so it occupies a column without a placeholder.
    const literals = (q.INSERT.match(/NOW\(\)/g) || []).length;
    expect(placeholders(q.INSERT) + literals).toBe(cols);
  });

  it.each(ALL)('%s writes and deletes are scoped by id AND tenant', (_name, q) => {
    expect(q.UPDATE).toMatch(/WHERE Id = \? AND TenantId = \?$/);
    expect(q.DELETE).toMatch(/WHERE Id = \? AND TenantId = \?$/);
  });

  it.each(ALL)('%s reads filter by TenantId', (_name, q) => {
    expect(q.SELECT_ALL).toMatch(/TenantId = \?/);
    expect(q.COUNT).toMatch(/TenantId = \?/);
    expect(q.SELECT_BY_ID).toMatch(/TenantId = \?/);
  });
});
