// src/config/routes.js
// Centralized route configuration and registration.
// All module routes are imported and registered here.

const authRoutes = require('../modules/auth/auth.routes');
const tenantRoutes = require('../modules/tenant/tenant.routes');
const reportsRoutes = require('../modules/reports/reports.routes');
const dataRoutes = require('../modules/data/data.routes');
const auditRoutes = require('../modules/audit/audit.routes');
const userRoutes = require('../modules/user/user.routes');

/**
 * Registers all application routes with the Express app.
 * @param {Object} app - Express application instance.
 */
const registerRoutes = (app) => {
  // Authentication module - Google OAuth
  app.use('/api/auth', authRoutes);

  // Tenant management module - Tenant switching
  app.use('/api/tenants', tenantRoutes);

  // Reports module - Reports and billing data
  app.use('/api/reports', reportsRoutes);

  // Data module - Admin settings and general data access
  app.use('/api/data', dataRoutes);

  // Audit module - Audit log retrieval
  app.use('/api/audit', auditRoutes);

  // User module - User operations (logout, profile)
  app.use('/api/user', userRoutes);

  // Health check / root endpoint
  app.get('/', (req, res) => {
    res.json({
      message: 'Google Integration Backend API',
      version: '1.0.0',
      status: 'running',
      modules: [
        { name: 'auth', path: '/api/auth' },
        { name: 'tenants', path: '/api/tenants' },
        { name: 'reports', path: '/api/reports' },
        { name: 'data', path: '/api/data' },
        { name: 'audit', path: '/api/audit' },
        { name: 'user', path: '/api/user' },
      ],
    });
  });
};

module.exports = { registerRoutes };
