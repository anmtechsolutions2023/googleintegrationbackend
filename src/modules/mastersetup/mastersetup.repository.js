// src/modules/mastersetup/mastersetup.repository.js
// Data access for the per-tenant first-time setup state (tenant_setup table).
//
// Deliberately kept in its own file with NO dependency on other module services.
// mastersetup.service pulls in ~14 CRUD services; both auth.service and the
// requireTenantSetup middleware need to read setup state, and importing the full
// service from either would create a heavy (and in auth's case circular) import
// graph. This file depends only on dbHelper and constants.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, TENANT_SETUP } = require('../../config/constants');

/**
 * Reads the raw tenant_setup row for a tenant.
 * @param {string} tenantId - Tenant ID.
 * @returns {Promise<Object|null>} Row, or null when the tenant has no row yet.
 */
const findByTenant = (tenantId, existingConn) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.TENANT_SETUP.SELECT_BY_TENANT, [
      tenantId,
    ]);
    return rows.length > 0 ? rows[0] : null;
  }, existingConn);

/**
 * Returns the setup status for a tenant in the shape the API exposes.
 * A tenant with no row has never run the wizard and resolves to PENDING.
 * @param {string} tenantId - Tenant ID.
 * @returns {Promise<Object>} { tenantId, status, completedAt, completedBy, isComplete }
 */
const getStatus = async (tenantId) => {
  const row = await findByTenant(tenantId);
  const status = row ? row.status : TENANT_SETUP.STATUS_PENDING;
  return {
    tenantId,
    status,
    completedAt: row ? row.completed_at : null,
    completedBy: row ? row.completed_by : null,
    isComplete: status === TENANT_SETUP.STATUS_COMPLETED,
  };
};

/**
 * True when the tenant has completed the first-time setup wizard.
 * @param {string} tenantId - Tenant ID.
 * @returns {Promise<boolean>}
 */
const isSetupComplete = async (tenantId, existingConn) => {
  if (!tenantId) return false;
  const row = await findByTenant(tenantId, existingConn);
  return !!row && row.status === TENANT_SETUP.STATUS_COMPLETED;
};

/**
 * Marks a tenant's setup COMPLETED on an EXISTING transaction connection.
 * Takes the connection so the flag is committed atomically with the master data
 * it describes — a rolled-back bootstrap must leave the tenant PENDING.
 * @param {Object} conn - Open transaction connection.
 * @param {string} tenantId - Tenant ID.
 * @param {string} userEmail - Acting user's email.
 * @returns {Promise<void>}
 */
const markCompletedTx = async (conn, tenantId, userEmail) => {
  await conn.execute(QUERIES.TENANT_SETUP.UPSERT_COMPLETED, [
    tenantId,
    userEmail,
  ]);
};

module.exports = {
  findByTenant,
  getStatus,
  isSetupComplete,
  markCompletedTx,
};
