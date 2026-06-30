// src/__tests__/utils/responseHelper.test.js
// Unit tests for response helper utilities

const {
  successResponse,
  paginatedResponse,
  createdResponse,
  noContentResponse,
  errorResponse,
} = require('../../utils/responseHelper');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

describe('responseHelper', () => {
  describe('successResponse', () => {
    it('sends a 200 response with success true, message, and data', () => {
      const res = mockRes();
      successResponse(res, 'OK', { id: 1 });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'OK',
        data: { id: 1 },
      });
    });

    it('accepts a custom status code', () => {
      const res = mockRes();
      successResponse(res, 'Partial', null, 206);
      expect(res.status).toHaveBeenCalledWith(206);
    });

    it('defaults to status 200 when no statusCode provided', () => {
      const res = mockRes();
      successResponse(res, 'Done', []);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('handles null data', () => {
      const res = mockRes();
      successResponse(res, 'No data', null);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: null }));
    });

    it('handles array data', () => {
      const res = mockRes();
      const items = [{ id: 1 }, { id: 2 }];
      successResponse(res, 'List', items);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: items }));
    });
  });

  describe('paginatedResponse', () => {
    it('sends a 200 response with pagination metadata', () => {
      const res = mockRes();
      const pagination = { page: 1, limit: 10, total: 50, totalPages: 5 };
      paginatedResponse(res, [{ id: 1 }], pagination, 'Items');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Items',
        data: [{ id: 1 }],
        pagination,
      });
    });

    it('includes success: true in response body', () => {
      const res = mockRes();
      paginatedResponse(res, [], { page: 1, limit: 10, total: 0, totalPages: 0 }, 'msg');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('passes empty array data correctly', () => {
      const res = mockRes();
      const pagination = { page: 1, limit: 10, total: 0, totalPages: 0 };
      paginatedResponse(res, [], pagination, 'Empty');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: [] }));
    });
  });

  describe('createdResponse', () => {
    it('sends a 201 response with created data', () => {
      const res = mockRes();
      createdResponse(res, 'Created', { id: 'abc' });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Created',
        data: { id: 'abc' },
      });
    });

    it('includes success: true', () => {
      const res = mockRes();
      createdResponse(res, 'Done', {});
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('noContentResponse', () => {
    it('sends a 204 response with no body', () => {
      const res = mockRes();
      noContentResponse(res);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });
  });

  describe('errorResponse', () => {
    it('sends a 500 response by default with success false', () => {
      const res = mockRes();
      errorResponse(res, 'Something went wrong');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Something went wrong',
      });
    });

    it('sends a custom status code', () => {
      const res = mockRes();
      errorResponse(res, 'Not found', 404);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('includes errors in response when provided', () => {
      const res = mockRes();
      const errors = [{ field: 'name', message: 'required' }];
      errorResponse(res, 'Validation error', 400, errors);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Validation error',
        errors,
      });
    });

    it('does not include errors key when errors is null', () => {
      const res = mockRes();
      errorResponse(res, 'Error', 500, null);
      const payload = res.json.mock.calls[0][0];
      expect(payload).not.toHaveProperty('errors');
    });

    it('does not include errors key when errors omitted', () => {
      const res = mockRes();
      errorResponse(res, 'Error', 500);
      const payload = res.json.mock.calls[0][0];
      expect(payload).not.toHaveProperty('errors');
    });
  });
});
