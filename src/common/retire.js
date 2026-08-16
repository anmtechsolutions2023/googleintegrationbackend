// src/common/retire.js
// Delete a master row if nothing depends on it; retire it if something does.
//
// Floor-plan rows are the motivating case. A table that has served orders cannot
// be hard-deleted — pos_order.TableId is a FOREIGN KEY, so MySQL rejects it and
// the user sees an opaque constraint error for what is a perfectly reasonable
// request ("we removed that table"). Cascading instead would be worse: it would
// destroy the trading history the reports are built on.
//
// Retiring (Active = 0) is the honest answer. The row stops appearing on the
// floor plan and in pickers, and every past order keeps pointing at it — while
// the venue snapshot on pos_order (see modules/posorder/posVenue.js) means the
// reports do not even need the row to still exist.

const { withTransaction } = require('../utils/dbHelper');
const { logger } = require('../utils/logger');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Deletes a row, or retires it when it is referenced.
 *
 * @param {Object} p
 * @param {string} p.table - Table to delete from. Fixed literal, never user input.
 * @param {string} p.entityName - For the 404 message.
 * @param {Array<{table:string, column:string}>} p.references - Where a dependency
 *        would live. Fixed literals, never user input.
 * @param {string} p.deleteQuery - Parameterised DELETE (id, tenantId).
 * @param {string} p.id
 * @param {string} p.tenantId
 * @param {string} p.userEmail
 * @returns {Promise<{id:string, retired:boolean}>} retired=true means it was
 *          kept, deactivated, because history points at it.
 */
const deleteOrRetire = async ({
  table, entityName, references, deleteQuery, id, tenantId, userEmail,
}) =>
  withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT Id FROM ${table} WHERE Id = ? AND TenantId = ? LIMIT 1`,
      [id, tenantId],
    );
    if (rows.length === 0) {
      throw new HttpError(`${entityName} not found`, 404);
    }

    for (const ref of references) {
      const [used] = await conn.execute(
        `SELECT 1 FROM ${ref.table} WHERE ${ref.column} = ? AND TenantId = ? LIMIT 1`,
        [id, tenantId],
      );
      if (used.length > 0) {
        await conn.execute(
          `UPDATE ${table} SET Active = 0, UpdatedOn = NOW(), UpdatedBy = ? WHERE Id = ? AND TenantId = ?`,
          [userEmail, id, tenantId],
        );
        logger.info(`${entityName} retired rather than deleted — it has history`, {
          id, tenantId, referencedBy: ref.table,
        });
        return { id, retired: true };
      }
    }

    await conn.execute(deleteQuery, [id, tenantId]);
    return { id, retired: false };
  });

module.exports = { deleteOrRetire };
