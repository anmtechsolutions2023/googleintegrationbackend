const db = require('../config/db')

const auditLog = () => {
  return async (req, res, next) => {
    const { email, tid } = req.user
    const action = `${req.method} ${req.path}`

    try {
      await db.execute(
        'INSERT INTO audit_logs (tenant_id, user_email, action, status) VALUES (?, ?, ?, ?)',
        [tid, email, action, 'SUCCESS']
      )
    } catch (err) {
      console.error('Audit Logging Failed', err)
    }
    next()
  }
}

/**
 * Retrieves audit logs from the database with optional filters.
 * @param {Object} filters - Optional filters for the query.
 * @param {string} filters.tenantId - Filter by tenant ID.
 * @param {string} filters.userEmail - Filter by user email.
 * @param {string} filters.action - Filter by action.
 * @param {string} filters.status - Filter by status ('SUCCESS' or 'DENIED').
 * @param {number} filters.limit - Limit the number of results (default 100).
 * @param {number} filters.offset - Offset for pagination (default 0).
 * @returns {Promise<Array>} Array of audit log records.
 */
const getAuditLogs = async (filters = {}) => {
  const {
    tenantId,
    userEmail,
    action,
    status,
    limit = 100,
    offset = 0,
  } = filters

  let query =
    'SELECT id, tenant_id, user_email, action, status, timestamp FROM audit_logs WHERE 1=1'
  const params = []

  if (tenantId) {
    query += ' AND tenant_id = ?'
    params.push(tenantId)
  }

  if (userEmail) {
    query += ' AND user_email = ?'
    params.push(userEmail)
  }

  if (action) {
    query += ' AND action = ?'
    params.push(action)
  }

  if (status) {
    query += ' AND status = ?'
    params.push(status)
  }

  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  try {
    const [rows] = await db.execute(query, params)
    return rows
  } catch (err) {
    console.error('Failed to retrieve audit logs', err)
    throw err
  }
}

module.exports = {
  auditLog,
  getAuditLogs,
}
