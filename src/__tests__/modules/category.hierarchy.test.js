// src/__tests__/modules/category.hierarchy.test.js
// Sub-categories: categorydetail.ParentId, and the two-level limit.
//
// A portal menu is category → sub-category and nothing deeper. The limit is
// enforced on write rather than discovered when a menu push fails against a
// live API, so these are the cases that must hold:
//
//   * a category cannot be its own parent;
//   * it cannot hang off a category that already has a parent (3 levels);
//   * it cannot BE given a parent while it still has children (also 3 levels,
//     approached from the other side — the case a naive depth check misses);
//   * a parent from another tenancy is not a hierarchy, it is a leak.

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
const { QUERIES } = require('../../config/constants');
const categoryService = require('../../modules/category/category.service');
const { assertTwoLevelDepth } = categoryService;

const TENANT = 'tenant-1';

// executeQuery is called with SELECT_BY_ID to fetch the proposed parent, and
// COUNT_CHILDREN to ask whether the mover has children. Route by query.
const respond = ({ parent = undefined, children = 0 }) => {
  executeQuery.mockImplementation(async (sql) => {
    if (sql === QUERIES.CATEGORY.SELECT_BY_ID) return parent ? [parent] : [];
    if (sql === QUERIES.CATEGORY.COUNT_CHILDREN) return [{ total: children }];
    return [];
  });
};

beforeEach(() => jest.clearAllMocks());

describe('a top-level category is always allowed', () => {
  it('accepts a null parent without touching the database', async () => {
    await expect(assertTwoLevelDepth('cat-1', null, TENANT)).resolves.toBeUndefined();
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('accepts an undefined parent the same way', async () => {
    await expect(assertTwoLevelDepth('cat-1', undefined, TENANT)).resolves.toBeUndefined();
    expect(executeQuery).not.toHaveBeenCalled();
  });
});

describe('the two-level limit', () => {
  it('allows nesting under a genuine top-level category', async () => {
    respond({ parent: { Id: 'top-1', ParentId: null }, children: 0 });
    await expect(assertTwoLevelDepth('cat-1', 'top-1', TENANT)).resolves.toBeUndefined();
  });

  it('refuses a category as its own parent', async () => {
    await expect(assertTwoLevelDepth('cat-1', 'cat-1', TENANT))
      .rejects.toMatchObject({ statusCode: 400, message: /its own parent/i });
    // Rejected before any lookup — a self-reference needs no database.
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('refuses a third level: nesting under a sub-category', async () => {
    respond({ parent: { Id: 'sub-1', ParentId: 'top-1' } });
    await expect(assertTwoLevelDepth('cat-1', 'sub-1', TENANT))
      .rejects.toMatchObject({ statusCode: 400, message: /two levels deep/i });
  });

  // The direction a naive depth check misses: the PARENT is fine, but the
  // category being moved already has children of its own.
  it('refuses giving a parent to a category that has children', async () => {
    respond({ parent: { Id: 'top-1', ParentId: null }, children: 3 });
    await expect(assertTwoLevelDepth('cat-1', 'top-1', TENANT))
      .rejects.toMatchObject({ statusCode: 400, message: /already has sub-categories/i });
  });

  it('does not run the children check on create — there is no id yet', async () => {
    respond({ parent: { Id: 'top-1', ParentId: null }, children: 99 });
    await expect(assertTwoLevelDepth(null, 'top-1', TENANT)).resolves.toBeUndefined();
    const queries = executeQuery.mock.calls.map(([sql]) => sql);
    expect(queries).not.toContain(QUERIES.CATEGORY.COUNT_CHILDREN);
  });
});

describe('tenant isolation', () => {
  it('refuses a parent that does not exist in this tenancy', async () => {
    respond({ parent: undefined });
    await expect(assertTwoLevelDepth('cat-1', 'someone-elses', TENANT))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('looks the parent up scoped to the tenant, never by id alone', async () => {
    respond({ parent: { Id: 'top-1', ParentId: null } });
    await assertTwoLevelDepth('cat-1', 'top-1', TENANT);
    expect(executeQuery).toHaveBeenCalledWith(
      QUERIES.CATEGORY.SELECT_BY_ID,
      ['top-1', TENANT],
    );
  });
});

describe('the parent picker', () => {
  it('offers only top-level, active categories', () => {
    const sql = QUERIES.CATEGORY.SELECT_PARENT_CANDIDATES;
    // Offering a sub-category as a parent is how a user builds a third level
    // and only finds out on save.
    expect(sql).toMatch(/ParentId IS NULL/);
    expect(sql).toMatch(/Active = 1/);
    expect(sql).toMatch(/TenantId = \?/);
  });

  it('is scoped to the tenant when called', async () => {
    executeQuery.mockResolvedValue([{ Id: 'top-1', Name: 'Starters' }]);
    await categoryService.getParentCandidates(TENANT);
    expect(executeQuery).toHaveBeenCalledWith(
      QUERIES.CATEGORY.SELECT_PARENT_CANDIDATES,
      [TENANT],
    );
  });
});

describe('deleting a parent', () => {
  it('explains what is in the way instead of letting the FK 500', async () => {
    executeQuery.mockImplementation(async (sql) => {
      if (sql === QUERIES.CATEGORY.COUNT_CHILDREN) return [{ total: 2 }];
      return [];
    });
    await expect(categoryService.deleteCategory('top-1', TENANT))
      .rejects.toMatchObject({ statusCode: 400, message: /2 sub-categories/i });
  });

  it('gets the singular right for one child', async () => {
    executeQuery.mockImplementation(async (sql) => {
      if (sql === QUERIES.CATEGORY.COUNT_CHILDREN) return [{ total: 1 }];
      return [];
    });
    await expect(categoryService.deleteCategory('top-1', TENANT))
      .rejects.toMatchObject({ message: /1 sub-category\./i });
  });
});

describe('the queries carry the new columns', () => {
  it('inserts and updates ParentId and SortOrder', () => {
    expect(QUERIES.CATEGORY.INSERT).toMatch(/ParentId/);
    expect(QUERIES.CATEGORY.INSERT).toMatch(/SortOrder/);
    expect(QUERIES.CATEGORY.UPDATE).toMatch(/ParentId = \?/);
    expect(QUERIES.CATEGORY.UPDATE).toMatch(/SortOrder = \?/);
  });

  it('has an INSERT whose placeholders match its columns', () => {
    const cols = QUERIES.CATEGORY.INSERT.match(/\(([^)]+)\)\s+VALUES/i)[1].split(',').length;
    const marks = (QUERIES.CATEGORY.INSERT.match(/\?/g) || []).length;
    const literals = (QUERIES.CATEGORY.INSERT.match(/NOW\(\)/g) || []).length;
    expect(marks + literals).toBe(cols);
  });

  // A parent from another tenancy would be a cross-tenant read.
  it('joins the parent name within the same tenant only', () => {
    expect(QUERIES.CATEGORY.SELECT_ALL).toMatch(/p\.TenantId = c\.TenantId/);
    expect(QUERIES.CATEGORY.SELECT_BY_ID).toMatch(/p\.TenantId = c\.TenantId/);
  });
});
