// src/__tests__/utils/paginationHelper.test.js
// Unit tests for pagination helper utilities

const {
  calculatePagination,
  getPaginationMetadata,
  buildPaginatedQuery,
  extractCount,
} = require('../../utils/paginationHelper');

describe('paginationHelper', () => {
  describe('calculatePagination', () => {
    it('returns correct pageNum, limitNum, and offset for standard inputs', () => {
      const result = calculatePagination(2, 10);
      expect(result).toEqual({ pageNum: 2, limitNum: 10, offset: 10 });
    });

    it('defaults to page 1 and limit 10 when no args provided', () => {
      const result = calculatePagination();
      expect(result).toEqual({ pageNum: 1, limitNum: 10, offset: 0 });
    });

    it('clamps page to minimum of 1 for page 0', () => {
      const result = calculatePagination(0, 10);
      expect(result.pageNum).toBe(1);
    });

    it('clamps page to minimum of 1 for negative page', () => {
      const result = calculatePagination(-5, 10);
      expect(result.pageNum).toBe(1);
    });

    it('clamps limit to maximum of 100', () => {
      const result = calculatePagination(1, 200);
      expect(result.limitNum).toBe(100);
    });

    it('clamps limit to minimum of 1 for limit 0', () => {
      const result = calculatePagination(1, 0);
      expect(result.limitNum).toBe(1);
    });

    it('clamps limit to minimum of 1 for negative limit', () => {
      const result = calculatePagination(1, -10);
      expect(result.limitNum).toBe(1);
    });

    it('calculates correct offset for page 3 with limit 25', () => {
      const result = calculatePagination(3, 25);
      expect(result).toEqual({ pageNum: 3, limitNum: 25, offset: 50 });
    });

    it('calculates offset of 0 for page 1', () => {
      const result = calculatePagination(1, 15);
      expect(result.offset).toBe(0);
    });

    it('parses string numbers for page and limit', () => {
      const result = calculatePagination('3', '20');
      expect(result).toEqual({ pageNum: 3, limitNum: 20, offset: 40 });
    });
  });

  describe('getPaginationMetadata', () => {
    it('returns correct metadata for basic scenario', () => {
      const meta = getPaginationMetadata(100, 2, 10);
      expect(meta).toEqual({
        page: 2,
        limit: 10,
        total: 100,
        totalPages: 10,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('sets hasNextPage false on last page', () => {
      const meta = getPaginationMetadata(30, 3, 10);
      expect(meta.hasNextPage).toBe(false);
      expect(meta.hasPreviousPage).toBe(true);
    });

    it('sets hasPreviousPage false on first page', () => {
      const meta = getPaginationMetadata(50, 1, 10);
      expect(meta.hasPreviousPage).toBe(false);
      expect(meta.hasNextPage).toBe(true);
    });

    it('handles single page of results', () => {
      const meta = getPaginationMetadata(5, 1, 10);
      expect(meta.totalPages).toBe(1);
      expect(meta.hasNextPage).toBe(false);
      expect(meta.hasPreviousPage).toBe(false);
    });

    it('handles zero total correctly', () => {
      const meta = getPaginationMetadata(0, 1, 10);
      expect(meta.total).toBe(0);
      expect(meta.totalPages).toBe(0);
      expect(meta.hasNextPage).toBe(false);
    });

    it('rounds up totalPages for partial last page', () => {
      const meta = getPaginationMetadata(25, 1, 10);
      expect(meta.totalPages).toBe(3);
    });
  });

  describe('buildPaginatedQuery', () => {
    it('appends LIMIT and OFFSET to base query', () => {
      const result = buildPaginatedQuery('SELECT * FROM items', 10, 20);
      expect(result).toBe('SELECT * FROM items LIMIT 10 OFFSET 20');
    });

    it('works with offset of 0', () => {
      const result = buildPaginatedQuery('SELECT * FROM items', 5, 0);
      expect(result).toBe('SELECT * FROM items LIMIT 5 OFFSET 0');
    });

    it('preserves the original base query content', () => {
      const base = 'SELECT Id, Name FROM items WHERE TenantId = ?';
      const result = buildPaginatedQuery(base, 10, 0);
      expect(result).toContain(base);
    });
  });

  describe('extractCount', () => {
    it('extracts total field from count result', () => {
      expect(extractCount([{ total: 42 }])).toBe(42);
    });

    it('extracts count field if total is absent', () => {
      expect(extractCount([{ count: 15 }])).toBe(15);
    });

    it('returns 0 for empty array', () => {
      expect(extractCount([])).toBe(0);
    });

    it('returns 0 for result with no recognized key', () => {
      expect(extractCount([{ rows: 10 }])).toBe(0);
    });

    it('returns 0 for total value of 0', () => {
      expect(extractCount([{ total: 0 }])).toBe(0);
    });
  });
});
