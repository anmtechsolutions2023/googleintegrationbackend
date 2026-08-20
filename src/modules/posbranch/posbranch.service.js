// src/modules/posbranch/posbranch.service.js
// The branches a POS screen may name, and nothing else.
//
// Why this exists rather than reusing /api/branchdetails: that endpoint is
// governed by ORGANIZATION_READ, which a cashier has no business holding. But
// every POS screen that is scoped to one outlet — the token queue, the customer
// display, the per-branch settings — has to be able to NAME the branch it is
// showing. Asking a POS_OPS user to also carry an Organization scope to read a
// dropdown would hand them the whole org module to fix a label.
//
// So this returns the two fields a picker needs and not one more: no addresses,
// no GSTIN, no contact ids. Least privilege applies to columns too.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');

/**
 * Branches for the tenant, ordered by name.
 * @param {string} tenantId
 * @returns {Promise<Array<{Id:string, BranchName:string}>>}
 */
const list = (tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.POS_BRANCH.SELECT_ALL, [tenantId]);
    return rows;
  });

module.exports = { list };
