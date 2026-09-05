// src/modules/mastersetup/mastersetup.service.js
// First-time master-data bootstrap orchestrator.
//
// Creates the whole Organization → Branch(→ Address → Contact → TxnConfig) →
// Item(→ Category → UOM → CostInfo → TaxGroup) tree in a SINGLE transaction.
// Every insert reuses the owning module's createTx (prepareInsertParams +
// INSERT), so field mapping/SQL stays DRY. If any step fails, withTransaction
// rolls the whole thing back — nothing is persisted.

const { withTransaction } = require('../../utils/dbHelper');
const { logger } = require('../../utils/logger');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const setupRepository = require('./mastersetup.repository');

const organization = require('../organization/organization.service');
const contactAddressType = require('../contactaddresstype/contactaddresstype.service');
const mapProvider = require('../mapprovider/mapprovider.service');
const locationDetail = require('../locationdetail/locationdetail.service');
const mapProviderLocationMapper = require('../mapproviderlocationmapper/mapproviderlocationmapper.service');
const addressDetail = require('../addressdetail/addressdetail.service');
const contactDetail = require('../contactdetail/contactdetail.service');
const transactionTypeConfig = require('../transactiontypeconfig/transactiontypeconfig.service');
const branchDetail = require('../branchdetail/branchdetail.service');
const taxGroup = require('../taxgroup/taxgroup.service');
// The rates that make a tax group mean something. Shared with the bulk import,
// so the wizard and the CSV cannot disagree about what a tax type is.
const taxComponents = require('../taxgroup/taxgroup.components');
const costInfo = require('../costinfo/costinfo.service');
const category = require('../category/category.service');
const uom = require('../uom/uom.service');
const itemDetail = require('../itemdetail/itemdetail.service');
const { provisionPosMasters } = require('./posMasters.provision');

/**
 * Create the full master-data tree atomically.
 *
 * Runs exactly once per tenant: on success the tenant is marked COMPLETED in
 * tenant_setup (inside the same transaction), and any later call is rejected
 * with 409. That is the server-side half of "the wizard is never offered twice"
 * — hiding the menu entry alone would not stop a replayed request from
 * duplicating the org/branch tree.
 *
 * @param {Object} payload - Validated nested payload (see mastersetup.schemas).
 * @param {string} tenantId - Tenant ID.
 * @param {string} userPhone - Acting user's email.
 * @returns {Promise<Object>} Map of every created entity → generated id.
 * @throws {HttpError} 409 when this tenant has already completed setup.
 */
const bootstrap = async (payload, tenantId, userPhone) => {
  logger.info('Master-data bootstrap started', { tenantId, userPhone });

  if (await setupRepository.isSetupComplete(tenantId)) {
    logger.warn('Master-data bootstrap rejected — already completed', { tenantId });
    throw new HttpError(
      MESSAGES.ERROR.TENANT_SETUP_ALREADY_DONE,
      MESSAGES.HTTP_STATUS.CONFLICT
    );
  }

  const ids = await withTransaction(async (conn) => {
    const created = {};

    // 1) Organization ---------------------------------------------------------
    const org = await organization.createTx(conn, payload.organization, tenantId, userPhone);
    created.organization = org.id;

    // 2) Branch subtree (bottom-up so FKs resolve) ----------------------------
    const b = payload.branch;

    // 2a) Address → location mapper chain (mapper is optional; built all-or-nothing)
    let mapperId = null;
    if (b.address.locationMapper) {
      const provider = await mapProvider.createTx(conn, b.address.locationMapper.mapProvider, tenantId, userPhone);
      const location = await locationDetail.createTx(conn, b.address.locationMapper.locationDetail, tenantId, userPhone);
      const mapper = await mapProviderLocationMapper.createTx(
        conn,
        { ...b.address.locationMapper, MapProviderId: provider.id, LocationDetailId: location.id },
        tenantId,
        userPhone,
      );
      mapperId = mapper.id;
      Object.assign(created, {
        mapProvider: provider.id,
        locationDetail: location.id,
        locationMapper: mapper.id,
      });
    }
    // Address type is reused if a same-named type already exists for the tenant
    // (UNIQUE(Name, TenantId)); otherwise it is created. The wizard sends the
    // fixed 'Onboarding' type, so repeated onboarding reuses the same row.
    const addrType = await contactAddressType.getOrCreateByNameTx(
      conn,
      b.address.contactAddressType.Name,
      tenantId,
      userPhone,
    );
    const address = await addressDetail.createTx(
      conn,
      { ...b.address, MapProviderLocationMapperId: mapperId, ContactAddressTypeId: addrType.id },
      tenantId,
      userPhone,
    );

    // 2b) Contact + transaction type config
    const contact = await contactDetail.createTx(conn, b.contact, tenantId, userPhone);
    // Transaction type config is reused if a same-TagName config already exists
    // for the tenant (UNIQUE TagName); otherwise it is created. The wizard sends
    // the fixed 'Onboarding' TagName, so repeated onboarding reuses the same row.
    const ttc = await transactionTypeConfig.getOrCreateByTagNameTx(conn, b.transactionTypeConfig, tenantId, userPhone);

    // 2c) Branch (needs org + contact + address + txn-config)
    const branch = await branchDetail.createTx(
      conn,
      {
        ...b,
        OrganizationDetailId: org.id,
        ContactDetailId: contact.id,
        AddressDetailId: address.id,
        TransactionTypeConfigId: ttc.id,
      },
      tenantId,
      userPhone,
    );

    Object.assign(created, {
      contactAddressType: addrType.id,
      address: address.id,
      contact: contact.id,
      transactionTypeConfig: ttc.id,
      branch: branch.id,
    });

    // 2e) Standard POS + ledger masters (payment modes, statuses, 'POS Sale'
    // type, permitted transitions, accounts, received types). Seeded here so a
    // brand-new tenant can settle bills and post to the ledger immediately —
    // no per-tenant seed script. Idempotent + atomic with the rest of setup.
    await provisionPosMasters(conn, { tenantId, configId: ttc.id }, userPhone);

    // 3) Item subtree (optional) ---------------------------------------------
    if (payload.item) {
      const it = payload.item;
      const cat = await category.createTx(conn, it.category, tenantId, userPhone);
      const unit = await uom.createTx(conn, it.uom, tenantId, userPhone);

      // The tax group, and the RATES inside it.
      //
      // `taxTypes` is deliberately not part of the taxgroup row — the group is a
      // container and the rates are mapped into it. Creating the container and
      // stopping is what this did, so a group named "GST 18%" charged 0% and the
      // starter item's price was wrong from the first bill onwards.
      //
      // A payload that states no rates gets the same standard split the bulk
      // import applies, for the same reason: a menu priced at 0% is the worse
      // failure. The wizard announces it before sending.
      const { taxTypes, ...taxGroupRow } = it.costInfo.taxGroup;
      const tax = await taxGroup.createTx(conn, taxGroupRow, tenantId, userPhone);
      const rates = (taxTypes && taxTypes.length > 0)
        ? taxTypes.map((t) => ({ name: t.Name, value: t.Value }))
        : taxComponents.defaultComponents();
      await taxComponents.attachComponentsTx(conn, {
        taxGroupId: tax.id, components: rates, tenantId, userPhone,
      });

      const cost = await costInfo.createTx(conn, { ...it.costInfo, TaxGroupId: tax.id }, tenantId, userPhone);
      const item = await itemDetail.createTx(
        conn,
        { ...it, CategoryId: cat.id, UOMId: unit.id, CostInfoId: cost.id },
        tenantId,
        userPhone,
      );

      Object.assign(created, {
        category: cat.id,
        uom: unit.id,
        taxGroup: tax.id,
        costInfo: cost.id,
        item: item.id,
      });
    }

    // 4) Mark the tenancy set up ------------------------------------------------
    // Inside the transaction on purpose: if any step above fails, the rollback
    // takes this with it and the tenant stays gated. A tenant must never be
    // unlocked by a bootstrap that did not actually persist its master data.
    await setupRepository.markCompletedTx(conn, tenantId, userPhone);

    return created;
  });

  logger.info('Master-data bootstrap completed', { tenantId, createdCount: Object.keys(ids).length });
  return ids;
};

/**
 * Reads the first-time setup status for a tenant.
 * @param {string} tenantId - Tenant ID.
 * @returns {Promise<Object>} { tenantId, status, completedAt, completedBy, isComplete }
 */
const getStatus = (tenantId) => setupRepository.getStatus(tenantId);

module.exports = { bootstrap, getStatus };
