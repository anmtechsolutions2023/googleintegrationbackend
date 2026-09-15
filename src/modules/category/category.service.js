// src/modules/category/category.service.js
// Category Service extending BaseCRUDService
// Handles business logic for category operations with standardized patterns

const { v4: uuidv4 } = require('uuid');
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');
const { executeQuery, withTransaction } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');

/**
 * JSON_ARRAYAGG returns a JSON value, which mysql2 hands back as a parsed array
 * on some server/driver combinations and as a string on others; a category with
 * no tags yields NULL rather than an empty array. Normalising here means every
 * caller — the form, the till, the tests — sees a plain array of ids.
 * @param {*} v
 * @returns {string[]}
 */
const toIdArray = (v) => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x != null);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.filter((x) => x != null) : [];
    } catch {
      return [];
    }
  }
  return [];
};

/**
 * A menu tree is EXACTLY two levels: category → sub-category. Portals reject
 * anything deeper, so the limit is enforced here rather than discovered when a
 * menu push fails against a live API.
 *
 * Three ways to break it, all checked:
 *   1. pointing a category at itself;
 *   2. pointing at a category that ALREADY has a parent (would make 3 levels);
 *   3. giving a parent to a category that already HAS children (same, from the
 *      other direction — the subtlety a depth check usually misses).
 *
 * @param {string} id       the category being written, null on create
 * @param {string} parentId the proposed parent
 * @param {string} tenantId
 */
const assertTwoLevelDepth = async (id, parentId, tenantId) => {
  if (!parentId) return;

  if (id && parentId === id) {
    throw new HttpError('A category cannot be its own parent.', 400);
  }

  const parentRows = await executeQuery(QUERIES.CATEGORY.SELECT_BY_ID, [parentId, tenantId]);
  const parent = parentRows[0];
  if (!parent) {
    // Scoped by tenant, so this also covers "exists, but not yours".
    throw new HttpError('Parent category not found.', 404);
  }
  if (parent.ParentId) {
    throw new HttpError(
      'A sub-category cannot be nested under another sub-category — the menu tree is two levels deep.',
      400,
    );
  }

  if (id) {
    const [{ total }] = await executeQuery(QUERIES.CATEGORY.COUNT_CHILDREN, [id, tenantId]);
    if (Number(total) > 0) {
      throw new HttpError(
        'This category already has sub-categories, so it cannot become a sub-category itself.',
        400,
      );
    }
  }
};

/**
 * Category Service extending base CRUD functionality
 */
class CategoryService extends BaseCRUDService {
  constructor() {
    super('Category', QUERIES.CATEGORY);
  }

  /**
   * Prepare parameters for category insertion
   * @param {string} id - Generated ID
   * @param {Object} data - Category data
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - User email
   * @returns {Array} Parameters for INSERT query
   */
  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name,
      data.ParentId ?? null,
      data.SortOrder !== undefined ? data.SortOrder : 0,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  /**
   * Prepare parameters for category update
   * @param {Object} data - New data
   * @param {Object} existing - Existing record
   * @param {string} userPhone - User email
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @returns {Array} Parameters for UPDATE query
   */
  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    const updatedName = data.Name !== undefined ? data.Name : existing.Name;
    const updatedActive =
      data.Active !== undefined ? data.Active : existing.Active;
    // `undefined` means "not sent, keep it"; explicit null means "promote this
    // back to a top-level category". The two must not collapse into one.
    const updatedParentId =
      data.ParentId !== undefined ? data.ParentId : existing.ParentId;
    const updatedSortOrder =
      data.SortOrder !== undefined ? data.SortOrder : existing.SortOrder;

    return [
      updatedName,
      updatedParentId ?? null,
      updatedSortOrder ?? 0,
      updatedActive,
      userPhone,
      id,
      tenantId,
    ];
  }

  /**
   * Replace the category's tag links.
   *
   * Same shape as positemmeta.syncLinks: delete the set, insert the new one, on
   * the CALLER'S connection so the links and the row they belong to commit or
   * roll back together.
   *
   * Only acted on when an ARRAY is supplied. `undefined` means "not sent, leave
   * the links alone" — a PATCH that renames a category must not silently strip
   * every tag from it — while an empty array means "detach everything".
   *
   * @param {Object} connection open transaction connection
   * @param {string} categoryId
   * @param {string} tenantId
   * @param {string} userPhone
   * @param {string[]|undefined} tagIds
   */
  async syncTags(connection, categoryId, tenantId, userPhone, tagIds) {
    if (!Array.isArray(tagIds)) return;
    await connection.execute(this.queries.DELETE_TAG_LINKS, [categoryId, tenantId]);
    for (const tagId of tagIds) {
      await connection.execute(this.queries.INSERT_TAG_LINK, [
        uuidv4(), categoryId, tagId, tenantId, userPhone,
      ]);
    }
  }

  /** The row as every caller wants it: TagIds a plain array, never NULL. */
  normalizeRow(row) {
    if (!row) return row;
    return { ...row, TagIds: toIdArray(row.TagIds) };
  }

  // Create the category and its tag links atomically.
  async create(data, tenantId, userPhone) {
    return withTransaction(async (connection) => {
      const id = uuidv4();
      await connection.execute(
        this.queries.INSERT,
        this.prepareInsertParams(id, data, tenantId, userPhone),
      );
      await this.syncTags(connection, id, tenantId, userPhone, data.TagIds);
      return { id, ...data };
    });
  }

  // Update the category and re-sync its tag links atomically.
  async update(id, data, tenantId, userPhone) {
    return withTransaction(async (connection) => {
      const [existingRows] = await connection.execute(this.queries.SELECT_BY_ID, [id, tenantId]);
      if (!existingRows || existingRows.length === 0) {
        throw new HttpError('Category not found', 404);
      }
      const params = this.prepareUpdateParams(data, existingRows[0], userPhone, id, tenantId)
        .map((p) => (p === undefined ? null : p));
      await connection.execute(this.queries.UPDATE, params);
      await this.syncTags(connection, id, tenantId, userPhone, data.TagIds);
      const [rows] = await connection.execute(this.queries.SELECT_BY_ID, [id, tenantId]);
      return this.normalizeRow(rows[0]);
    });
  }

  async getById(id, tenantId, expand, conn) {
    return this.normalizeRow(await super.getById(id, tenantId, expand, conn));
  }

  async getAll(tenantId, page, limit, expand) {
    const result = await super.getAll(tenantId, page, limit, expand);
    return { ...result, data: (result.data || []).map((r) => this.normalizeRow(r)) };
  }

  /**
   * Get all categories for a tenant with pagination.
   * @param {string} tenantId - Tenant ID
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>} Paginated results
   */
  async getAllCategories(tenantId, page = 1, limit = 10) {
    logger.info('CategoryService.getAllCategories called', {
      tenantId,
      page,
      limit,
    });
    return await this.getAll(tenantId, page, limit);
  }

  /**
   * Get category by ID.
   * @param {string} id - Category ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Category object
   */
  async getCategoryById(id, tenantId) {
    logger.info('CategoryService.getCategoryById called', { id, tenantId });
    return await this.getById(id, tenantId);
  }

  /**
   * Create new category.
   * @param {Object} categoryData - Category data
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - User email
   * @returns {Promise<Object>} Created category
   */
  async createCategory(categoryData, tenantId, userPhone) {
    logger.info('CategoryService.createCategory called', {
      tenantId,
      userPhone,
    });
    await assertTwoLevelDepth(null, categoryData.ParentId, tenantId);
    return await this.create(categoryData, tenantId, userPhone);
  }

  /**
   * Categories eligible to BE a parent — top-level, active ones. Feeds the
   * parent picker, which must never offer a sub-category.
   * @param {string} tenantId
   */
  async getParentCandidates(tenantId) {
    return await executeQuery(QUERIES.CATEGORY.SELECT_PARENT_CANDIDATES, [tenantId]);
  }

  /**
   * Update existing category.
   * @param {string} id - Category ID
   * @param {Object} updateData - Updated data
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - User email
   * @returns {Promise<Object>} Updated category
   */
  async updateCategory(id, updateData, tenantId, userPhone) {
    logger.info('CategoryService.updateCategory called', {
      id,
      tenantId,
      userPhone,
    });
    // Only when the caller is actually moving it. An update that leaves
    // ParentId alone must not be refused because of a tree it never touched.
    if (updateData.ParentId !== undefined) {
      await assertTwoLevelDepth(id, updateData.ParentId, tenantId);
    }
    return await this.update(id, updateData, tenantId, userPhone);
  }

  /**
   * Delete category.
   * @param {string} id - Category ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<void>}
   */
  async deleteCategory(id, tenantId) {
    logger.info('CategoryService.deleteCategory called', { id, tenantId });
    // The FK would refuse this anyway, but as an opaque ER_ROW_IS_REFERENCED
    // 500 that reads like a server fault. Say what is actually in the way.
    const [{ total }] = await executeQuery(QUERIES.CATEGORY.COUNT_CHILDREN, [id, tenantId]);
    if (Number(total) > 0) {
      throw new HttpError(
        `This category has ${total} sub-categor${Number(total) === 1 ? 'y' : 'ies'}. ` +
        'Move or delete them first.',
        400,
      );
    }
    return await this.delete(id, tenantId);
  }
}

// Create singleton instance
const categoryService = new CategoryService();

module.exports = {
  createTx: (conn, data, tenantId, userPhone) => categoryService.createTx(conn, data, tenantId, userPhone),
  getAllCategories: (tenantId, page, limit) =>
    categoryService.getAllCategories(tenantId, page, limit),
  getCategoryById: (id, tenantId) =>
    categoryService.getCategoryById(id, tenantId),
  createCategory: (data, tenantId, userPhone) =>
    categoryService.createCategory(data, tenantId, userPhone),
  updateCategory: (id, data, tenantId, userPhone) =>
    categoryService.updateCategory(id, data, tenantId, userPhone),
  deleteCategory: (id, tenantId) =>
    categoryService.deleteCategory(id, tenantId),
  getParentCandidates: (tenantId) => categoryService.getParentCandidates(tenantId),
  // Exported for its unit test — not part of the HTTP surface.
  assertTwoLevelDepth,
};
