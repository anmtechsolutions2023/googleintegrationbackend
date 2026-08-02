// src/modules/ledger/ledger.guard.js
// Immutability: a settled document is corrected by reversal, never by editing.
//
// Without this the ledger is just a table you can quietly change, which defeats
// the point of numbering and auditing it. Applied to the CRUD update/delete
// paths of the document and its children.

const { withConnection } = require('../../utils/dbHelper');
const { LEDGER } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');

/**
 * Current status name of a document, or null when it has none.
 * @param {string} logId
 * @param {string} tenantId
 * @returns {Promise<string|null>}
 */
const statusOf = async (logId, tenantId) => {
  if (!logId) return null;
  return withConnection(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT s.Name AS StatusName
         FROM transactiondetaillog l
         LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        WHERE l.Id = ? AND l.TenantId = ?`,
      [logId, tenantId],
    );
    return rows && rows.length > 0 ? rows[0].StatusName : null;
  });
};

/**
 * Throws when the document has moved past DRAFT.
 *
 * Documents with no status (created before the ledger, or plain drafts) stay
 * editable — the guard only protects what has actually been posted.
 *
 * @param {string} logId
 * @param {string} tenantId
 */
const assertMutable = async (logId, tenantId) => {
  const status = await statusOf(logId, tenantId);
  if (status && LEDGER.IMMUTABLE_STATUSES.includes(status)) {
    throw new HttpError(MESSAGES.ERROR.LEDGER_IMMUTABLE, MESSAGES.HTTP_STATUS.CONFLICT);
  }
};

module.exports = { assertMutable, statusOf };
