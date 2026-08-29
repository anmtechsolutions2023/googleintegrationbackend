// src/config/routes.js
// Centralized route configuration and registration.
// All module routes are imported and registered here.

const { requireTenantSetup } = require('../middleware/setupGate');

const authRoutes = require('../modules/auth/auth.routes');
const onboardingRoutes = require('../modules/onboarding/onboarding.routes');
const adminRoutes = require('../modules/admin/admin.routes');
const appconfigRoutes = require('../modules/appconfig/appconfig.routes');
const invitationRoutes = require('../modules/invitation/invitation.routes');
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
const mastersetupRoutes = require('../modules/mastersetup/mastersetup.routes');
const importRoutes = require('../modules/import/import.routes');
const pricingRoutes = require('../modules/pricing/pricing.routes');
const ledgerRoutes = require('../modules/ledger/ledger.routes');
const poscashsessionRoutes = require('../modules/poscashsession/poscashsession.routes');
const assetRoutes = require('../modules/asset/asset.routes');
const assetcategoryRoutes = require('../modules/assetcategory/assetcategory.routes');
const expensecategoryRoutes = require('../modules/expensecategory/expensecategory.routes');
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

// POS (Front Desk) modules
const posfloorRoutes = require('../modules/posfloor/posfloor.routes');
const postableRoutes = require('../modules/postable/postable.routes');
const positemmetaRoutes = require('../modules/positemmeta/positemmeta.routes');
const poschannelRoutes = require('../modules/poschannel/poschannel.routes');
const posreturnreasonRoutes = require('../modules/posreturnreason/posreturnreason.routes');
const posvariantRoutes = require('../modules/posvariant/posvariant.routes');
const posfoodtypeRoutes = require('../modules/posfoodtype/posfoodtype.routes');
const poscustomerRoutes = require('../modules/poscustomer/poscustomer.routes');
const loyaltyRoutes = require('../modules/loyalty/loyalty.routes');
const posorderRoutes = require('../modules/posorder/posorder.routes');
const poskotRoutes = require('../modules/poskot/poskot.routes');
const posbillRoutes = require('../modules/posbill/posbill.routes');
const posonlineorderRoutes = require('../modules/posonlineorder/posonlineorder.routes');
const posportalRoutes = require('../modules/posportal/posportal.routes');
// The one router that is NOT behind authenticateToken — a portal has no user.
// Its signature check is its authentication; see poswebhook.auth.js.
const poswebhookRoutes = require('../modules/poswebhook/poswebhook.routes');
const posfeedbackRoutes = require('../modules/posfeedback/posfeedback.routes');
const postokenRoutes = require('../modules/postoken/postoken.routes');
const possettingRoutes = require('../modules/possetting/possetting.routes');
const receiptFormatRoutes = require('../modules/posreceipt/receipt.format.routes');
const offerRoutes = require('../modules/posoffer/offer.routes');
const posbranchRoutes = require('../modules/posbranch/posbranch.routes');
const posexpenseRoutes = require('../modules/posexpense/posexpense.routes');
const posreportRoutes = require('../modules/posreport/posreport.routes');

/**
 * Registers all application routes with the Express app.
 * @param {Object} app - Express application instance.
 */
const registerRoutes = (app) => {
  // First-time tenancy setup gate. Registered BEFORE every module router so a
  // tenant that has not completed the setup wizard cannot reach any feature by
  // direct URL. Its own allowlist (constants.TENANT_SETUP.ALLOWED_PATH_PREFIXES)
  // keeps auth, onboarding, logout, audit logs and the wizard itself reachable.
  app.use(requireTenantSetup);

  // Authentication module - Google OAuth
  app.use('/api/auth', authRoutes);

  // Onboarding module - Guest/pending user status + note
  app.use('/api/onboarding', onboardingRoutes);

  // Application Configuration - super-admin global settings (mounted before the
  // broader /api/admin router so this more specific path wins).
  app.use('/api/admin/app-config', appconfigRoutes);

  // Tenant invitations — mounted BEFORE the broader /api/admin router so this
  // more specific path wins, matching how app-config is mounted above.
  app.use('/api/admin/invitations', invitationRoutes);

  // Admin module - IAM panel (onboarding approval, user/role/feature management)
  app.use('/api/admin', adminRoutes);

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

  // Master-data setup — first-time transactional bootstrap (org + branch + item)
  app.use('/api/master-data', mastersetupRoutes);
  // Bulk import. Its own prefix because one run writes across master data AND
  // the POS menu, so it belongs to neither — and a new mount cannot be
  // swallowed by a ':id' route in a router that already exists.
  app.use('/api/import', importRoutes);

  // Pricing — stateless tax/price calculation over the costinfo → taxgroup →
  // mapper → TaxTypes chain. Shared by master data, POS and billing.
  app.use('/api/pricing', pricingRoutes);

  // Accounting ledger — settled sales and expenses as numbered, immutable
  // documents, plus the financial reporting engine (/api/ledger/reports/*).
  app.use('/api/ledger', ledgerRoutes);

  // Cash sessions — a cashier's shift at a till, and the day-close variance.
  app.use('/api/pos/cash-sessions', poscashsessionRoutes);

  // Fixed-asset register and its category master.
  app.use('/api/assets', assetRoutes);
  app.use('/api/asset-categories', assetcategoryRoutes);

  // Expense category master — the analysis axis for spend.
  app.use('/api/expense-categories', expensecategoryRoutes);

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

  // ── POS (Front Desk) modules ──
  app.use('/api/pos/floors', posfloorRoutes);
  app.use('/api/pos/tables', postableRoutes);
  app.use('/api/pos/item-meta', positemmetaRoutes);
  app.use('/api/pos/channels', poschannelRoutes);
  app.use('/api/pos/return-reasons', posreturnreasonRoutes);
  app.use('/api/pos/variants', posvariantRoutes);
  app.use('/api/pos/food-types', posfoodtypeRoutes);
  app.use('/api/pos/customers', poscustomerRoutes);
  app.use('/api/pos/loyalty', loyaltyRoutes);
  app.use('/api/pos/orders', posorderRoutes);
  app.use('/api/pos/kots', poskotRoutes);
  app.use('/api/pos/bills', posbillRoutes);
  app.use('/api/pos/online-orders', posonlineorderRoutes);
  app.use('/api/pos/portals', posportalRoutes);
  // Mounted alongside the rest, but deliberately outside the tenant-JWT model:
  // it authenticates each request against the portal's own shared secret and
  // resolves the tenant FROM that credential, never from the payload.
  app.use('/api/pos/portal-webhooks', poswebhookRoutes);
  app.use('/api/pos/feedback', posfeedbackRoutes);
  app.use('/api/pos/tokens', postokenRoutes);
  app.use('/api/pos/settings', possettingRoutes);
  // What prints on paper, per branch. Beside settings because that is what it
  // is — but its own module: the catalogue of printable fields, their legal
  // locks and their defaults is a different concern from token numbering.
  app.use('/api/pos/receipt-format', receiptFormatRoutes);
  // Campaigns and the offers inside them. An offer is not a second way to price
  // a bill — the engine produces the same per-line discounts the till already
  // takes, so posbill.recomputeTotals stays the only pricing path.
  app.use('/api/pos', offerRoutes);
  app.use('/api/pos/branches', posbranchRoutes);
  app.use('/api/pos/expenses', posexpenseRoutes);
  app.use('/api/pos/reports', posreportRoutes);

  // Health check / root endpoint
  app.get('/', (req, res) => {
    res.json({
      message: 'Google Integration Backend API',
      version: '1.0.0',
      status: 'running',
      modules: [
        { name: 'auth', path: '/api/auth' },
        { name: 'onboarding', path: '/api/onboarding' },
        { name: 'admin', path: '/api/admin' },
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
        { name: 'pricing', path: '/api/pricing' },
        { name: 'ledger', path: '/api/ledger' },
        { name: 'cash-sessions', path: '/api/pos/cash-sessions' },
        { name: 'assets', path: '/api/assets' },
        { name: 'asset-categories', path: '/api/asset-categories' },
        { name: 'expense-categories', path: '/api/expense-categories' },
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
        { name: 'pos-floors', path: '/api/pos/floors' },
        { name: 'pos-tables', path: '/api/pos/tables' },
        { name: 'pos-item-meta', path: '/api/pos/item-meta' },
        { name: 'pos-channels', path: '/api/pos/channels' },
        { name: 'pos-return-reasons', path: '/api/pos/return-reasons' },
        { name: 'pos-portals', path: '/api/pos/portals' },
        { name: 'pos-variants', path: '/api/pos/variants' },
        { name: 'pos-food-types', path: '/api/pos/food-types' },
        { name: 'pos-customers', path: '/api/pos/customers' },
        { name: 'pos-loyalty', path: '/api/pos/loyalty' },
        { name: 'pos-orders', path: '/api/pos/orders' },
        { name: 'pos-kots', path: '/api/pos/kots' },
        { name: 'pos-bills', path: '/api/pos/bills' },
        { name: 'pos-online-orders', path: '/api/pos/online-orders' },
        { name: 'pos-feedback', path: '/api/pos/feedback' },
        { name: 'pos-tokens', path: '/api/pos/tokens' },
        { name: 'pos-expenses', path: '/api/pos/expenses' },
        { name: 'pos-reports', path: '/api/pos/reports' },
      ],
    });
  });
};

module.exports = { registerRoutes };
