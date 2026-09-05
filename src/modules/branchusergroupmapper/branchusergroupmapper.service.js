// src/modules/branchusergroupmapper/branchusergroupmapper.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class BranchUserGroupMapperService extends BaseCRUDService {
  constructor() {
    super('Branch User Group Mapper', QUERIES.BRANCH_USER_GROUP_MAPPER);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.BranchDetailId,
      data.UserGroupId,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.UserGroupId !== undefined ? data.UserGroupId : existing.UserGroupId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new BranchUserGroupMapperService();
module.exports = {
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
