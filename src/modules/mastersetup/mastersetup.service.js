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
const costInfo = require('../costinfo/costinfo.service');
const category = require('../category/category.service');
const uom = require('../uom/uom.service');
const itemDetail = require('../itemdetail/itemdetail.service');

/**
 * Create the full master-data tree atomically.
 * @param {Object} payload - Validated nested payload (see mastersetup.schemas).
 * @param {string} tenantId - Tenant ID.
 * @param {string} userEmail - Acting user's email.
 * @returns {Promise<Object>} Map of every created entity → generated id.
 */
const bootstrap = async (payload, tenantId, userEmail) => {
  logger.info('Master-data bootstrap started', { tenantId, userEmail });

  const ids = await withTransaction(async (conn) => {
    const created = {};

    // 1) Organization ---------------------------------------------------------
    const org = await organization.createTx(conn, payload.organization, tenantId, userEmail);
    created.organization = org.id;

    // 2) Branch subtree (bottom-up so FKs resolve) ----------------------------
    const b = payload.branch;

    // 2a) Address → location mapper chain (mapper is optional; built all-or-nothing)
    let mapperId = null;
    if (b.address.locationMapper) {
      const provider = await mapProvider.createTx(conn, b.address.locationMapper.mapProvider, tenantId, userEmail);
      const location = await locationDetail.createTx(conn, b.address.locationMapper.locationDetail, tenantId, userEmail);
      const mapper = await mapProviderLocationMapper.createTx(
        conn,
        { ...b.address.locationMapper, MapProviderId: provider.id, LocationDetailId: location.id },
        tenantId,
        userEmail,
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
      userEmail,
    );
    const address = await addressDetail.createTx(
      conn,
      { ...b.address, MapProviderLocationMapperId: mapperId, ContactAddressTypeId: addrType.id },
      tenantId,
      userEmail,
    );

    // 2b) Contact + transaction type config
    const contact = await contactDetail.createTx(conn, b.contact, tenantId, userEmail);
    // Transaction type config is reused if a same-TagName config already exists
    // for the tenant (UNIQUE TagName); otherwise it is created. The wizard sends
    // the fixed 'Onboarding' TagName, so repeated onboarding reuses the same row.
    const ttc = await transactionTypeConfig.getOrCreateByTagNameTx(conn, b.transactionTypeConfig, tenantId, userEmail);

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
      userEmail,
    );

    Object.assign(created, {
      contactAddressType: addrType.id,
      address: address.id,
      contact: contact.id,
      transactionTypeConfig: ttc.id,
      branch: branch.id,
    });

    // 3) Item subtree (optional) ---------------------------------------------
    if (payload.item) {
      const it = payload.item;
      const cat = await category.createTx(conn, it.category, tenantId, userEmail);
      const unit = await uom.createTx(conn, it.uom, tenantId, userEmail);
      const tax = await taxGroup.createTx(conn, it.costInfo.taxGroup, tenantId, userEmail);
      const cost = await costInfo.createTx(conn, { ...it.costInfo, TaxGroupId: tax.id }, tenantId, userEmail);
      const item = await itemDetail.createTx(
        conn,
        { ...it, CategoryId: cat.id, UOMId: unit.id, CostInfoId: cost.id },
        tenantId,
        userEmail,
      );

      Object.assign(created, {
        category: cat.id,
        uom: unit.id,
        taxGroup: tax.id,
        costInfo: cost.id,
        item: item.id,
      });
    }

    return created;
  });

  logger.info('Master-data bootstrap completed', { tenantId, createdCount: Object.keys(ids).length });
  return ids;
};

module.exports = { bootstrap };
