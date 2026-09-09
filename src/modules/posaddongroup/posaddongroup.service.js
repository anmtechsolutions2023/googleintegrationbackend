// src/modules/posaddongroup/posaddongroup.service.js
// POS Add-on Group master service — business logic extending BaseCRUDService.
//
// An ADD-ON GROUP IS NOT A VARIANT. A variant REPLACES the item's price
// (Half/Full); a group AUGMENTS it (extra cheese) and carries selection rules
// of its own. Portals validate an inbound order line against Min/MaxSelection,
// and a variant has no such pair to validate against — which is why modelling
// add-ons as variants is the usual way this integration goes wrong.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');

/**
 * Min and Max are a PAIR and only mean anything together: a group demanding at
 * least two choices but permitting at most one can never be satisfied, and the
 * order it rejects arrives from a portal where nobody can see why.
 *
 * Checked in the service rather than in Joi because it is a relationship
 * between two fields across a PARTIAL update — on PUT either may be absent from
 * the body, and its value then has to come from the stored row.
 *
 * @param {number} min resolved MinSelection
 * @param {number} max resolved MaxSelection
 */
const assertSelectionRange = (min, max) => {
  if (Number(min) > Number(max)) {
    throw new HttpError(
      'MinSelection cannot be greater than MaxSelection — a group with that range can never be satisfied.',
      400,
    );
  }
};

class PosAddonGroupService extends BaseCRUDService {
  constructor() {
    super('POS Add-on Group', QUERIES.POS_ADDON_GROUP);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    const min = data.MinSelection !== undefined ? data.MinSelection : 0;
    const max = data.MaxSelection !== undefined ? data.MaxSelection : 1;
    assertSelectionRange(min, max);
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.Code ?? null,
      data.Description ?? null,
      min,
      max,
      data.SortOrder !== undefined ? data.SortOrder : 0,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    const min = data.MinSelection !== undefined ? data.MinSelection : existing.MinSelection;
    const max = data.MaxSelection !== undefined ? data.MaxSelection : existing.MaxSelection;
    assertSelectionRange(min, max);
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Code !== undefined ? data.Code : existing.Code,
      data.Description !== undefined ? data.Description : existing.Description,
      min,
      max,
      data.SortOrder !== undefined ? data.SortOrder : existing.SortOrder,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new PosAddonGroupService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
  // Exported for its unit test — not part of the HTTP surface.
  assertSelectionRange,
};
