// src/config/routes.js
// Centralized route configuration and registration.
// All module routes are imported and registered here.

const authRoutes = require('../modules/auth/auth.routes');
const tenantRoutes = require('../modules/tenant/tenant.routes');
const reportsRoutes = require('../modules/reports/reports.routes');
const dataRoutes = require('../modules/data/data.routes');
const auditRoutes = require('../modules/audit/audit.routes');
const userRoutes = require('../modules/user/user.routes');
const taxtypeRoutes = require('../modules/taxtype/taxtype.routes');
const uomRoutes = require('../modules/uom/uom.routes');
const categoryRoutes = require('../modules/category/category.routes');
const transactiontypeconfigRoutes = require('../modules/transactiontypeconfig/transactiontypeconfig.routes');
const organizationRoutes = require('../modules/organization/organization.routes');
const uomfactorRoutes = require('../modules/uomfactor/uomfactor.routes');
const accounttypeRoutes = require('../modules/accounttype/accounttype.routes');
const transactiontypestatusRoutes = require('../modules/transactiontypestatus/transactiontypestatus.routes');
const contactaddresstypeRoutes = require('../modules/contactaddresstype/contactaddresstype.routes');
const taxgroupRoutes = require('../modules/taxgroup/taxgroup.routes');
const taxgrouptaxtypemapperRoutes = require('../modules/taxgrouptaxtypemapper/taxgrouptaxtypemapper.routes');
const mapproviderRoutes = require('../modules/mapprovider/mapprovider.routes');
const locationdetailRoutes = require('../modules/locationdetail/locationdetail.routes');
const mapproviderlocationmapperRoutes = require('../modules/mapproviderlocationmapper/mapproviderlocationmapper.routes');
const contactdetailRoutes = require('../modules/contactdetail/contactdetail.routes');
const addressdetailRoutes = require('../modules/addressdetail/addressdetail.routes');
const costinfoRoutes = require('../modules/costinfo/costinfo.routes');
const branchdetailRoutes = require('../modules/branchdetail/branchdetail.routes');
const branchusergroupmapperRoutes = require('../modules/branchusergroupmapper/branchusergroupmapper.routes');
const batchdetailRoutes = require('../modules/batchdetail/batchdetail.routes');
const itemdetailRoutes = require('../modules/itemdetail/itemdetail.routes');
const transactiontypebaseconversionRoutes = require('../modules/transactiontypebaseconversion/transactiontypebaseconversion.routes');
const transactiondetaillogRoutes = require('../modules/transactiondetaillog/transactiondetaillog.routes');
const transactionitemdetailRoutes = require('../modules/transactionitemdetail/transactionitemdetail.routes');
const transactiontypeconversionmapperRoutes = require('../modules/transactiontypeconversionmapper/transactiontypeconversionmapper.routes');
const paymentreceivedtypeRoutes = require('../modules/paymentreceivedtype/paymentreceivedtype.routes');
const paymentmodeRoutes = require('../modules/paymentmode/paymentmode.routes');
const paymentmodetransactiondetailRoutes = require('../modules/paymentmodetransactiondetail/paymentmodetransactiondetail.routes');
const paymentdetailRoutes = require('../modules/paymentdetail/paymentdetail.routes');
const paymentbreakupRoutes = require('../modules/paymentbreakup/paymentbreakup.routes');
const transactiontypeRoutes = require('../modules/transactiontype/transactiontype.routes');
const accounttypebaseRoutes = require('../modules/accounttypebase/accounttypebase.routes');

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

  // Tax Type module - Tax type CRUD operations
  app.use('/api/taxtypes', taxtypeRoutes);

  // UOM module - Unit of Measure CRUD operations
  app.use('/api/uom', uomRoutes);

  // Category module - Category CRUD operations
  app.use('/api/categories', categoryRoutes);

  // Transaction Type Config module
  app.use('/api/transactiontypeconfigs', transactiontypeconfigRoutes);

  // Organization module
  app.use('/api/organizations', organizationRoutes);

  // UOM Factor module
  app.use('/api/uomfactors', uomfactorRoutes);

  // Account Type module
  app.use('/api/accounttypes', accounttypeRoutes);

  // Transaction Type Status module
  app.use('/api/transactiontypestatuses', transactiontypestatusRoutes);

  // Contact Address Type module
  app.use('/api/contactaddresstypes', contactaddresstypeRoutes);

  // Tax Group module
  app.use('/api/taxgroups', taxgroupRoutes);

  // Tax Group Tax Type Mapper module
  app.use('/api/taxgrouptaxtypemappers', taxgrouptaxtypemapperRoutes);

  // Map Provider module
  app.use('/api/mapproviders', mapproviderRoutes);

  // Location Detail module
  app.use('/api/locationdetails', locationdetailRoutes);

  // Map Provider Location Mapper module
  app.use('/api/mapproviderlocationmappers', mapproviderlocationmapperRoutes);

  // Contact Detail module
  app.use('/api/contactdetails', contactdetailRoutes);

  // Address Detail module
  app.use('/api/addressdetails', addressdetailRoutes);

  // Cost Info module
  app.use('/api/costinfos', costinfoRoutes);

  // Branch Detail module
  app.use('/api/branchdetails', branchdetailRoutes);

  // Branch User Group Mapper module
  app.use('/api/branchusergroupmappers', branchusergroupmapperRoutes);

  // Batch Detail module
  app.use('/api/batchdetails', batchdetailRoutes);

  // Item Detail module
  app.use('/api/itemdetails', itemdetailRoutes);

  // Transaction Type Base Conversion module
  app.use(
    '/api/transactiontypebaseconversions',
    transactiontypebaseconversionRoutes
  );

  // Transaction Detail Log module
  app.use('/api/transactiondetaillogs', transactiondetaillogRoutes);

  // Transaction Item Detail module
  app.use('/api/transactionitemdetails', transactionitemdetailRoutes);

  // Transaction Type Conversion Mapper module
  app.use(
    '/api/transactiontypeconversionmappers',
    transactiontypeconversionmapperRoutes
  );

  // Payment Received Type module
  app.use('/api/paymentreceivedtypes', paymentreceivedtypeRoutes);

  // Payment Mode module
  app.use('/api/paymentmodes', paymentmodeRoutes);

  // Payment Mode Transaction Detail module
  app.use(
    '/api/paymentmodetransactiondetails',
    paymentmodetransactiondetailRoutes
  );

  // Payment Detail module
  app.use('/api/paymentdetails', paymentdetailRoutes);

  // Payment Breakup module
  app.use('/api/paymentbreakups', paymentbreakupRoutes);

  // Transaction Type module
  app.use('/api/transactiontypes', transactiontypeRoutes);

  // Account Type Base module
  app.use('/api/accounttypebases', accounttypebaseRoutes);

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
        { name: 'taxtypes', path: '/api/taxtypes' },
        { name: 'uom', path: '/api/uom' },
        { name: 'categories', path: '/api/categories' },
        { name: 'transactiontypeconfigs', path: '/api/transactiontypeconfigs' },
        { name: 'organizations', path: '/api/organizations' },
        { name: 'uomfactors', path: '/api/uomfactors' },
        { name: 'accounttypes', path: '/api/accounttypes' },
        {
          name: 'transactiontypestatuses',
          path: '/api/transactiontypestatuses',
        },
        { name: 'contactaddresstypes', path: '/api/contactaddresstypes' },
        { name: 'taxgroups', path: '/api/taxgroups' },
        { name: 'taxgrouptaxtypemappers', path: '/api/taxgrouptaxtypemappers' },
        { name: 'mapproviders', path: '/api/mapproviders' },
        { name: 'locationdetails', path: '/api/locationdetails' },
        {
          name: 'mapproviderlocationmappers',
          path: '/api/mapproviderlocationmappers',
        },
        { name: 'contactdetails', path: '/api/contactdetails' },
        { name: 'addressdetails', path: '/api/addressdetails' },
        { name: 'costinfos', path: '/api/costinfos' },
        { name: 'branchdetails', path: '/api/branchdetails' },
        { name: 'branchusergroupmappers', path: '/api/branchusergroupmappers' },
        { name: 'batchdetails', path: '/api/batchdetails' },
        { name: 'itemdetails', path: '/api/itemdetails' },
        {
          name: 'transactiontypebaseconversions',
          path: '/api/transactiontypebaseconversions',
        },
        { name: 'transactiondetaillogs', path: '/api/transactiondetaillogs' },
        { name: 'transactionitemdetails', path: '/api/transactionitemdetails' },
        {
          name: 'transactiontypeconversionmappers',
          path: '/api/transactiontypeconversionmappers',
        },
        { name: 'paymentreceivedtypes', path: '/api/paymentreceivedtypes' },
        { name: 'paymentmodes', path: '/api/paymentmodes' },
        {
          name: 'paymentmodetransactiondetails',
          path: '/api/paymentmodetransactiondetails',
        },
        { name: 'paymentdetails', path: '/api/paymentdetails' },
        { name: 'paymentbreakups', path: '/api/paymentbreakups' },
        { name: 'transactiontypes', path: '/api/transactiontypes' },
        { name: 'accounttypebases', path: '/api/accounttypebases' },
      ],
    });
  });
};

module.exports = { registerRoutes };
