const db = require('../config/db')

const captureAudit = async (req, tenantId, email, action, status) => {
  // Get IP: handle local vs proxy/load-balancer
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress ||
    '0.0.0.0'

  const query = `
        INSERT INTO audit_logs (tenant_id, user_email, action, status, ip_address, timestamp) 
        VALUES (?, ?, ?, ?, ?, NOW())
    `

  try {
    await db.execute(query, [tenantId || null, email, action, status, ip])
  } catch (err) {
    console.error('Critical Audit Log Failure:', err)
  }
}

module.exports = { captureAudit }
