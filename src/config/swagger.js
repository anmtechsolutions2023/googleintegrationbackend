// src/config/swagger.js

const paginationParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1 }, description: 'Page number' },
  { name: 'limit', in: 'query', schema: { type: 'integer', default: 10, minimum: 1, maximum: 100 }, description: 'Items per page' },
];
const expandParam = { name: 'expand', in: 'query', schema: { type: 'boolean', default: false }, description: 'Include joined/related fields' };
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'Record UUID' };
const security = [{ bearerAuth: [] }];

const responses = {
  unauthorized: { 401: { description: 'Unauthorized — missing or invalid bearer token' } },
  forbidden:    { 403: { description: 'Forbidden — insufficient scope, OR the tenant has not completed first-time setup (body carries `code: "TENANT_SETUP_REQUIRED"`; send the user to the setup wizard). Super admins are exempt from the setup gate.' } },
  notFound:     { 404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } } },
  noContent:    { 204: { description: 'Deleted successfully — no content' } },
  validation:   { 400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } } },
};

function paginatedResponse(schemaName) {
  return {
    200: {
      description: 'Success',
      content: { 'application/json': { schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: { type: 'array', items: { $ref: `#/components/schemas/${schemaName}` } },
          pagination: { $ref: '#/components/schemas/Pagination' },
        },
      }}},
    },
  };
}

function singleResponse(schemaName, status = 200) {
  return {
    [status]: {
      description: status === 201 ? 'Created' : 'Success',
      content: { 'application/json': { schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: { $ref: `#/components/schemas/${schemaName}` },
        },
      }}},
    },
  };
}

function crudPaths(tag, path, createRef, updateRef, responseRef, hasExpand = true) {
  const listParams = hasExpand ? [...paginationParams, expandParam] : [...paginationParams];
  const byIdParams = hasExpand ? [idParam, expandParam] : [idParam];
  return {
    [path]: {
      get: {
        tags: [tag], summary: `List ${tag}`, security,
        parameters: listParams,
        responses: { ...paginatedResponse(responseRef), ...responses.unauthorized },
      },
      post: {
        tags: [tag], summary: `Create ${tag}`, security,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${createRef}` } } } },
        responses: { ...singleResponse(responseRef, 201), ...responses.validation, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    [`${path}/{id}`]: {
      get: {
        tags: [tag], summary: `Get ${tag} by ID`, security,
        parameters: byIdParams,
        responses: { ...singleResponse(responseRef), ...responses.notFound, ...responses.unauthorized },
      },
      put: {
        tags: [tag], summary: `Update ${tag}`, security,
        parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${updateRef}` } } } },
        responses: { ...singleResponse(responseRef), ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
      delete: {
        tags: [tag], summary: `Delete ${tag}`, security,
        parameters: [idParam],
        responses: { ...responses.noContent, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
  };
}

// ── Reports ──────────────────────────────────────────────────────────────────
// Every report takes ONE query contract (ledger.schemas.reportQuerySchema), so
// the timeframe is described once here rather than nine times. Daily, last-3,
// weekend-only and custom are `preset` values, not separate endpoints — which
// is what stops mix-and-match becoming a combinatorial pile of paths.
const reportParams = [
  { name: 'preset', in: 'query', schema: { type: 'string', enum: ['today', 'yesterday', 'last3', 'last5', 'week', 'weekend', 'month', 'custom'], default: 'today' }, description: 'Timeframe. `custom` REQUIRES fromDate and toDate.' },
  { name: 'fromDate', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Required when preset=custom. Range may not exceed 366 days.' },
  { name: 'toDate', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Required when preset=custom.' },
  { name: 'bucket', in: 'query', schema: { type: 'string', enum: ['day', 'week', 'month'], default: 'day' }, description: 'Trend granularity, where the report has a trend.' },
  { name: 'branchId', in: 'query', schema: { type: 'string', format: 'uuid' } },
  { name: 'floorId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Venue bound. Matches the venue SNAPSHOT frozen on each round, so it means "served there at the time".' },
  { name: 'tableId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Venue bound, as above.' },
  { name: 'categoryId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Product report only.' },
  { name: 'itemId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Product report only.' },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200 }, description: 'Leaderboard cap, where the report ranks rows.' },
];

/** One GET report endpoint. Same shape for all of them — only the payload differs. */
function reportPath(tag, summary, schemaRef, description) {
  return {
    get: {
      tags: [tag], summary, description, security,
      parameters: reportParams,
      responses: {
        ...singleResponse(schemaRef),
        ...responses.validation, ...responses.unauthorized, ...responses.forbidden,
      },
    },
  };
}

/** The resolved window every report echoes back, so a caller can label its own output. */
const reportRange = {
  type: 'object',
  properties: {
    from: { type: 'string', format: 'date' },
    to: { type: 'string', format: 'date' },
    bucket: { type: 'string', enum: ['day', 'week', 'month'] },
    weekendOnly: { type: 'boolean', description: 'True for preset=weekend — the same window as `week` with a filter on top.' },
    preset: { type: 'string' },
  },
};

/** Money columns shared by every per-row revenue breakdown. */
const revenueRow = {
  Orders: { type: 'number' },
  Bills: { type: 'number' },
  NetAmount: { type: 'number' },
  DiscountAmount: { type: 'number' },
  TaxAmount: { type: 'number' },
  GrossAmount: { type: 'number' },
};

const auditFields = {
  Id:        { type: 'string', format: 'uuid', readOnly: true, example: 'a1b2c3d4-0000-0000-0000-000000000001' },
  TenantId:  { type: 'string', format: 'uuid', readOnly: true },
  Active:    { type: 'integer', enum: [0, 1], readOnly: true },
  CreatedOn: { type: 'string', format: 'date-time', readOnly: true },
  CreatedBy: { type: 'string', readOnly: true },
  UpdatedOn: { type: 'string', format: 'date-time', readOnly: true, nullable: true },
  UpdatedBy: { type: 'string', readOnly: true },
};

const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Google Integration Backend API',
    version: '1.0.0',
    description: 'Full CRUD REST API for all modules. Authenticate using a Bearer JWT token.',
  },
  servers: [{ url: 'http://localhost:3001', description: 'Local development server' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {

      // ─── Common ────────────────────────────────────────────────────────────
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', example: 1 },
          limit: { type: 'integer', example: 10 },
          total: { type: 'integer', example: 25 },
          totalPages: { type: 'integer', example: 3 },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Validation error: "Name" is required' },
        },
      },

      // ─── TaxTypes ──────────────────────────────────────────────────────────
      TaxTypeCreate: {
        type: 'object', required: ['Name', 'Value'],
        properties: {
          Name:   { type: 'string', maxLength: 50, example: 'GST' },
          Value:  { type: 'string', maxLength: 50, example: '18' },
          Active: { type: 'boolean', default: true },
        },
      },
      TaxTypeUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          Name:   { type: 'string', maxLength: 50 },
          Value:  { type: 'string', maxLength: 50 },
          Active: { type: 'boolean' },
        },
      },
      TaxType: {
        type: 'object',
        properties: { ...auditFields, Name: { type: 'string' }, Value: { type: 'string' } },
      },

      // ─── UOM ───────────────────────────────────────────────────────────────
      UOMCreate: {
        type: 'object', required: ['UnitName'],
        properties: {
          UnitName:  { type: 'string', maxLength: 50, example: 'KG' },
          IsPrimary: { type: 'boolean', default: false },
          Active:    { type: 'boolean', default: true },
        },
      },
      UOMUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          UnitName:  { type: 'string', maxLength: 50 },
          IsPrimary: { type: 'boolean' },
          Active:    { type: 'boolean' },
        },
      },
      UOM: {
        type: 'object',
        properties: { ...auditFields, UnitName: { type: 'string' }, IsPrimary: { type: 'integer' } },
      },

      // ─── Category ──────────────────────────────────────────────────────────
      CategoryCreate: {
        type: 'object', required: ['Name'],
        properties: {
          Name:   { type: 'string', maxLength: 50, example: 'Electronics' },
          Active: { type: 'boolean', default: true },
        },
      },
      CategoryUpdate: {
        type: 'object', minProperties: 1,
        properties: { Name: { type: 'string', maxLength: 50 }, Active: { type: 'boolean' } },
      },
      Category: {
        type: 'object',
        properties: { ...auditFields, Name: { type: 'string' } },
      },

      // ─── TransactionTypeConfig ─────────────────────────────────────────────
      TransactionTypeConfigCreate: {
        type: 'object', required: ['StartCounterNo', 'Prefix', 'Format'],
        properties: {
          StartCounterNo: { type: 'string', maxLength: 50, example: '1001' },
          Prefix:         { type: 'string', maxLength: 50, example: 'INV' },
          Format:         { type: 'string', maxLength: 100, example: 'INV-{YYYY}-{SEQ}' },
          TagName:        { type: 'string', maxLength: 100, nullable: true, example: 'SALES_INVOICE' },
          Active:         { type: 'boolean', default: true },
        },
      },
      TransactionTypeConfigUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          StartCounterNo: { type: 'string', maxLength: 50 },
          Prefix:         { type: 'string', maxLength: 50 },
          Format:         { type: 'string', maxLength: 100 },
          TagName:        { type: 'string', maxLength: 100, nullable: true },
          Active:         { type: 'boolean' },
        },
      },
      TransactionTypeConfig: {
        type: 'object',
        properties: { ...auditFields, StartCounterNo: { type: 'string' }, Prefix: { type: 'string' }, Format: { type: 'string' }, TagName: { type: 'string', nullable: true } },
      },

      // ─── Organization ──────────────────────────────────────────────────────
      OrganizationCreate: {
        type: 'object', required: ['Name'],
        properties: {
          Name:   { type: 'string', maxLength: 100, example: 'Acme Corp' },
          Active: { type: 'boolean', default: true },
        },
      },
      OrganizationUpdate: {
        type: 'object', minProperties: 1,
        properties: { Name: { type: 'string', maxLength: 100 }, Active: { type: 'boolean' } },
      },
      Organization: {
        type: 'object',
        properties: { ...auditFields, Name: { type: 'string' } },
      },

      // ─── UOMFactor ─────────────────────────────────────────────────────────
      UOMFactorCreate: {
        type: 'object', required: ['PrimaryUOMId', 'SecondaryUOMId', 'Factor'],
        properties: {
          PrimaryUOMId:   { type: 'string', format: 'uuid', example: 'uuid-of-primary-uom' },
          SecondaryUOMId: { type: 'string', format: 'uuid', example: 'uuid-of-secondary-uom' },
          Factor:         { type: 'string', maxLength: 50, example: '1000' },
          Active:         { type: 'boolean', default: true },
        },
      },
      UOMFactorUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          PrimaryUOMId:   { type: 'string', format: 'uuid' },
          SecondaryUOMId: { type: 'string', format: 'uuid' },
          Factor:         { type: 'string', maxLength: 50 },
          Active:         { type: 'boolean' },
        },
      },
      UOMFactor: {
        type: 'object',
        properties: { ...auditFields, PrimaryUOMId: { type: 'string' }, SecondaryUOMId: { type: 'string' }, Factor: { type: 'string' } },
      },

      // ─── TransactionType ───────────────────────────────────────────────────
      TransactionTypeCreate: {
        type: 'object', required: ['Name', 'TransactionTypeConfigId'],
        properties: {
          Name:                   { type: 'string', maxLength: 100, example: 'Sales Invoice' },
          TransactionTypeConfigId: { type: 'string', format: 'uuid', example: '178b49a3-f3ed-4275-9cd7-d746d1476b72' },
          Active:                 { type: 'boolean', default: true },
        },
      },
      TransactionTypeUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          Name:                   { type: 'string', maxLength: 100 },
          TransactionTypeConfigId: { type: 'string', format: 'uuid' },
          Active:                 { type: 'boolean' },
        },
      },
      TransactionType: {
        type: 'object',
        properties: { ...auditFields, Name: { type: 'string' }, TransactionTypeConfigId: { type: 'string' } },
      },

      // ─── AccountTypeBase ───────────────────────────────────────────────────
      AccountTypeBaseCreate: {
        type: 'object', required: ['Name'],
        properties: {
          Name:   { type: 'string', maxLength: 50, example: 'Sales' },
          Active: { type: 'boolean', default: true },
        },
      },
      AccountTypeBaseUpdate: {
        type: 'object', minProperties: 1,
        properties: { Name: { type: 'string', maxLength: 50 }, Active: { type: 'boolean' } },
      },
      AccountTypeBase: {
        type: 'object',
        properties: { ...auditFields, Name: { type: 'string' } },
      },

      // ─── TransactionTypeStatus ─────────────────────────────────────────────
      TransactionTypeStatusCreate: {
        type: 'object', required: ['Name'],
        properties: {
          Name:   { type: 'string', maxLength: 50, example: 'Pending' },
          Active: { type: 'boolean', default: true },
        },
      },
      TransactionTypeStatusUpdate: {
        type: 'object', minProperties: 1,
        properties: { Name: { type: 'string', maxLength: 50 }, Active: { type: 'boolean' } },
      },
      TransactionTypeStatus: {
        type: 'object',
        properties: { ...auditFields, Name: { type: 'string' } },
      },

      // ─── ContactAddressType ────────────────────────────────────────────────
      ContactAddressTypeCreate: {
        type: 'object', required: ['Name'],
        properties: {
          Name:   { type: 'string', maxLength: 50, example: 'Home' },
          Active: { type: 'boolean', default: true },
        },
      },
      ContactAddressTypeUpdate: {
        type: 'object', minProperties: 1,
        properties: { Name: { type: 'string', maxLength: 50 }, Active: { type: 'boolean' } },
      },
      ContactAddressType: {
        type: 'object',
        properties: { ...auditFields, Name: { type: 'string' } },
      },

      // ─── TaxGroup ──────────────────────────────────────────────────────────
      TaxGroupCreate: {
        type: 'object', required: ['Name'],
        properties: {
          Name:   { type: 'string', maxLength: 50, example: 'GST 18%' },
          Active: { type: 'boolean', default: true },
        },
      },
      TaxGroupUpdate: {
        type: 'object', minProperties: 1,
        properties: { Name: { type: 'string', maxLength: 50 }, Active: { type: 'boolean' } },
      },
      TaxGroup: {
        type: 'object',
        properties: { ...auditFields, Name: { type: 'string' } },
      },

      // ─── TaxGroupTaxTypeMapper ─────────────────────────────────────────────
      TaxGroupTaxTypeMapperCreate: {
        type: 'object', required: ['TaxGroupId', 'TaxTypeId'],
        properties: {
          TaxGroupId: { type: 'string', format: 'uuid', example: 'uuid-of-taxgroup' },
          TaxTypeId:  { type: 'string', format: 'uuid', example: 'uuid-of-taxtype' },
          Active:     { type: 'boolean', default: true },
        },
      },
      TaxGroupTaxTypeMapperUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          TaxGroupId: { type: 'string', format: 'uuid' },
          TaxTypeId:  { type: 'string', format: 'uuid' },
          Active:     { type: 'boolean' },
        },
      },
      TaxGroupTaxTypeMapper: {
        type: 'object',
        properties: { ...auditFields, TaxGroupId: { type: 'string' }, TaxTypeId: { type: 'string' } },
      },

      // ─── MapProvider ───────────────────────────────────────────────────────
      MapProviderCreate: {
        type: 'object', required: ['ProviderName'],
        properties: {
          ProviderName: { type: 'string', maxLength: 50, example: 'Google Maps' },
          Active:       { type: 'boolean', default: true },
        },
      },
      MapProviderUpdate: {
        type: 'object', minProperties: 1,
        properties: { ProviderName: { type: 'string', maxLength: 50 }, Active: { type: 'boolean' } },
      },
      MapProvider: {
        type: 'object',
        properties: { ...auditFields, ProviderName: { type: 'string' } },
      },

      // ─── LocationDetail ────────────────────────────────────────────────────
      LocationDetailCreate: {
        type: 'object', required: ['Lat', 'Lng'],
        properties: {
          Lat:    { type: 'string', maxLength: 50, example: '12.9716' },
          Lng:    { type: 'string', maxLength: 50, example: '77.5946' },
          CF1:    { type: 'string', maxLength: 50, nullable: true },
          CF2:    { type: 'string', maxLength: 50, nullable: true },
          CF3:    { type: 'string', maxLength: 50, nullable: true },
          CF4:    { type: 'string', maxLength: 50, nullable: true },
          Active: { type: 'boolean', default: true },
        },
      },
      LocationDetailUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          Lat: { type: 'string', maxLength: 50 }, Lng: { type: 'string', maxLength: 50 },
          CF1: { type: 'string', nullable: true }, CF2: { type: 'string', nullable: true },
          CF3: { type: 'string', nullable: true }, CF4: { type: 'string', nullable: true },
          Active: { type: 'boolean' },
        },
      },
      LocationDetail: {
        type: 'object',
        properties: { ...auditFields, Lat: { type: 'string' }, Lng: { type: 'string' }, CF1: { type: 'string', nullable: true }, CF2: { type: 'string', nullable: true }, CF3: { type: 'string', nullable: true }, CF4: { type: 'string', nullable: true } },
      },

      // ─── MapProviderLocationMapper ─────────────────────────────────────────
      MapProviderLocationMapperCreate: {
        type: 'object', required: ['MapProviderId', 'LocationDetailId'],
        properties: {
          MapProviderId:      { type: 'string', format: 'uuid' },
          LocationDetailId:   { type: 'string', format: 'uuid' },
          TagName:            { type: 'string', maxLength: 100, nullable: true, example: 'MAIN_WAREHOUSE' },
          Active:             { type: 'boolean', default: true },
        },
      },
      MapProviderLocationMapperUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          MapProviderId:    { type: 'string', format: 'uuid' },
          LocationDetailId: { type: 'string', format: 'uuid' },
          TagName:          { type: 'string', maxLength: 100, nullable: true },
          Active:           { type: 'boolean' },
        },
      },
      MapProviderLocationMapper: {
        type: 'object',
        properties: { ...auditFields, MapProviderId: { type: 'string' }, LocationDetailId: { type: 'string' }, TagName: { type: 'string', nullable: true } },
      },

      // ─── ContactDetail ─────────────────────────────────────────────────────
      ContactDetailCreate: {
        type: 'object', required: ['FirstName', 'LastName'],
        properties: {
          FirstName:            { type: 'string', maxLength: 50, example: 'John' },
          LastName:             { type: 'string', maxLength: 50, example: 'Doe' },
          MobileNo:             { type: 'string', maxLength: 50, nullable: true, example: '9876543210' },
          AltMobileNo:          { type: 'string', maxLength: 50, nullable: true },
          Landline1:            { type: 'string', maxLength: 50, nullable: true },
          LandLine2:            { type: 'string', maxLength: 50, nullable: true },
          Ext1:                 { type: 'string', maxLength: 50, nullable: true },
          Ext2:                 { type: 'string', maxLength: 50, nullable: true },
          ContactAddressTypeId: { type: 'string', format: 'uuid', nullable: true },
          Active:               { type: 'boolean', default: true },
        },
      },
      ContactDetailUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          FirstName: { type: 'string', maxLength: 50 }, LastName: { type: 'string', maxLength: 50 },
          MobileNo: { type: 'string', maxLength: 50, nullable: true }, AltMobileNo: { type: 'string', maxLength: 50, nullable: true },
          Landline1: { type: 'string', nullable: true }, LandLine2: { type: 'string', nullable: true },
          Ext1: { type: 'string', nullable: true }, Ext2: { type: 'string', nullable: true },
          ContactAddressTypeId: { type: 'string', format: 'uuid', nullable: true }, Active: { type: 'boolean' },
        },
      },
      ContactDetail: {
        type: 'object',
        properties: { ...auditFields, FirstName: { type: 'string' }, LastName: { type: 'string' }, MobileNo: { type: 'string', nullable: true }, AltMobileNo: { type: 'string', nullable: true }, ContactAddressTypeId: { type: 'string', nullable: true } },
      },

      // ─── App Config (super-admin) ──────────────────────────────────────────
      AppConfig: {
        type: 'object',
        properties: {
          autoApproveOnboarding: { type: 'boolean', example: false, description: 'When true, brand-new sign-ins are auto-provisioned into a new tenant as TENANT_ADMIN.' },
        },
      },
      AppConfigUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          autoApproveOnboarding: { type: 'boolean', example: true },
        },
      },

      // ─── AddressDetail ─────────────────────────────────────────────────────
      AddressDetailCreate: {
        type: 'object', required: ['ContactAddressTypeId'],
        properties: {
          AddressLine1:               { type: 'string', maxLength: 50, nullable: true, example: '123 Main St' },
          AddressLine2:               { type: 'string', maxLength: 50, nullable: true },
          City:                       { type: 'string', maxLength: 50, nullable: true, example: 'Bengaluru' },
          State:                      { type: 'string', maxLength: 50, nullable: true, example: 'Karnataka' },
          Pincode:                    { type: 'string', maxLength: 50, nullable: true, example: '560001' },
          MapProviderLocationMapperId: { type: 'string', format: 'uuid', nullable: true },
          Landmark:                   { type: 'string', maxLength: 50, nullable: true },
          ContactAddressTypeId:       { type: 'string', format: 'uuid' },
          TagName:                    { type: 'string', maxLength: 100, nullable: true },
          Active:                     { type: 'boolean', default: true },
        },
      },
      AddressDetailUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          AddressLine1: { type: 'string', maxLength: 50, nullable: true }, AddressLine2: { type: 'string', maxLength: 50, nullable: true },
          City: { type: 'string', nullable: true }, State: { type: 'string', nullable: true }, Pincode: { type: 'string', nullable: true },
          MapProviderLocationMapperId: { type: 'string', format: 'uuid', nullable: true }, Landmark: { type: 'string', nullable: true },
          ContactAddressTypeId: { type: 'string', format: 'uuid' }, TagName: { type: 'string', nullable: true }, Active: { type: 'boolean' },
        },
      },
      AddressDetail: {
        type: 'object',
        properties: { ...auditFields, AddressLine1: { type: 'string', nullable: true }, City: { type: 'string', nullable: true }, State: { type: 'string', nullable: true }, Pincode: { type: 'string', nullable: true }, ContactAddressTypeId: { type: 'string' } },
      },

      // ─── CostInfo ──────────────────────────────────────────────────────────
      CostInfoCreate: {
        type: 'object', required: ['Amount', 'TaxGroupId', 'IsTaxIncluded'],
        properties: {
          Amount:        { type: 'string', maxLength: 50, example: '1000.00' },
          TaxGroupId:    { type: 'string', format: 'uuid' },
          IsTaxIncluded: { type: 'boolean', example: false },
          Active:        { type: 'boolean', default: true },
        },
      },
      CostInfoUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          Amount: { type: 'string', maxLength: 50 }, TaxGroupId: { type: 'string', format: 'uuid' },
          IsTaxIncluded: { type: 'boolean' }, Active: { type: 'boolean' },
        },
      },
      CostInfo: {
        type: 'object',
        properties: {
          ...auditFields,
          Amount: { type: 'string' },
          TaxGroupId: { type: 'string' },
          TaxGroupName: { type: 'string', nullable: true, description: 'Joined on ?expand=true.' },
          IsTaxIncluded: { type: 'integer' },
          TaxBreakdown: { $ref: '#/components/schemas/TaxBreakdown' },
        },
      },

      // ─── BranchDetail ──────────────────────────────────────────────────────
      BranchDetailCreate: {
        type: 'object', required: ['OrganizationDetailId', 'ContactDetailId', 'AddressDetailId', 'TransactionTypeConfigId', 'BranchName'],
        properties: {
          OrganizationDetailId:    { type: 'string', format: 'uuid' },
          ContactDetailId:         { type: 'string', format: 'uuid' },
          AddressDetailId:         { type: 'string', format: 'uuid' },
          TransactionTypeConfigId: { type: 'string', format: 'uuid' },
          BranchName:              { type: 'string', maxLength: 50, example: 'Head Office' },
          TINNo:                   { type: 'string', maxLength: 50, nullable: true },
          GSTIN:                   { type: 'string', maxLength: 50, nullable: true, example: '29ABCDE1234F1Z5' },
          PAN:                     { type: 'string', maxLength: 50, nullable: true },
          CF1:                     { type: 'string', maxLength: 50, nullable: true },
          CF2:                     { type: 'string', maxLength: 50, nullable: true },
          CF3:                     { type: 'string', maxLength: 50, nullable: true },
          CF4:                     { type: 'string', maxLength: 50, nullable: true },
          Active:                  { type: 'boolean', default: true },
        },
      },
      BranchDetailUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          OrganizationDetailId: { type: 'string', format: 'uuid' }, ContactDetailId: { type: 'string', format: 'uuid' },
          AddressDetailId: { type: 'string', format: 'uuid' }, TransactionTypeConfigId: { type: 'string', format: 'uuid' },
          BranchName: { type: 'string', maxLength: 50 }, TINNo: { type: 'string', nullable: true },
          GSTIN: { type: 'string', nullable: true }, PAN: { type: 'string', nullable: true },
          CF1: { type: 'string', nullable: true }, CF2: { type: 'string', nullable: true },
          CF3: { type: 'string', nullable: true }, CF4: { type: 'string', nullable: true }, Active: { type: 'boolean' },
        },
      },
      BranchDetail: {
        type: 'object',
        properties: { ...auditFields, BranchName: { type: 'string' }, OrganizationDetailId: { type: 'string' }, GSTIN: { type: 'string', nullable: true } },
      },

      // ─── BranchUserGroupMapper ─────────────────────────────────────────────
      BranchUserGroupMapperCreate: {
        type: 'object', required: ['BranchDetailId', 'UserGroupId'],
        properties: {
          BranchDetailId: { type: 'string', format: 'uuid' },
          UserGroupId:    { type: 'string', format: 'uuid' },
          Active:         { type: 'boolean', default: true },
        },
      },
      BranchUserGroupMapperUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          BranchDetailId: { type: 'string', format: 'uuid' },
          UserGroupId:    { type: 'string', format: 'uuid' },
          Active:         { type: 'boolean' },
        },
      },
      BranchUserGroupMapper: {
        type: 'object',
        properties: { ...auditFields, BranchDetailId: { type: 'string' }, UserGroupId: { type: 'string' } },
      },

      // ─── BatchDetail ───────────────────────────────────────────────────────
      BatchDetailCreate: {
        type: 'object', required: ['BatchNo', 'IsNonReturnable'],
        properties: {
          BatchNo:                    { type: 'string', maxLength: 50, example: 'BATCH-001' },
          Barcode:                    { type: 'string', maxLength: 50, nullable: true },
          MfgDate:                    { type: 'string', example: '01-01-2026', nullable: true, description: 'DD-MM-YYYY or ISO format' },
          Expdate:                    { type: 'string', example: '01-01-2027', nullable: true, description: 'DD-MM-YYYY or ISO format' },
          PurchaseDate:               { type: 'string', example: '15-01-2026', nullable: true, description: 'DD-MM-YYYY or ISO format' },
          IsNonReturnable:            { type: 'boolean', example: false },
          CostInfoId:                 { type: 'string', format: 'uuid', nullable: true },
          UOMId:                      { type: 'string', format: 'uuid', nullable: true },
          Quantity:                   { type: 'string', maxLength: 50, nullable: true, example: '100' },
          MapProviderLocationMapperId: { type: 'string', format: 'uuid', nullable: true },
          BranchDetailId:             { type: 'string', format: 'uuid', nullable: true },
          Active:                     { type: 'boolean', default: true },
        },
      },
      BatchDetailUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          BatchNo: { type: 'string', maxLength: 50 }, Barcode: { type: 'string', nullable: true },
          MfgDate: { type: 'string', nullable: true }, Expdate: { type: 'string', nullable: true },
          PurchaseDate: { type: 'string', nullable: true }, IsNonReturnable: { type: 'boolean' },
          CostInfoId: { type: 'string', format: 'uuid', nullable: true }, UOMId: { type: 'string', format: 'uuid', nullable: true },
          Quantity: { type: 'string', nullable: true }, MapProviderLocationMapperId: { type: 'string', format: 'uuid', nullable: true },
          BranchDetailId: { type: 'string', format: 'uuid', nullable: true }, Active: { type: 'boolean' },
        },
      },
      BatchDetail: {
        type: 'object',
        properties: {
          ...auditFields,
          BatchNo: { type: 'string' }, Barcode: { type: 'string', nullable: true },
          Quantity: { type: 'string', nullable: true }, IsNonReturnable: { type: 'integer' },
          CostInfoId: { type: 'string', format: 'uuid', nullable: true },
          // Scaled to Quantity — batchdetail is the one non-POS table with both
          // a cost link and a quantity.
          TaxBreakdown: { $ref: '#/components/schemas/TaxBreakdown' },
        },
      },

      // ─── ItemDetail ────────────────────────────────────────────────────────
      ItemDetailCreate: {
        type: 'object', required: ['Name'],
        properties: {
          Name:        { type: 'string', maxLength: 255, example: 'Widget A' },
          Code:        { type: 'string', maxLength: 50, nullable: true, example: 'WGT-001' },
          Description: { type: 'string', maxLength: 1000, nullable: true },
          CategoryId:  { type: 'string', format: 'uuid', nullable: true },
          UOMId:       { type: 'string', format: 'uuid', nullable: true },
          CostInfoId:  { type: 'string', format: 'uuid', nullable: true },
          SKU:         { type: 'string', maxLength: 50, nullable: true, example: 'SKU-001' },
          Barcode:     { type: 'string', maxLength: 50, nullable: true },
          HSNCode:     { type: 'string', maxLength: 50, nullable: true },
          Active:      { type: 'boolean', default: true },
        },
      },
      ItemDetailUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          Name: { type: 'string', maxLength: 255 }, Code: { type: 'string', nullable: true },
          Description: { type: 'string', nullable: true }, CategoryId: { type: 'string', format: 'uuid', nullable: true },
          UOMId: { type: 'string', format: 'uuid', nullable: true }, CostInfoId: { type: 'string', format: 'uuid', nullable: true },
          SKU: { type: 'string', nullable: true }, Barcode: { type: 'string', nullable: true },
          HSNCode: { type: 'string', nullable: true }, Active: { type: 'boolean' },
        },
      },
      ItemDetail: {
        type: 'object',
        properties: {
          ...auditFields,
          Name: { type: 'string' }, Code: { type: 'string', nullable: true },
          SKU: { type: 'string', nullable: true }, Barcode: { type: 'string', nullable: true },
          CostInfoId: { type: 'string', format: 'uuid', nullable: true },
          CostAmount: { type: 'string', nullable: true, description: 'Joined from costinfo on ?expand=true.' },
          CostTaxGroupName: { type: 'string', nullable: true },
          CostIsTaxIncluded: { type: 'integer', nullable: true },
          TaxBreakdown: { $ref: '#/components/schemas/TaxBreakdown' },
        },
      },

      // ─── TransactionTypeBaseConversion ─────────────────────────────────────
      TransactionTypeBaseConversionCreate: {
        type: 'object', required: ['TransactionTypeConfigId', 'FromTransactionTypeStatusId', 'ToTransactionTypeStatusId'],
        properties: {
          TransactionTypeConfigId:     { type: 'string', format: 'uuid', example: '178b49a3-f3ed-4275-9cd7-d746d1476b72' },
          FromTransactionTypeStatusId: { type: 'string', format: 'uuid', example: 'f211cfa7-3a4a-4605-89fc-e40f5e83ac1e' },
          ToTransactionTypeStatusId:   { type: 'string', format: 'uuid', example: 'e6255891-8be2-4dfd-8b1e-1b88a28bc9e7' },
          Tag:                         { type: 'string', maxLength: 100, nullable: true, example: 'SALES_PENDING_TO_APPROVED' },
          Active:                      { type: 'boolean', default: true },
        },
      },
      TransactionTypeBaseConversionUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          TransactionTypeConfigId:     { type: 'string', format: 'uuid' },
          FromTransactionTypeStatusId: { type: 'string', format: 'uuid' },
          ToTransactionTypeStatusId:   { type: 'string', format: 'uuid' },
          Tag:                         { type: 'string', maxLength: 100, nullable: true },
          Active:                      { type: 'boolean' },
        },
      },
      TransactionTypeBaseConversion: {
        type: 'object',
        properties: { ...auditFields, TransactionTypeConfigId: { type: 'string' }, FromTransactionTypeStatusId: { type: 'string' }, ToTransactionTypeStatusId: { type: 'string' }, Tag: { type: 'string', nullable: true } },
      },

      // ─── TransactionDetailLog ──────────────────────────────────────────────
      TransactionDetailLogCreate: {
        type: 'object', required: ['TransactionNo', 'TransactionTypeConfigId', 'TransactionDate'],
        properties: {
          TransactionNo:           { type: 'string', maxLength: 100, example: 'INV-2026-001' },
          TransactionTypeConfigId: { type: 'string', format: 'uuid' },
          TransactionTypeStatusId: { type: 'string', format: 'uuid', nullable: true },
          BranchId:                { type: 'string', format: 'uuid', nullable: true },
          TransactionDate:         { type: 'string', example: '2026-05-31', description: 'ISO date or DD-MM-YYYY' },
          Remarks:                 { type: 'string', maxLength: 1000, nullable: true },
          Active:                  { type: 'boolean', default: true },
        },
      },
      TransactionDetailLogUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          TransactionNo:           { type: 'string', maxLength: 100 },
          TransactionTypeConfigId: { type: 'string', format: 'uuid' },
          TransactionTypeStatusId: { type: 'string', format: 'uuid', nullable: true },
          BranchId:                { type: 'string', format: 'uuid', nullable: true },
          TransactionDate:         { type: 'string', description: 'ISO date or DD-MM-YYYY' },
          Remarks:                 { type: 'string', maxLength: 1000, nullable: true },
          Active:                  { type: 'boolean' },
        },
      },
      TransactionDetailLog: {
        type: 'object',
        properties: { ...auditFields, TransactionNo: { type: 'string' }, TransactionTypeConfigId: { type: 'string' }, TransactionDate: { type: 'string' }, Remarks: { type: 'string', nullable: true } },
      },

      // ─── TransactionItemDetail ─────────────────────────────────────────────
      TransactionItemDetailCreate: {
        type: 'object', required: ['TransactionDetailLogId', 'ItemId'],
        description:
          'Send a Quantity; the server resolves the price and tax from the item\'s cost record (itemdetail.CostInfoId → costinfo → taxgroup → mapper → TaxTypes) and stores a SNAPSHOT. UnitPrice/NetAmount/TaxAmount/GrossAmount/TaxComponents are computed server-side — they may be echoed back from a GET but are always ignored and overwritten.',
        properties: {
          TransactionDetailLogId: { type: 'string', format: 'uuid' },
          ItemId:                 { type: 'string', format: 'uuid' },
          Quantity:               { type: 'number', minimum: 0, default: 1, description: 'Line quantity. The only pricing input a caller supplies.' },
          CostInfoId:             { type: 'string', format: 'uuid', nullable: true, description: 'Optional override; defaults to the item\'s own CostInfoId.' },
          Comment:                { type: 'string', maxLength: 100, nullable: true },
          Active:                 { type: 'boolean', default: true },
        },
      },
      TransactionItemDetailUpdate: {
        type: 'object', minProperties: 1,
        description:
          'The line is re-priced only when ItemId, Quantity or CostInfoId changes — editing a comment must not restate a historical line at today\'s rates.',
        properties: {
          TransactionDetailLogId: { type: 'string', format: 'uuid' },
          ItemId:                 { type: 'string', format: 'uuid' },
          Quantity:               { type: 'number', minimum: 0, default: 1, description: 'Line quantity. The only pricing input a caller supplies.' },
          CostInfoId:             { type: 'string', format: 'uuid', nullable: true, description: 'Optional override; defaults to the item\'s own CostInfoId.' },
          Comment:                { type: 'string', maxLength: 100, nullable: true },
          Active:                 { type: 'boolean' },
        },
      },
      TransactionItemDetail: {
        type: 'object',
        properties: { ...auditFields,
          TransactionDetailLogId: { type: 'string' },
          ItemId: { type: 'string' },
          Quantity: { type: 'number' },
          // Snapshot taken at write time — never recomputed on read, so an
          // invoice keeps the rate it was raised under.
          CostInfoId: { type: 'string', format: 'uuid', nullable: true },
          UnitPrice: { type: 'number', nullable: true },
          NetAmount: { type: 'number', nullable: true },
          TaxAmount: { type: 'number', nullable: true },
          GrossAmount: { type: 'number', nullable: true },
          TaxComponents: {
            type: 'array', nullable: true,
            description: 'CGST/SGST split as charged. Null on lines written before pricing shipped.',
            items: { $ref: '#/components/schemas/PricingComponent' },
          },
          Comment: { type: 'string', nullable: true },
        },
      },

      // ─── TransactionTypeConversionMapper ───────────────────────────────────
      TransactionTypeConversionMapperCreate: {
        type: 'object', required: ['TransactionTypeBaseCoversionId', 'TransactionDetailLogId', 'TransactionTypeStatusId'],
        properties: {
          TransactionTypeBaseCoversionId: { type: 'string', format: 'uuid', description: 'Note: "Coversion" is the exact DB column name (typo)' },
          TransactionDetailLogId:         { type: 'string', format: 'uuid' },
          TransactionTypeStatusId:        { type: 'string', format: 'uuid' },
          Active:                         { type: 'boolean', default: true },
        },
      },
      TransactionTypeConversionMapperUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          TransactionTypeBaseCoversionId: { type: 'string', format: 'uuid' },
          TransactionDetailLogId:         { type: 'string', format: 'uuid' },
          TransactionTypeStatusId:        { type: 'string', format: 'uuid' },
          Active:                         { type: 'boolean' },
        },
      },
      TransactionTypeConversionMapper: {
        type: 'object',
        properties: { ...auditFields, TransactionTypeBaseCoversionId: { type: 'string' }, TransactionDetailLogId: { type: 'string' }, TransactionTypeStatusId: { type: 'string' } },
      },

      // ─── PaymentReceivedType ───────────────────────────────────────────────
      PaymentReceivedTypeCreate: {
        type: 'object', required: ['Type'],
        properties: {
          Type:   { type: 'string', maxLength: 50, example: 'Full Payment' },
          Active: { type: 'boolean', default: true },
        },
      },
      PaymentReceivedTypeUpdate: {
        type: 'object', minProperties: 1,
        properties: { Type: { type: 'string', maxLength: 50 }, Active: { type: 'boolean' } },
      },
      PaymentReceivedType: {
        type: 'object',
        properties: { ...auditFields, Type: { type: 'string' } },
      },

      // ─── PaymentMode ───────────────────────────────────────────────────────
      PaymentModeCreate: {
        type: 'object', required: ['Type'],
        properties: {
          Type:   { type: 'string', maxLength: 50, example: 'Cash' },
          Active: { type: 'boolean', default: true },
        },
      },
      PaymentModeUpdate: {
        type: 'object', minProperties: 1,
        properties: { Type: { type: 'string', maxLength: 50 }, Active: { type: 'boolean' } },
      },
      PaymentMode: {
        type: 'object',
        properties: { ...auditFields, Type: { type: 'string' } },
      },

      // ─── PaymentModeTransactionDetail ──────────────────────────────────────
      PaymentModeTransactionDetailCreate: {
        type: 'object', required: ['PaymentModeId'],
        properties: {
          PaymentModeId: { type: 'string', format: 'uuid' },
          RefNo:         { type: 'string', maxLength: 50, nullable: true, example: 'TXN-001' },
          Comment:       { type: 'string', maxLength: 100, nullable: true },
          CF1:           { type: 'string', maxLength: 50, nullable: true },
          CF2:           { type: 'string', maxLength: 50, nullable: true },
          CF3:           { type: 'string', maxLength: 50, nullable: true },
          CF4:           { type: 'string', maxLength: 50, nullable: true },
          Active:        { type: 'boolean', default: true },
        },
      },
      PaymentModeTransactionDetailUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          PaymentModeId: { type: 'string', format: 'uuid' },
          RefNo: { type: 'string', maxLength: 50, nullable: true }, Comment: { type: 'string', maxLength: 100, nullable: true },
          CF1: { type: 'string', nullable: true }, CF2: { type: 'string', nullable: true },
          CF3: { type: 'string', nullable: true }, CF4: { type: 'string', nullable: true }, Active: { type: 'boolean' },
        },
      },
      PaymentModeTransactionDetail: {
        type: 'object',
        properties: { ...auditFields, PaymentModeId: { type: 'string' }, RefNo: { type: 'string', nullable: true }, Comment: { type: 'string', nullable: true } },
      },

      // ─── PaymentDetail ─────────────────────────────────────────────────────
      PaymentDetailCreate: {
        type: 'object', required: ['AccountTypeBaseId', 'TransactionDetailLogId', 'TotalAmount', 'GrossAmount'],
        properties: {
          AccountTypeBaseId:      { type: 'string', format: 'uuid' },
          TransactionDetailLogId: { type: 'string', format: 'uuid' },
          GrossAmount:            { type: 'string', maxLength: 50, example: '1000.00' },
          TaxesAmount:            { type: 'string', maxLength: 50, nullable: true, example: '180.00' },
          DiscountAmount:         { type: 'string', maxLength: 100, nullable: true, example: '50.00' },
          RoundOff:               { type: 'string', maxLength: 50, nullable: true, example: '0.50' },
          TotalAmount:            { type: 'string', maxLength: 50, example: '1130.50' },
          UserId:                 { type: 'string', format: 'uuid', nullable: true },
          Active:                 { type: 'boolean', default: true },
        },
      },
      PaymentDetailUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          AccountTypeBaseId: { type: 'string', format: 'uuid' }, TransactionDetailLogId: { type: 'string', format: 'uuid' },
          GrossAmount: { type: 'string', maxLength: 50 }, TaxesAmount: { type: 'string', maxLength: 50, nullable: true },
          DiscountAmount: { type: 'string', maxLength: 100, nullable: true }, RoundOff: { type: 'string', maxLength: 50, nullable: true },
          TotalAmount: { type: 'string', maxLength: 50 }, UserId: { type: 'string', format: 'uuid', nullable: true }, Active: { type: 'boolean' },
        },
      },
      PaymentDetail: {
        type: 'object',
        properties: { ...auditFields, AccountTypeBaseId: { type: 'string' }, TransactionDetailLogId: { type: 'string' }, TotalAmount: { type: 'string', description: 'Payable (net + tax). Computed from the log\'s priced lines when they exist.' }, TaxesAmount: { type: 'string', nullable: true, description: 'Tax total, computed from the log\'s priced line snapshots.' }, GrossAmount: { type: 'string', description: 'Taxable base after discount.' }, DiscountAmount: { type: 'string', nullable: true, description: 'Applied BEFORE tax.' } },
      },

      // ─── PaymentBreakup ────────────────────────────────────────────────────
      PaymentBreakupCreate: {
        type: 'object', required: ['AccountTypeBaseId', 'PaymentDetailId', 'PaymentModeTransactionDetailId', 'PaymentReceivedTypeId', 'Timestamp'],
        properties: {
          AccountTypeBaseId:             { type: 'string', format: 'uuid' },
          PaymentDetailId:               { type: 'string', format: 'uuid' },
          PaymentModeTransactionDetailId: { type: 'string', format: 'uuid' },
          PaymentReceivedTypeId:         { type: 'string', format: 'uuid' },
          Amount:                        { type: 'number', minimum: 0, default: 0, description: 'Amount settled through this payment mode. Several breakups against one paymentdetail form a split settlement and should sum to its TotalAmount.' },
          UserId:                        { type: 'string', format: 'uuid', nullable: true },
          Timestamp:                     { type: 'string', example: '2026-05-31T10:00:00.000Z', description: 'ISO datetime or DD-MM-YYYY' },
          Active:                        { type: 'boolean', default: true },
        },
      },
      PaymentBreakupUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          AccountTypeBaseId:             { type: 'string', format: 'uuid' },
          PaymentDetailId:               { type: 'string', format: 'uuid' },
          PaymentModeTransactionDetailId: { type: 'string', format: 'uuid' },
          PaymentReceivedTypeId:         { type: 'string', format: 'uuid' },
          Amount:                        { type: 'number', minimum: 0, default: 0, description: 'Amount settled through this payment mode. Several breakups against one paymentdetail form a split settlement and should sum to its TotalAmount.' },
          UserId:                        { type: 'string', format: 'uuid', nullable: true },
          Timestamp:                     { type: 'string', description: 'ISO datetime or DD-MM-YYYY' },
          Active:                        { type: 'boolean' },
        },
      },
      PaymentBreakup: {
        type: 'object',
        properties: { ...auditFields, AccountTypeBaseId: { type: 'string' }, PaymentDetailId: { type: 'string' }, PaymentModeTransactionDetailId: { type: 'string' }, PaymentReceivedTypeId: { type: 'string' }, Amount: { type: 'number', description: 'Amount settled through this mode.' }, UserId: { type: 'string', nullable: true }, Timestamp: { type: 'string' } },
      },

      // ─── IAM — Onboarding ──────────────────────────────────────────────────
      OnboardingStatus: {
        type: 'object',
        properties: {
          id:              { type: 'string', format: 'uuid' },
          status:          { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
          requestNote:     { type: 'string', nullable: true },
          rejectionReason: { type: 'string', nullable: true },
          requestedAt:     { type: 'string', format: 'date-time' },
        },
      },
      OnboardingNoteUpdate: {
        type: 'object',
        properties: { requestNote: { type: 'string', maxLength: 500 } },
      },
      OnboardingRequest: {
        type: 'object',
        properties: {
          id:             { type: 'string', format: 'uuid' },
          email:          { type: 'string', format: 'email' },
          name:           { type: 'string', nullable: true },
          status:         { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
          requestNote:    { type: 'string', nullable: true },
          rejectionReason:{ type: 'string', nullable: true },
          reviewedBy:     { type: 'string', nullable: true },
          reviewedAt:     { type: 'string', format: 'date-time', nullable: true },
          requestedAt:    { type: 'string', format: 'date-time' },
        },
      },
      OnboardingApprove: {
        type: 'object', required: ['tenantId', 'roleIds'],
        properties: {
          tenantId: { type: 'string', example: 'tenant-uuid' },
          roleIds:  { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1 },
        },
      },
      OnboardingReject: {
        type: 'object', required: ['reason'],
        properties: { reason: { type: 'string', maxLength: 500 } },
      },
      // Part 2I — frontend-friendly schemas (PUT, simplified body)
      OnboardingApproveSimple: {
        type: 'object', required: ['tenantId'],
        properties: {
          tenantId: { type: 'string', example: 'tenant-uuid' },
          roleIds:  { type: 'array', items: { type: 'string', format: 'uuid' }, description: 'Optional — omit to approve without assigning roles' },
        },
      },
      OnboardingRejectFrontend: {
        type: 'object', required: ['rejectionReason'],
        properties: { rejectionReason: { type: 'string', maxLength: 500 } },
      },

      // ─── IAM — Users ──────────────────────────────────────────────────────
      AdminUser: {
        type: 'object',
        properties: {
          user_email:     { type: 'string', format: 'email' },
          tenant_id:      { type: 'string' },
          is_admin:       { type: 'integer', enum: [0, 1] },
          is_super_admin: { type: 'integer', enum: [0, 1] },
          is_active:      { type: 'integer', enum: [0, 1] },
          status:         { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] },
          roles:          { type: 'string', nullable: true, description: 'Comma-separated role names' },
          tenant_name:    { type: 'string', nullable: true, description: 'Organization name of the tenant (cross-tenant listing only)' },
          setup_status: {
            type: 'string',
            enum: ['PENDING', 'COMPLETED'],
            description:
              'Whether the tenant has completed the first-time setup wizard. Per TENANT, so every row of the same tenant carries the same value. Cross-tenant listing (GET /api/admin/users/all) only.',
          },
          setup_completed_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      UserRole: {
        type: 'object',
        properties: {
          id:             { type: 'string', format: 'uuid' },
          user_email:     { type: 'string', format: 'email' },
          tenant_id:      { type: 'string' },
          role_id:        { type: 'string', format: 'uuid' },
          role_name:      { type: 'string', example: 'EDITOR' },
          description:    { type: 'string', nullable: true },
          is_system_role: { type: 'integer', enum: [0, 1] },
          assigned_by:    { type: 'string', nullable: true },
          assigned_at:    { type: 'string', format: 'date-time' },
        },
      },
      UserRolesUpdate: {
        type: 'object', required: ['roleIds'],
        properties: { roleIds: { type: 'array', items: { type: 'string', format: 'uuid' } } },
      },
      UserStatusUpdate: {
        type: 'object', required: ['status'],
        properties: { status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] } },
      },

      // ─── IAM — Roles ──────────────────────────────────────────────────────
      Role: {
        type: 'object',
        properties: {
          id:               { type: 'string', format: 'uuid' },
          tenant_id:        { type: 'string' },
          name:             { type: 'string' },
          description:      { type: 'string', nullable: true },
          is_system_role:   { type: 'integer', enum: [0, 1] },
          is_active:        { type: 'integer', enum: [0, 1] },
          permission_count: { type: 'integer' },
          user_count:       { type: 'integer' },
        },
      },
      RoleCreate: {
        type: 'object', required: ['name'],
        properties: {
          name:        { type: 'string', maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
        },
      },
      RoleUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          name:        { type: 'string', maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
          isActive:    { type: 'boolean' },
        },
      },
      RolePermission: {
        type: 'object',
        properties: {
          id:                 { type: 'string', format: 'uuid' },
          role_id:            { type: 'string', format: 'uuid' },
          feature_id:         { type: 'string', format: 'uuid' },
          feature_short_name: { type: 'string' },
          scope:              { type: 'string' },
          display_name:       { type: 'string' },
          category:           { type: 'string', nullable: true },
        },
      },
      RolePermissionsUpdate: {
        type: 'object', required: ['featureIds'],
        properties: { featureIds: { type: 'array', items: { type: 'string', format: 'uuid' } } },
      },

      // ─── IAM — Features ───────────────────────────────────────────────────
      Feature: {
        type: 'object',
        properties: {
          feature_id:         { type: 'string', format: 'uuid' },
          name:               { type: 'string' },
          feature_short_name: { type: 'string' },
          scope:              { type: 'string' },
          display_name:       { type: 'string' },
          category:           { type: 'string', nullable: true },
          description:        { type: 'string', nullable: true },
          is_active:          { type: 'integer', enum: [0, 1] },
        },
      },
      FeatureCreate: {
        type: 'object', required: ['featureShortName', 'scope', 'displayName'],
        properties: {
          featureShortName: { type: 'string', maxLength: 50, description: 'Auto-uppercased, e.g. REPORTS' },
          scope:            { type: 'string', maxLength: 50, description: 'Auto-uppercased, e.g. READ' },
          displayName:      { type: 'string', maxLength: 100 },
          category:         { type: 'string', maxLength: 50 },
          description:      { type: 'string', maxLength: 500 },
        },
      },
      FeatureUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          displayName: { type: 'string', maxLength: 100 },
          scope:       { type: 'string', maxLength: 50 },
          category:    { type: 'string', maxLength: 50 },
          description: { type: 'string', maxLength: 500 },
          isActive:    { type: 'boolean' },
        },
      },

      // ─── POS (Front Desk) ───────────────────────────────────────────────
      PosFloorCreate: {
        type: 'object', required: ["Name"],
        properties: {
          Name: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosFloorUpdate: {
        type: 'object',
        properties: {
          Name: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosFloor: {
        type: 'object',
        properties: { ...auditFields,
          Name: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosTableCreate: {
        type: 'object', required: ["Name"],
        properties: {
          Name: {"type":"string"},
          FloorId: {"type":"string","format":"uuid"},
          Capacity: {"type":"integer"},
          Status: {"type":"string","enum":["Available","Occupied","Reserved"],"default":"Available","example":"Available"},
          CurrentOrderId: {"type":"string","format":"uuid"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosTableUpdate: {
        type: 'object',
        properties: {
          Name: {"type":"string"},
          FloorId: {"type":"string","format":"uuid"},
          Capacity: {"type":"integer"},
          Status: {"type":"string","enum":["Available","Occupied","Reserved"],"example":"Occupied"},
          CurrentOrderId: {"type":"string","format":"uuid"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosTable: {
        type: 'object',
        properties: { ...auditFields,
          Name: {"type":"string"},
          FloorId: {"type":"string","format":"uuid"},
          Capacity: {"type":"integer"},
          Status: {"type":"string","enum":["Available","Occupied","Reserved"],"example":"Available"},
          CurrentOrderId: {"type":"string","format":"uuid"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosItemMetaCreate: {
        type: 'object', required: ["ItemDetailId", "FoodTypeId", "BranchDetailId"],
        description:
          'Price is owned by the master item (itemdetail.CostInfoId → costinfo); a menu entry only mirrors it. OMIT CostInfoId and the server derives it from ItemDetailId — this is what the Menu Items screen does. Send it explicitly only to override.',
        properties: {
          ItemDetailId: {"type":"string","format":"uuid"},
          FoodTypeId: {"type":"string","format":"uuid"},
          CostInfoId: {
            type: 'string', format: 'uuid', nullable: true,
            description:
              'Optional. When omitted, derived from the selected item\'s CostInfoId. An explicit value (including null) always wins, so existing clients are unaffected.',
          },
          ChannelIds: {"type":"array","items":{"type":"string","format":"uuid"}},
          VariantIds: {"type":"array","items":{"type":"string","format":"uuid"}},
          Channels: {"type":"object"},
          Prices: {"type":"object"},
          Variants: {"type":"object"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosItemMetaUpdate: {
        type: 'object',
        description:
          'Same price rule as create: omit CostInfoId and the server re-derives it from the effective ItemDetailId, so switching the item also moves the price. An explicit value still wins.',
        properties: {
          ItemDetailId: {"type":"string","format":"uuid"},
          FoodTypeId: {"type":"string","format":"uuid"},
          CostInfoId: {
            type: 'string', format: 'uuid', nullable: true,
            description:
              'Optional. When omitted, re-derived from the selected item on every update.',
          },
          ChannelIds: {"type":"array","items":{"type":"string","format":"uuid"}},
          VariantIds: {"type":"array","items":{"type":"string","format":"uuid"}},
          Channels: {"type":"object"},
          Prices: {"type":"object"},
          Variants: {"type":"object"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosItemMeta: {
        type: 'object',
        properties: { ...auditFields,
          ItemDetailId: {"type":"string","format":"uuid"},
          FoodTypeId: {"type":"string","format":"uuid"},
          FoodTypeName: {"type":"string","nullable":true},
          FoodTypeIsVeg: {"type":"boolean","nullable":true},
          CostInfoId: {
            type: 'string', format: 'uuid', nullable: true,
            description: 'Resolved from the selected item unless explicitly overridden.',
          },
          CostInfoAmount: {
            type: 'number', nullable: true,
            description: 'Joined from costinfo.Amount — the price shown read-only on the Menu Items form.',
          },
          TaxBreakdown: { $ref: '#/components/schemas/TaxBreakdown' },
          ChannelIds: {"type":"array","items":{"type":"string","format":"uuid"}},
          VariantIds: {"type":"array","items":{"type":"string","format":"uuid"}},
          Channels: {"type":"object"},
          Prices: {"type":"object"},
          Variants: {"type":"object"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      // ── Master-data bootstrap (nested, no ids) ──────────────────────────
      MasterDataBootstrap: {
        type: 'object', required: ['organization', 'branch'],
        properties: {
          organization: { type: 'object', required: ['Name'], properties: { Name: { type: 'string' } } },
          branch: {
            type: 'object', required: ['Name', 'address', 'contact', 'transactionTypeConfig'],
            properties: {
              Name: { type: 'string' },
              address: {
                type: 'object', required: ['AddressLine1', 'TagName', 'contactAddressType', 'locationMapper'],
                properties: {
                  AddressLine1: { type: 'string' },
                  TagName: { type: 'string' },
                  contactAddressType: { type: 'object', required: ['Name'], properties: { Name: { type: 'string' } } },
                  locationMapper: {
                    type: 'object', required: ['TagName', 'mapProvider', 'locationDetail'],
                    properties: {
                      TagName: { type: 'string' },
                      mapProvider: { type: 'object', required: ['ProviderName'], properties: { ProviderName: { type: 'string' } } },
                      locationDetail: { type: 'object', required: ['Lat', 'Lng'], properties: { Lat: { type: 'number' }, Lng: { type: 'number' } } },
                    },
                  },
                },
              },
              contact: { type: 'object', required: ['FirstName', 'LastName'], properties: { FirstName: { type: 'string' }, LastName: { type: 'string' } } },
              transactionTypeConfig: {
                type: 'object', required: ['StartCounterNo', 'Format', 'TagName'],
                properties: { StartCounterNo: { type: 'integer' }, Format: { type: 'string' }, TagName: { type: 'string' } },
              },
            },
          },
          item: {
            type: 'object', required: ['Name', 'category', 'uom', 'costInfo'],
            properties: {
              Name: { type: 'string' },
              category: { type: 'object', required: ['Name'], properties: { Name: { type: 'string' } } },
              uom: { type: 'object', required: ['UnitName'], properties: { UnitName: { type: 'string' } } },
              costInfo: {
                type: 'object', required: ['Amount', 'taxGroup'],
                properties: { Amount: { type: 'number' }, taxGroup: { type: 'object', required: ['Name'], properties: { Name: { type: 'string' } } } },
              },
            },
          },
        },
      },
      MasterDataBootstrapResult: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          message: { type: 'string' },
          data: {
            type: 'object',
            description: 'Map of created entity → generated UUID',
            properties: {
              organization: { type: 'string' }, branch: { type: 'string' },
              address: { type: 'string' }, contactAddressType: { type: 'string' },
              locationMapper: { type: 'string' }, mapProvider: { type: 'string' }, locationDetail: { type: 'string' },
              contact: { type: 'string' }, transactionTypeConfig: { type: 'string' },
              item: { type: 'string' }, category: { type: 'string' }, uom: { type: 'string' },
              costInfo: { type: 'string' }, taxGroup: { type: 'string' },
              setupToken: {
                type: 'string',
                description:
                  'Refreshed JWT identical to the caller\'s but with setupCompleted: true. Store it in place of the current token so the first-time setup gate stops blocking requests without forcing a re-login.',
              },
            },
          },
        },
      },
      // ── Accounting ledger ───────────────────────────────────────────────
      LedgerDocumentSummary: {
        type: 'object',
        properties: {
          Id: { type: 'string', format: 'uuid' },
          TransactionNo: { type: 'string', example: 'INV-0042', description: 'Gap-free sequence, unique per tenant.' },
          TransactionDate: { type: 'string', format: 'date' },
          TypeName: { type: 'string', example: 'POS Sale' },
          StatusName: { type: 'string', example: 'SETTLED' },
          NetAmount: { type: 'number' },
          TaxAmount: { type: 'number' },
          GrossAmount: { type: 'number', description: 'Payable after discount and round-off.' },
          CustomerName: { type: 'string', nullable: true, description: 'Snapshot as at the sale.' },
          CustomerMobile: { type: 'string', nullable: true },
          SettledAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      LedgerLine: {
        type: 'object',
        properties: {
          LineNo: { type: 'integer', description: 'Unique within the document — this is what lets one item appear twice with different options.' },
          ItemId: { type: 'string', format: 'uuid' },
          ItemName: { type: 'string', nullable: true },
          Quantity: { type: 'number' },
          BasePrice: { type: 'number', nullable: true, description: 'Item price before variants.' },
          VariantAmount: { type: 'number', description: 'Per-unit variant surcharge, taxed as part of the unit price.' },
          UnitPrice: { type: 'number', nullable: true, description: 'Effective unit price charged.' },
          NetAmount: { type: 'number', nullable: true },
          TaxAmount: { type: 'number', nullable: true },
          GrossAmount: { type: 'number', nullable: true },
          TaxComponents: { type: 'array', items: { $ref: '#/components/schemas/PricingComponent' } },
          Variants: {
            type: 'array',
            description: 'Options as sold. Names are snapshotted, so renaming a variant cannot rewrite an issued invoice.',
            items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, price: { type: 'number' } } },
          },
        },
      },
      LedgerTender: {
        type: 'object',
        description: 'One paymentbreakup row — a single way the customer paid.',
        properties: {
          Amount: { type: 'number', description: 'Negative on a refund reversal.' },
          PaymentMode: { type: 'string', example: 'Card' },
          RefNo: { type: 'string', nullable: true, description: 'Required for card/UPI/wallet — reconciliation depends on it.' },
          ReceivedType: { type: 'string', example: 'Full' },
          AccountName: { type: 'string' },
          Timestamp: { type: 'string', format: 'date-time' },
        },
      },
      LedgerDocument: {
        allOf: [{ $ref: '#/components/schemas/LedgerDocumentSummary' }],
        type: 'object',
        properties: {
          DiscountAmount: { type: 'number', description: 'Applied BEFORE tax.' },
          RoundOff: { type: 'number', description: 'Automatic, to the nearest rupee.' },
          TaxByComponent: { type: 'array', items: { $ref: '#/components/schemas/PricingComponent' } },
          ContactDetailId: { type: 'string', format: 'uuid', nullable: true, description: 'Master contact — null for walk-ins and for customers with no phone on file.' },
          Lines: { type: 'array', items: { $ref: '#/components/schemas/LedgerLine' } },
          Tenders: { type: 'array', items: { $ref: '#/components/schemas/LedgerTender' } },
          History: {
            type: 'array',
            description: 'Every status change, each recorded against a permitted transition.',
            items: { type: 'object', properties: { StatusName: { type: 'string' }, Tag: { type: 'string' }, CreatedBy: { type: 'string' }, CreatedOn: { type: 'string', format: 'date-time' } } },
          },
          IsImmutable: { type: 'boolean', description: 'True once posted — the UI should offer Refund, not Edit.' },
        },
      },

      // ── Pricing / tax engine ────────────────────────────────────────────
      PricingDiscount: {
        type: 'object', required: ['type', 'value'],
        description: 'Applied BEFORE tax.',
        properties: {
          type: { type: 'string', enum: ['percent', 'amount'] },
          value: { type: 'number', minimum: 0 },
        },
      },
      PricingQuoteRequest: {
        type: 'object', required: ['lines'],
        properties: {
          lines: {
            type: 'array', minItems: 1, maxItems: 200,
            items: {
              type: 'object', required: ['costInfoId'],
              properties: {
                costInfoId: { type: 'string', format: 'uuid' },
                quantity: { type: 'number', minimum: 0, default: 1 },
                variantIds: {
                  type: 'array', maxItems: 20,
                  items: { type: 'string', format: 'uuid' },
                  description: 'Selected variants. Prices are read from the pos_variant master (never from the request) and added to the unit price BEFORE tax. They are a surcharge, not separately taxed lines, so they inherit the item\'s tax group and its inclusive/exclusive convention.',
                },
                discount: { $ref: '#/components/schemas/PricingDiscount' },
                ref: { type: 'string', maxLength: 100, description: 'Client correlation key, echoed back untouched.' },
              },
            },
          },
          discount: {
            allOf: [{ $ref: '#/components/schemas/PricingDiscount' }],
            description: 'Document-level discount, apportioned across lines before tax.',
          },
        },
      },
      PricingComponent: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', nullable: true },
          name: { type: 'string', nullable: true, example: 'CGST' },
          rate: { type: 'number', example: 9 },
          amount: { type: 'number', example: 7.63 },
        },
      },
      PricingLine: {
        type: 'object',
        properties: {
          costInfoId: { type: 'string', format: 'uuid', nullable: true },
          found: { type: 'boolean', description: 'false when the costinfo could not be resolved; the line prices as zero.' },
          taxGroupId: { type: 'string', format: 'uuid', nullable: true },
          taxGroupName: { type: 'string', nullable: true },
          quantity: { type: 'number' },
          unitAmount: { type: 'number', description: 'EFFECTIVE per-unit amount actually taxed — baseAmount + addOnAmount.' },
          baseAmount: { type: 'number', description: 'Per-unit amount as stored on costinfo, before variants.' },
          addOnAmount: { type: 'number', description: 'Per-unit variant surcharge folded into the taxed price.' },
          variants: {
            type: 'array',
            description: 'Selected variants resolved from the master, so a caller can render "Large +₹30" without a second lookup.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                code: { type: 'string' },
                price: { type: 'number' },
              },
            },
          },
          lineAmount: { type: 'number', description: 'unitAmount × quantity, before discount.' },
          discountAmount: { type: 'number', description: 'Line discount + apportioned share of any document discount.' },
          netAmount: { type: 'number', description: 'Taxable base, after discount.' },
          taxAmount: { type: 'number' },
          grossAmount: { type: 'number', description: 'netAmount + taxAmount.' },
          effectiveRate: { type: 'number', example: 18 },
          isTaxIncluded: { type: 'boolean' },
          components: { type: 'array', items: { $ref: '#/components/schemas/PricingComponent' } },
        },
      },
      PricingTotals: {
        type: 'object',
        properties: {
          netAmount: { type: 'number' },
          taxAmount: { type: 'number' },
          grossAmount: { type: 'number' },
          discountAmount: { type: 'number' },
          taxByComponent: {
            type: 'array',
            description: 'Invoice footer — components aggregated across all lines. Sums exactly to taxAmount.',
            items: { $ref: '#/components/schemas/PricingComponent' },
          },
        },
      },
      PricingQuoteResult: {
        type: 'object',
        properties: {
          lines: { type: 'array', items: { $ref: '#/components/schemas/PricingLine' } },
          totals: { $ref: '#/components/schemas/PricingTotals' },
        },
      },
      TaxBreakdown: {
        allOf: [{ $ref: '#/components/schemas/PricingLine' }],
        nullable: true,
        description:
          'Live tax breakdown resolved from `costinfo → taxgroup → mapper → TaxTypes`, returned on `?expand=true` by costinfo, itemdetail, pos item-meta and batchdetail.\n\n' +
          '`null` when the record has no cost link, or the cost record cannot be resolved — an item without a price yet is normal, not an error.\n\n' +
          'On **batchdetail** the breakdown is scaled to the row\'s `Quantity`; elsewhere it is the unit price. A null/blank Quantity means "not recorded" and falls back to the unit price, whereas a recorded 0 prices the line at zero.\n\n' +
          '**Read paths only.** Stored documents (orders, bills) carry their own snapshot taken at write time and are never re-priced against current rates.',
      },
      TaxGroupRate: {
        type: 'object',
        properties: {
          taxGroupId: { type: 'string', format: 'uuid' },
          taxGroupName: { type: 'string' },
          effectiveRate: { type: 'number', example: 18 },
          components: { type: 'array', items: { $ref: '#/components/schemas/PricingComponent' } },
        },
      },
      TenantSetupStatus: {
        type: 'object',
        properties: {
          tenantId:    { type: 'string' },
          status:      { type: 'string', enum: ['PENDING', 'COMPLETED'] },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
          completedBy: { type: 'string', nullable: true, description: 'Email of the user who completed the wizard' },
          isComplete:  { type: 'boolean', description: 'Convenience flag — true when status is COMPLETED' },
        },
      },
      PosChannelCreate: {
        type: 'object', required: ["Name", "Code"],
        properties: {
          Name: {"type":"string"},
          Code: {"type":"string"},
          Description: {"type":"string"},
          SortOrder: {"type":"integer"},
          Active: {"type":"boolean"},
        },
      },
      PosChannelUpdate: {
        type: 'object',
        properties: {
          Name: {"type":"string"},
          Code: {"type":"string"},
          Description: {"type":"string"},
          SortOrder: {"type":"integer"},
          Active: {"type":"boolean"},
        },
      },
      PosChannel: {
        type: 'object',
        properties: { ...auditFields,
          Name: {"type":"string"},
          Code: {"type":"string"},
          Description: {"type":"string"},
          SortOrder: {"type":"integer"},
          Active: {"type":"boolean"},
        },
      },
      PosVariantCreate: {
        type: 'object', required: ["Name", "Code"],
        properties: {
          Name: {"type":"string"},
          Code: {"type":"string"},
          Description: {"type":"string"},
          SortOrder: {"type":"integer"},
          Price: {"type":"number","nullable":true},
          Active: {"type":"boolean"},
        },
      },
      PosVariantUpdate: {
        type: 'object',
        properties: {
          Name: {"type":"string"},
          Code: {"type":"string"},
          Description: {"type":"string"},
          SortOrder: {"type":"integer"},
          Price: {"type":"number","nullable":true},
          Active: {"type":"boolean"},
        },
      },
      PosVariant: {
        type: 'object',
        properties: { ...auditFields,
          Name: {"type":"string"},
          Code: {"type":"string"},
          Description: {"type":"string"},
          SortOrder: {"type":"integer"},
          Price: {"type":"number","nullable":true},
          Active: {"type":"boolean"},
        },
      },
      PosCustomerCreate: {
        type: 'object', required: ["Name"],
        properties: {
          Name: {"type":"string"},
          Phone: {"type":"string"},
          Email: {"type":"string"},
          Visits: {"type":"integer"},
          TotalSpent: {"type":"number"},
          LoyaltyPoints: {"type":"integer"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosCustomerUpdate: {
        type: 'object',
        properties: {
          Name: {"type":"string"},
          Phone: {"type":"string"},
          Email: {"type":"string"},
          Visits: {"type":"integer"},
          TotalSpent: {"type":"number"},
          LoyaltyPoints: {"type":"integer"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosCustomer: {
        type: 'object',
        properties: { ...auditFields,
          Name: {"type":"string"},
          Phone: {"type":"string"},
          Email: {"type":"string"},
          Visits: {"type":"integer"},
          TotalSpent: {"type":"number"},
          LoyaltyPoints: {"type":"integer"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosOrderCreate: {
        type: 'object', required: ["OrderNo"],
        properties: {
          OrderNo: {"type":"string"},
          TableId: {"type":"string","format":"uuid"},
          CustomerId: {"type":"string","format":"uuid"},
          OrderType: {"type":"string"},
          Status: {"type":"string"},
          Items: {"type":"object"},
          SubTotal: {"type":"number"},
          TaxAmount: {"type":"number"},
          Total: {"type":"number"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosOrderUpdate: {
        type: 'object',
        properties: {
          OrderNo: {"type":"string"},
          TableId: {"type":"string","format":"uuid"},
          CustomerId: {"type":"string","format":"uuid"},
          OrderType: {"type":"string"},
          Status: {"type":"string"},
          Items: {"type":"object"},
          SubTotal: {"type":"number"},
          TaxAmount: {"type":"number"},
          Total: {"type":"number"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosOrder: {
        type: 'object',
        properties: { ...auditFields,
          OrderNo: {"type":"string"},
          TableId: {"type":"string","format":"uuid"},
          CustomerId: {"type":"string","format":"uuid"},
          OrderType: {"type":"string"},
          Status: {"type":"string"},
          Items: {"type":"object"},
          SubTotal: {"type":"number"},
          TaxAmount: {"type":"number"},
          Total: {"type":"number"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosKotCreate: {
        type: 'object', required: ["KotNo"],
        properties: {
          KotNo: {"type":"string"},
          OrderId: {"type":"string","format":"uuid"},
          TableId: {"type":"string","format":"uuid"},
          Items: {"type":"object"},
          Status: {"type":"string"},
          FiredAt: {"type":"string","format":"date-time"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosKotUpdate: {
        type: 'object',
        properties: {
          KotNo: {"type":"string"},
          OrderId: {"type":"string","format":"uuid"},
          TableId: {"type":"string","format":"uuid"},
          Items: {"type":"object"},
          Status: {"type":"string"},
          FiredAt: {"type":"string","format":"date-time"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosKot: {
        type: 'object',
        properties: { ...auditFields,
          KotNo: {"type":"string"},
          OrderId: {"type":"string","format":"uuid"},
          TableId: {"type":"string","format":"uuid"},
          Items: {"type":"object"},
          Status: {"type":"string"},
          FiredAt: {"type":"string","format":"date-time"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosBillSettle: {
        type: 'object',
        description:
          'Settling posts the bill to the accounting ledger: a numbered Sale document with lines, tax, customer and a tender-by-tender settlement.\n\nDiscount is applied BEFORE tax; round-off to the nearest rupee is automatic. Tendering less than the payable leaves the bill PARTIALLY_PAID rather than failing.',
        properties: {
          Tenders: {
            type: 'array', minItems: 1, maxItems: 20,
            description: 'One entry per way the customer paid. Each becomes a paymentbreakup row with its own instrument.',
            items: {
              type: 'object', required: ['paymentModeId', 'amount'],
              properties: {
                paymentModeId: { type: 'string', format: 'uuid' },
                amount: { type: 'number', minimum: 0 },
                refNo: { type: 'string', maxLength: 50, nullable: true, description: 'Required for Card/UPI/Wallet.' },
                comment: { type: 'string', maxLength: 100, nullable: true },
              },
            },
          },
          Payments: { type: 'array', description: 'Legacy blob — still accepted and mapped to a single tender.', items: { type: 'object' } },
          Discount: { type: 'number', description: 'Applied before tax.' },
        },
      },
      PosBillCreate: {
        type: 'object', required: ["BillNo"],
        description:
          'A dine-in session is several rounds (orders) billed together. Send **OrderIds** and the server recomputes SubTotal/TaxAmount/Total from every listed order\'s priced line snapshots — client-supplied totals are ignored.\n\n' +
          '**Discount is applied BEFORE tax**: it is spread across the lines and tax is charged on what remains, so it reduces the taxable base rather than being knocked off an already-taxed total.\n\n' +
          'Pricing uses each order\'s stored snapshot, never the live tax chain, so editing a tax group mid-session cannot restate a bill being settled.',
        properties: {
          BillNo: {"type":"string"},
          OrderId: {
            type: 'string', format: 'uuid',
            description: 'Primary/first round. Kept for single-order callers; OrderIds is preferred.',
          },
          OrderIds: {
            type: 'array', minItems: 1, maxItems: 100,
            items: { type: 'string', format: 'uuid' },
            description: 'Every round this bill covers. Recorded in pos_bill_order and used to recompute the bill.',
          },
          SubTotal: {"type":"number","description":"Server-computed (net, after discount). Ignored on input when OrderIds/OrderId resolve to priced lines."},
          TaxAmount: {"type":"number","description":"Server-computed. Ignored on input."},
          Discount: {"type":"number"},
          Total: {"type":"number"},
          Payments: {"type":"object"},
          Status: {"type":"string"},
          SettledAt: {"type":"string","format":"date-time"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosBillUpdate: {
        type: 'object',
        properties: {
          BillNo: {"type":"string"},
          OrderId: {"type":"string","format":"uuid"},
          SubTotal: {"type":"number"},
          TaxAmount: {"type":"number"},
          Discount: {"type":"number"},
          Total: {"type":"number"},
          Payments: {"type":"object"},
          Status: {"type":"string"},
          SettledAt: {"type":"string","format":"date-time"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosBill: {
        type: 'object',
        properties: { ...auditFields,
          TransactionDetailLogId: {
            type: 'string', format: 'uuid', nullable: true,
            description: 'The ledger document this bill was posted as. Null means not yet in the ledger, and doubles as the idempotency guard — settling a posted bill returns 409.',
          },
          TransactionNo: { type: 'string', nullable: true, example: 'INV-0042', description: 'Invoice number, present once posted.' },
          BalanceDue: { type: 'number', nullable: true, description: 'Greater than zero when only part-tendered.' },
          RoundOff: { type: 'number', nullable: true, description: 'Automatic, to the nearest rupee.' },
          OrderIds: {
            type: 'array', items: { type: 'string', format: 'uuid' },
            description: 'Every round this bill covers (from pos_bill_order).',
          },
          TaxByComponent: {
            type: 'array',
            description: 'Invoice footer — CGST/SGST split across all rounds. Sums exactly to TaxAmount. Empty for bills raised before server-side pricing.',
            items: { $ref: '#/components/schemas/PricingComponent' },
          },
          BillNo: {"type":"string"},
          OrderId: {"type":"string","format":"uuid"},
          SubTotal: {"type":"number"},
          TaxAmount: {"type":"number"},
          Discount: {"type":"number"},
          Total: {"type":"number"},
          Payments: {"type":"object"},
          Status: {"type":"string"},
          SettledAt: {"type":"string","format":"date-time"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosOnlineOrderCreate: {
        type: 'object', required: ["Platform"],
        properties: {
          Platform: {"type":"string"},
          ExternalRef: {"type":"string"},
          Status: {"type":"string"},
          Payload: {"type":"object"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosOnlineOrderUpdate: {
        type: 'object',
        properties: {
          Platform: {"type":"string"},
          ExternalRef: {"type":"string"},
          Status: {"type":"string"},
          Payload: {"type":"object"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosOnlineOrder: {
        type: 'object',
        properties: { ...auditFields,
          Platform: {"type":"string"},
          ExternalRef: {"type":"string"},
          Status: {"type":"string"},
          Payload: {"type":"object"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosFeedbackCreate: {
        type: 'object', required: ["Rating"],
        properties: {
          CustomerId: {"type":"string","format":"uuid"},
          CustomerName: {"type":"string"},
          Rating: {"type":"integer"},
          OrderId: {"type":"string","format":"uuid", nullable: true, description: 'WHICH VISIT this is about. Optional — a comment card left at the door is still worth keeping — but a rating that names its order can be traced to a table, a token and the food that was served. UNIQUE per order: a second card is an edit of the first, not a second opinion.'},
          Comments: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosFeedbackUpdate: {
        type: 'object',
        properties: {
          CustomerId: {"type":"string","format":"uuid"},
          CustomerName: {"type":"string"},
          Rating: {"type":"integer"},
          OrderId: {"type":"string","format":"uuid", nullable: true, description: 'WHICH VISIT this is about. Optional — a comment card left at the door is still worth keeping — but a rating that names its order can be traced to a table, a token and the food that was served. UNIQUE per order: a second card is an edit of the first, not a second opinion.'},
          Comments: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosFeedback: {
        type: 'object',
        properties: { ...auditFields,
          CustomerId: {"type":"string","format":"uuid"},
          CustomerName: {"type":"string"},
          Rating: {"type":"integer"},
          OrderId: {"type":"string","format":"uuid", nullable: true, description: 'WHICH VISIT this is about. Optional — a comment card left at the door is still worth keeping — but a rating that names its order can be traced to a table, a token and the food that was served. UNIQUE per order: a second card is an edit of the first, not a second opinion.'},
          Comments: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosTokenCreate: {
        // TokenNumber/TokenLabel are minted server-side from the branch's
        // numbering mode (pos_setting 'token.numbering'), so a client sends only
        // the queue the token belongs to. Anything else is ignored.
        type: 'object', required: ["BranchDetailId"],
        properties: {
          BranchDetailId: {"type":"string","format":"uuid", description: 'The counter queue this token belongs to.'},
          OrderId: {"type":"string","format":"uuid", description: 'The order behind the token, when there is one.'},
          Active: {"type":"boolean"},
        },
      },
      PosTokenUpdate: {
        type: 'object',
        properties: {
          OrderId: {"type":"string","format":"uuid"},
          Status: {"type":"string", enum: ['waiting', 'called', 'served', 'cancelled']},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosToken: {
        type: 'object',
        properties: { ...auditFields,
          TokenNumber: {"type":"integer", description: 'Sortable counter. In daily mode this is what the customer is told.'},
          TokenLabel: {"type":"string", description: 'What is displayed and called out: "12" or "TOK-0438".'},
          TokenDate: {"type":"string","format":"date", description: 'The day the token belongs to — the reset axis for daily numbering.'},
          OrderId: {"type":"string","format":"uuid"},
          Status: {"type":"string", enum: ['waiting', 'called', 'served', 'cancelled']},
          CalledAt: {"type":"string","format":"date-time", nullable: true},
          ServedAt: {"type":"string","format":"date-time", nullable: true},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      // ── Finance report payloads ────────────────────────────────────────
      // Every one of these reads the LEDGER, never pos_bill: the POS tables are
      // operational state, and a figure taken from them can disagree with the
      // invoice that was actually issued. Only `unbilled` on the pending report
      // is operational, and it says so.
      ReportSalesSummary: {
        type: 'object',
        description: 'Invoiced and collected are reported SEPARATELY — collapsing them into one "revenue" figure is what hides outstanding money.',
        properties: {
          Documents: { type: 'number' },
          NetAmount: { type: 'number' }, TaxAmount: { type: 'number' },
          DiscountAmount: { type: 'number' }, RoundOff: { type: 'number' },
          GrossAmount: { type: 'number', description: 'Invoiced.' },
          Collected: { type: 'number', description: 'Actually taken.' },
          Outstanding: { type: 'number' },
        },
      },
      ReportSales: {
        type: 'object',
        properties: {
          range: reportRange,
          summary: { $ref: '#/components/schemas/ReportSalesSummary' },
          trend: { type: 'array', items: { type: 'object', properties: {
            Bucket: { type: 'string' }, Documents: { type: 'number' },
            GrossAmount: { type: 'number' }, DiscountAmount: { type: 'number' }, TaxAmount: { type: 'number' },
          } } },
        },
      },
      ReportProducts: {
        type: 'object',
        properties: {
          range: reportRange,
          products: { type: 'array', items: { type: 'object', properties: {
            ItemId: { type: 'string', format: 'uuid' }, ItemName: { type: 'string' },
            CategoryName: { type: 'string', nullable: true },
            QuantitySold: { type: 'number' }, NetAmount: { type: 'number' },
            DiscountAmount: { type: 'number', description: 'Stored per-line column, so a line discount and a spread bill discount are both counted exactly once.' },
            TaxAmount: { type: 'number' }, GrossAmount: { type: 'number' }, Documents: { type: 'number' },
          } } },
        },
      },
      ReportPending: {
        type: 'object',
        description: 'Two different questions with two different owners: unbilled is operational (the floor), unpaid is financial (the ledger).',
        properties: {
          range: reportRange,
          unpaid: { type: 'object', properties: {
            documents: { type: 'array', items: { type: 'object', properties: {
              TransactionNo: { type: 'string' }, CustomerName: { type: 'string', nullable: true },
              GrossAmount: { type: 'number' }, Collected: { type: 'number' }, Outstanding: { type: 'number' },
            } } },
            totalOutstanding: { type: 'number' },
          } },
          unbilled: { type: 'object', properties: {
            orders: { type: 'array', items: { type: 'object', properties: {
              OrderNo: { type: 'string' }, OrderType: { type: 'string' },
              Status: { type: 'string' }, Total: { type: 'number' },
            } } },
            totalValue: { type: 'number' },
          } },
        },
      },
      ReportTenders: {
        type: 'object',
        description: 'The Z-report. Refunds and expense payments net out, so a tender line is what that instrument actually took.',
        properties: {
          range: reportRange,
          tenders: { type: 'array', items: { type: 'object', properties: {
            PaymentModeId: { type: 'string', format: 'uuid' }, PaymentMode: { type: 'string' },
            AccountName: { type: 'string' }, Tenders: { type: 'number' },
            Inflow: { type: 'number' }, Outflow: { type: 'number' }, NetAmount: { type: 'number' },
          } } },
        },
      },
      ReportCashFlow: {
        type: 'object',
        properties: {
          range: reportRange,
          accounts: { type: 'array', items: { type: 'object', properties: {
            AccountTypeBaseId: { type: 'string', format: 'uuid' }, AccountName: { type: 'string' },
            AccountKind: { type: 'string' }, Inflow: { type: 'number' },
            Outflow: { type: 'number' }, NetMovement: { type: 'number' },
          } } },
          totals: { type: 'object', properties: {
            Inflow: { type: 'number' }, Outflow: { type: 'number' }, NetMovement: { type: 'number' },
          } },
        },
      },
      ReportExpenses: {
        type: 'object',
        description: 'Settled expense DOCUMENTS only — a draft or merely approved claim is not yet a cost.',
        properties: {
          range: reportRange,
          categories: { type: 'array', items: { type: 'object', properties: {
            ExpenseCategoryId: { type: 'string', format: 'uuid' }, CategoryName: { type: 'string' },
            Entries: { type: 'number' }, Amount: { type: 'number' },
          } } },
          trend: { type: 'array', items: { type: 'object', properties: {
            Bucket: { type: 'string' }, Entries: { type: 'number' }, Amount: { type: 'number' },
          } } },
          totalAmount: { type: 'number' },
        },
      },
      ReportOverview: {
        type: 'object',
        description: 'Only answerable because expenses post to the SAME ledger as sales — money in and money out are rows in one table, so "what is left" is a subtraction rather than a reconciliation.',
        properties: {
          range: reportRange,
          sales: { $ref: '#/components/schemas/ReportSalesSummary' },
          salesTrend: { type: 'array', items: { type: 'object' } },
          expenses: { type: 'object', properties: {
            total: { type: 'number' }, categories: { type: 'array', items: { type: 'object' } },
          } },
          cash: { type: 'object', properties: {
            Inflow: { type: 'number' }, Outflow: { type: 'number' }, NetMovement: { type: 'number' },
          } },
          accounts: { type: 'array', items: { type: 'object' } },
          netPosition: { type: 'number', description: 'COLLECTED minus spent — cash in hand, not invoiced.' },
        },
      },
      ReportVenue: {
        type: 'object',
        description: 'Grouped on the venue snapshot frozen on each round, never on a live join to pos_table — so renaming a table or moving it upstairs leaves last month where it was earned. Rounds with no table are labelled by CHANNEL (Counter / Delivery) rather than pooled under one anonymous row.',
        properties: {
          range: reportRange,
          floors: { type: 'array', items: { type: 'object', properties: {
            FloorId: { type: 'string', nullable: true }, FloorName: { type: 'string' },
            Tables: { type: 'number' }, Seats: { type: 'number' }, ...revenueRow,
            AvgBillValue: { type: 'number' },
            RevenuePerSeat: { type: 'number', nullable: true, description: 'Null rather than a fake zero when capacity is unknown.' },
          } } },
          tables: { type: 'array', items: { type: 'object', properties: {
            FloorId: { type: 'string', nullable: true }, FloorName: { type: 'string' },
            TableId: { type: 'string', nullable: true },
            TableName: { type: 'string', description: 'The table, or the channel name when the round had no table.' },
            Capacity: { type: 'number', nullable: true }, ...revenueRow,
            AvgBillValue: { type: 'number' }, RevenuePerSeat: { type: 'number', nullable: true },
          } } },
          totalGross: { type: 'number' },
        },
      },
      ReportChannels: {
        type: 'object',
        description: 'The same money as the venue report, cut by WHERE THE SALE HAPPENED. Both are built on one apportioned bill→round join, so they cannot disagree about the same bill. A round seated at a table is Dine-in whatever it was typed as — the same rule that decides whether a counter token is issued at settle time.',
        properties: {
          range: reportRange,
          channels: { type: 'array', items: { type: 'object', properties: {
            Channel: { type: 'string', enum: ['Dine-in', 'Counter', 'Delivery', 'Other'] },
            ...revenueRow,
            AvgBillValue: { type: 'number', description: 'What makes a counter and a dining room comparable at all.' },
            ShareOfRevenue: { type: 'number', description: 'Percent of the period’s gross.' },
          } } },
          totalGross: { type: 'number' },
        },
      },
      ReportDiscounts: {
        type: 'object',
        description: 'Split by WHY throughout. ItemDiscountAmount is a decision someone made about that dish; the remainder is the dish’s share of a whole-bill discount. Only the first answers "which products do we choose to give away?".',
        properties: {
          range: reportRange,
          summary: { type: 'object', properties: {
            Documents: { type: 'number' }, DiscountAmount: { type: 'number' },
            ItemDiscountAmount: { type: 'number' }, BillDiscountAmount: { type: 'number' },
            GrossAmount: { type: 'number' },
          } },
          products: { type: 'array', items: { type: 'object' } },
          bills: { type: 'array', items: { type: 'object' } },
        },
      },
      TokenQueueStats: {
        type: 'object',
        description: 'How the counter QUEUE performed, not what it earned — read from pos_token, which is operational state. The money half of the same question is /api/ledger/reports/channels. Tokens still waiting count towards Issued but contribute to no average: a wait that has not ended is not a short wait.',
        properties: {
          range: reportRange,
          summary: { type: 'object', properties: {
            Issued: { type: 'number' }, Served: { type: 'number' },
            Waiting: { type: 'number' }, Called: { type: 'number' }, Cancelled: { type: 'number' },
            AvgWaitMinutes: { type: 'number', nullable: true, description: 'Issued → called. Null when no wait has completed — which is not the same fact as zero.' },
            MaxWaitMinutes: { type: 'number', nullable: true },
            AvgCollectMinutes: { type: 'number', nullable: true, description: 'Called → handed over. Kept apart from the wait above, or the kitchen gets blamed for a customer who wandered off.' },
          } },
          trend: { type: 'array', items: { type: 'object', properties: {
            Bucket: { type: 'string', format: 'date' }, Issued: { type: 'number' },
            Served: { type: 'number' }, AvgWaitMinutes: { type: 'number', nullable: true },
          } } },
        },
      },

      PosCustomerProfile: {
        type: 'object',
        description: 'One customer and everything they have done here. Visits / TotalSpent / '
          + 'LoyaltyPoints are a PROJECTION maintained on the settle path — the ledger stays '
          + 'the record of what was sold, and these are the answers a till needs at the counter '
          + 'without aggregating a year of documents while somebody waits.',
        properties: {
          Customer: { type: 'object', properties: {
            Id: { type: 'string', format: 'uuid' }, Name: { type: 'string' },
            Phone: { type: 'string', nullable: true }, Email: { type: 'string', nullable: true },
            Visits: { type: 'number' }, TotalSpent: { type: 'number' },
            LoyaltyPoints: { type: 'number', description: 'One point per ₹100 spent.' },
            LastVisitAt: { type: 'string', format: 'date-time', nullable: true },
          } },
          Orders: { type: 'array', items: { type: 'object', properties: {
            OrderId: { type: 'string', format: 'uuid' }, OrderNo: { type: 'string' },
            OrderType: { type: 'string' }, Total: { type: 'number' },
            TableName: { type: 'string', nullable: true },
            TokenLabel: { type: 'string', nullable: true, description: 'The counter token, when this was a counter sale.' },
            TransactionNo: { type: 'string', nullable: true, description: 'The invoice, once posted.' },
            LedgerStatus: { type: 'string', nullable: true },
          } } },
          Feedback: { type: 'array', items: { type: 'object', properties: {
            Id: { type: 'string', format: 'uuid' }, Rating: { type: 'integer' },
            Comments: { type: 'string', nullable: true },
            OrderId: { type: 'string', format: 'uuid', nullable: true },
            OrderNo: { type: 'string', nullable: true },
          } } },
          Summary: { type: 'object', properties: {
            OrdersShown: { type: 'number' },
            AverageOrderValue: { type: 'number' },
            AverageRating: { type: 'number', nullable: true, description: 'Null when they have never rated — which is not the same fact as a rating of zero.' },
            RatingsLeft: { type: 'number' },
          } },
        },
      },
      PosCustomerSearchResult: {
        type: 'object',
        properties: {
          Id: { type: 'string', format: 'uuid' }, Name: { type: 'string' },
          Phone: { type: 'string', nullable: true }, Visits: { type: 'number' },
          TotalSpent: { type: 'number' }, LoyaltyPoints: { type: 'number' },
        },
      },

      Invitation: {
        type: 'object',
        description: 'A tenancy asking a person to join it — the counterpart to an onboarding '
          + 'request. A request is raised BY a person and carries no tenant until an admin picks '
          + 'one; an invitation is raised BY a tenancy and carries its tenant and roles from '
          + 'creation. Claimed at login: an invited email joins the INVITING tenancy instead of '
          + 'being auto-provisioned a tenancy of its own.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tenant_id: { type: 'string', format: 'uuid', description: 'Always the inviter\'s own tenancy — taken from the token, never the request body.' },
          email: { type: 'string', format: 'email', description: 'Stored lower-cased; matched case-insensitively at login.' },
          is_admin: { type: 'integer', enum: [0, 1], description: 'TENANT:ADMIN derives from user_tenants.is_admin, not from a role, so this is the only way to invite a co-admin.' },
          status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] },
          invited_by: { type: 'string', format: 'email' },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
          accepted_at: { type: 'string', format: 'date-time', nullable: true },
          role_names: { type: 'string', nullable: true, description: 'Comma-separated, resolved server-side so a list needs no second round trip.' },
          role_count: { type: 'integer' },
        },
      },
      ItemImportRequest: {
        type: 'object', required: ['rows'],
        properties: {
          onDuplicate: {
            type: 'string', enum: ['skip', 'update'], default: 'skip',
            description: 'Item names are unique per tenancy, so a second upload hits every row. '
              + 'skip (the default) leaves existing items completely alone — a re-run at the wrong '
              + 'moment must not silently reset prices somebody has since corrected by hand. '
              + 'update re-points the item at a NEW cost info rather than editing the old one, '
              + 'because a settled ledger line references the cost info it was priced from.',
          },
          rows: {
            type: 'array', minItems: 1, maxItems: 500,
            items: {
              type: 'object', required: ['name', 'category', 'unit', 'price', 'taxGroup'],
              properties: {
                name: { type: 'string', maxLength: 200, description: 'Unique per tenancy.' },
                category: { type: 'string', maxLength: 50, description: 'By name; created if new.' },
                unit: { type: 'string', maxLength: 50, description: 'By name; created if new.' },
                price: { type: 'number', minimum: 0 },
                taxGroup: { type: 'string', maxLength: 50, description: 'By name; created if new.' },
                taxComponents: {
                  type: 'array', maxItems: 6,
                  description: 'The rates that make the group mean something — a group on its own '
                    + 'holds no rate and prices at 0%. Stated rather than inferred from the '
                    + 'group NAME: splitting 5% into CGST and SGST is an Indian intra-state rule, '
                    + 'not arithmetic, and a group called "Standard" carries no rate at all. '
                    + 'WHEN OMITTED the server applies IMPORT.DEFAULT_TAX_COMPONENTS — CGST 2.5 + '
                    + 'SGST 2.5 — on the basis that a menu silently priced at 0% is the worse '
                    + 'failure. The import UI announces how many rows that will touch before it '
                    + 'runs. A row that states its own components overrides the default entirely; '
                    + 'they are never combined, which would double the tax. '
                    + 'Idempotent: an existing tax type is reused by name and an existing mapping '
                    + 'is left alone — there is no unique key on (group, type), so nothing else '
                    + 'would stop a second run doubling the rate.',
                  items: {
                    type: 'object', required: ['name', 'value'],
                    properties: {
                      name: { type: 'string', maxLength: 50, example: 'CGST' },
                      value: { type: 'number', minimum: 0, maximum: 100, example: 2.5 },
                    },
                  },
                },
                taxIncluded: { type: 'boolean', default: true, description: 'Defaults true: a board price is what the customer hands over.' },
                code: { type: 'string', maxLength: 50, nullable: true },
                description: { type: 'string', maxLength: 1000, nullable: true },
                foodType: { type: 'string', maxLength: 50, nullable: true, description: 'Used by the publish pass only; carried here so one file drives both.' },
              },
            },
          },
        },
      },
      MenuImportRequest: {
        type: 'object', required: ['branchDetailId', 'items'],
        properties: {
          branchDetailId: { type: 'string', format: 'uuid' },
          defaultFoodType: { type: 'string', default: 'VEG', description: 'A FALLBACK for rows that name no food type — not an override. A row\'s own foodType always wins; sending one default for the whole file is what published every item on a mixed menu as Veg.' },
          channelIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          variantIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          items: {
            type: 'array', minItems: 1, maxItems: 500,
            items: {
              type: 'object', required: ['name'],
              properties: {
                name: { type: 'string', description: 'Matched against itemdetail.Name.' },
                foodType: {
                  type: 'string', nullable: true,
                  description: 'Matched against the food type NAME or CODE, ignoring case and '
                    + 'punctuation — Non-Veg, non veg, NONVEG and Non_Veg all reach the same row, '
                    + 'and the exact value the template asks for used to be the one that failed. '
                    + 'Matching is exact after normalising, never a prefix, so VEG does not match '
                    + 'VEGAN. An unmatched value is reported per row NAMING the food types the '
                    + 'tenancy actually has.',
                },
              },
            },
          },
        },
      },
      ImportResult: {
        type: 'object',
        description: 'Per-row outcomes. The caller never has to infer what happened from an error string.',
        properties: {
          summary: {
            type: 'object',
            properties: {
              total: { type: 'integer' }, created: { type: 'integer' },
              updated: { type: 'integer' }, skipped: { type: 'integer' },
              failed: { type: 'integer' },
            },
          },
          created: {
            type: 'object',
            description: 'Masters brought into existence along the way.',
            properties: {
              categories: { type: 'integer' }, units: { type: 'integer' }, taxGroups: { type: 'integer' },
            },
          },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                row: { type: 'integer', description: 'Numbered from 1, the way the file is.' },
                name: { type: 'string' },
                status: { type: 'string', enum: ['created', 'updated', 'skipped', 'failed'] },
                reason: { type: 'string', description: 'Present on skipped and failed.' },
                itemId: { type: 'string', format: 'uuid' },
                menuItemId: { type: 'string', format: 'uuid' },
              },
            },
          },
        },
      },
      TenantMember: {
        type: 'object',
        description: 'A membership: the person, what they may do, and their staff details. '
          + 'Staff and users are one entity — the membership row IS the staff record.',
        properties: {
          user_email: { type: 'string', format: 'email' },
          tenant_id: { type: 'string', format: 'uuid' },
          full_name: { type: 'string', nullable: true, description: 'Null until somebody sets it; fall back to the email.' },
          phone: { type: 'string', nullable: true },
          branch_detail_id: { type: 'string', format: 'uuid', nullable: true },
          branch_name: { type: 'string', nullable: true },
          roles: { type: 'string', nullable: true, description: 'Comma-joined role names.' },
          is_admin: { type: 'integer', description: 'Tenant administrator. Derived from the membership flag, never from a role.' },
          is_super_admin: { type: 'integer' },
          is_active: { type: 'integer' },
          status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] },
          last_active_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      InvitationCreate: {
        type: 'object',
        required: ['email'],
        description: 'The tenancy is NOT accepted here — it comes from the caller\'s token, so a '
          + 'tenant admin can only invite into their own.',
        properties: {
          email: { type: 'string', format: 'email', maxLength: 255 },
          roleIds: {
            type: 'array', items: { type: 'string', format: 'uuid' },
            description: 'Roles granted on acceptance. Must belong to the inviting tenancy. '
              + 'May be empty — the membership is still created, and the acceptance path warns.',
          },
          isAdmin: { type: 'boolean', default: false, description: 'Invite them as a tenant admin.' },
          fullName: {
            type: 'string', maxLength: 100,
            description: 'Staff details, stamped onto the membership when the invitation is '
              + 'claimed. Adding a staff member IS inviting them — a membership of a tenancy is '
              + 'the staff record — so these travel with the invite rather than needing a second '
              + 'edit once the person first signs in.',
          },
          phone: { type: 'string', maxLength: 20 },
          branchDetailId: { type: 'string', format: 'uuid', description: 'Home branch.' },
        },
      },

      PosSettings: {
        // Per-branch POS preferences. Every known key is always present —
        // defaults are filled in for keys the branch has never saved.
        type: 'object',
        properties: {
          'token.numbering': {
            type: 'string', enum: ['daily', 'series'], default: 'daily',
            description: 'daily: counter tokens restart at 1 each day, per branch. '
              + 'series: continuous TOK-0001 from the tenant-wide POS_TOKEN series.',
          },
        },
      },
      PosExpenseCreate: {
        type: 'object', required: ["Category","Amount"],
        properties: {
          Category: {"type":"string"},
          Description: {"type":"string"},
          Amount: {"type":"number"},
          ExpenseDate: {"type":"string","format":"date-time"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosExpenseUpdate: {
        type: 'object',
        properties: {
          Category: {"type":"string"},
          Description: {"type":"string"},
          Amount: {"type":"number"},
          ExpenseDate: {"type":"string","format":"date-time"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosExpense: {
        type: 'object',
        properties: { ...auditFields,
          Category: {"type":"string"},
          Description: {"type":"string"},
          Amount: {"type":"number"},
          ExpenseDate: {"type":"string","format":"date-time"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
    },
  },

  paths: {
    ...crudPaths('TaxTypes',                       '/api/taxtypes',                        'TaxTypeCreate',                       'TaxTypeUpdate',                       'TaxType',                       false),
    ...crudPaths('UOM',                            '/api/uom',                             'UOMCreate',                           'UOMUpdate',                           'UOM',                           false),
    ...crudPaths('Categories',                     '/api/categories',                      'CategoryCreate',                      'CategoryUpdate',                      'Category',                      false),
    ...crudPaths('TransactionTypeConfig',          '/api/transactiontypeconfigs',          'TransactionTypeConfigCreate',         'TransactionTypeConfigUpdate',         'TransactionTypeConfig',         true),
    ...crudPaths('Organizations',                  '/api/organizations',                   'OrganizationCreate',                  'OrganizationUpdate',                  'Organization',                  false),
    '/api/master-data/bootstrap': {
      post: {
        tags: ['Master Data — Setup'],
        summary: 'First-time master-data bootstrap (Organization + Branch + optional Item) in one transaction',
        description:
          'Creates the whole nested master-data tree atomically. Send a nested payload with NO ids — the server resolves foreign keys and inserts bottom-up inside a single transaction. If any step fails, the entire operation is rolled back. Requires TENANT:ADMIN.\n\n' +
          'This endpoint runs ONCE per tenant. On success the tenant is marked COMPLETED in `tenant_setup` (inside the same transaction), which lifts the first-time setup gate; a second call returns 409. The 201 response carries a refreshed `setupToken` — a JWT identical to the caller\'s but with `setupCompleted: true` — so the client can unlock the application without a re-login.',
        security,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MasterDataBootstrap' } } },
        },
        responses: {
          201: {
            description: 'All records created; returns a map of entity → generated id, plus a refreshed setupToken',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MasterDataBootstrapResult' } } },
          },
          ...responses.validation,
          ...responses.unauthorized,
          ...responses.forbidden,
          409: { description: 'Conflict — either this tenant has already completed setup, or a unique constraint (e.g. Code/Name) was violated; nothing was saved' },
        },
      },
    },
    '/api/ledger/documents': {
      get: {
        tags: ['Ledger'],
        summary: 'List accounting documents',
        description:
          'Settled POS bills posted as numbered Sale documents. Read-only: a settled document is corrected by refund, never by editing.\n\nGated on TRANSACTIONS:READ/WRITE — a ledger document IS the transaction record.',
        security,
        parameters: [
          ...paginationParams,
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['DRAFT', 'PARTIALLY_PAID', 'SETTLED', 'CANCELLED', 'REFUNDED'] } },
          { name: 'fromDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'toDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'contactDetailId', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Everything this customer bought.' },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Matches invoice number, customer name or mobile.' },
        ],
        responses: { ...paginatedResponse('LedgerDocumentSummary'), ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/ledger/documents/{id}': {
      get: {
        tags: ['Ledger'],
        summary: 'One document in full',
        description:
          'Header, lines (with variants and per-line tax), tenders, and the transition history proving how it reached its current status.',
        security,
        parameters: [idParam],
        responses: { ...singleResponse('LedgerDocument'), ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/ledger/documents/{id}/refund': {
      post: {
        tags: ['Ledger'],
        summary: 'Reverse a settled document (whole document)',
        description:
          'Moves SETTLED → REFUNDED and writes a negative tender back to the mode each payment came in on.\n\n**Nothing is deleted or overwritten** — the original document stands and the reversal sits beside it. Only a SETTLED document can be refunded; the transition whitelist has no SETTLED → CANCELLED. Requires TRANSACTIONS:WRITE.',
        security,
        parameters: [idParam],
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { type: 'object', properties: { Reason: { type: 'string', maxLength: 100 } } } } },
        },
        responses: {
          200: { description: 'Refunded', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { type: 'object', properties: { transactionDetailLogId: { type: 'string' }, status: { type: 'string', example: 'REFUNDED' } } } } } } } },
          409: { description: 'Not settled, so not refundable' },
          ...responses.notFound, ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },

    // ── Finance reports ───────────────────────────────────────────────────
    // Nine cuts of the same ledger, one query contract. Gated on TRANSACTIONS
    // read/write, not on the POS scopes: a ledger document IS the transaction
    // record.
    '/api/ledger/reports/overview': reportPath('LedgerReports', 'Earned, collected, spent, and what is left', 'ReportOverview',
      'The daily cash-flow question in one call.'),
    '/api/ledger/reports/sales': reportPath('LedgerReports', 'Invoiced vs collected, with a bucketed trend', 'ReportSales'),
    '/api/ledger/reports/products': reportPath('LedgerReports', 'Quantity, revenue and discount per product', 'ReportProducts',
      'Ranked and capped — a leaderboard, not a data dump.'),
    '/api/ledger/reports/pending': reportPath('LedgerReports', 'Unbilled rounds and unpaid documents', 'ReportPending'),
    '/api/ledger/reports/tenders': reportPath('LedgerReports', 'Tender mix (the Z-report)', 'ReportTenders'),
    '/api/ledger/reports/cashflow': reportPath('LedgerReports', 'Money in, out and net per asset account', 'ReportCashFlow'),
    '/api/ledger/reports/expenses': reportPath('LedgerReports', 'Spend by category, from settled documents', 'ReportExpenses'),
    '/api/ledger/reports/venue': reportPath('LedgerReports', 'Revenue by floor and by table', 'ReportVenue'),
    '/api/ledger/reports/channels': reportPath('LedgerReports', 'Revenue by sales channel', 'ReportChannels',
      'Dine-in, counter and delivery. Counter sales were always in every total — a counter bill posts the same ledger document as any other — but until this report nothing could name them.'),
    '/api/ledger/reports/discounts': reportPath('LedgerReports', 'What was given away, and why', 'ReportDiscounts'),
    '/api/pricing/quote': {
      post: {
        tags: ['Pricing'],
        summary: 'Calculate price + tax for a set of lines (stateless)',
        description:
          'Prices lines over the master-data chain `costinfo → taxgroup → taxgrouptaxtypemapper → TaxTypes`, honouring each cost record\'s `IsTaxIncluded` flag.\n\n' +
          '**Stateless — stores nothing.** Safe to call repeatedly from a cart UI.\n\n' +
          'Policy applied here (identical everywhere in the project):\n' +
          '- Discounts are applied **before** tax. A document-level discount is apportioned across lines in proportion to their value.\n' +
          '- Tax is rounded **per line**, then summed, so printed lines always add up to the printed total.\n' +
          '- Tax components (e.g. CGST + SGST) are allocated by largest remainder so they sum **exactly** to the line tax.\n\n' +
          'A tax group with no active tax types is a valid 0% ("Exempt") group, not an error. Inactive tax types are excluded automatically.',
        security,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PricingQuoteRequest' } } },
        },
        responses: {
          200: {
            description: 'Priced lines and document totals',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: true },
                message: { type: 'string' },
                data: { $ref: '#/components/schemas/PricingQuoteResult' },
              },
            }}},
          },
          ...responses.validation,
          ...responses.unauthorized,
          ...responses.forbidden,
        },
      },
    },
    '/api/pricing/tax-groups/{taxGroupId}/rate': {
      get: {
        tags: ['Pricing'],
        summary: 'Effective rate and components for a tax group',
        description:
          'Returns the group\'s active tax types and their summed effective rate — e.g. GST18 → CGST 9% + SGST 9% = 18%. For UI display; no amount is involved.',
        security,
        parameters: [
          { name: 'taxGroupId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'Tax group rate',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: true },
                message: { type: 'string' },
                data: { $ref: '#/components/schemas/TaxGroupRate' },
              },
            }}},
          },
          ...responses.notFound,
          ...responses.unauthorized,
          ...responses.forbidden,
        },
      },
    },
    '/api/master-data/status': {
      get: {
        tags: ['Master Data — Setup'],
        summary: 'First-time tenancy setup status for the caller\'s tenant',
        description:
          'Reports whether this tenant has completed the first-time setup wizard. A tenant that has never run it reports PENDING.\n\n' +
          'Authenticated but deliberately NOT scope-gated beyond that: a non-admin user who is blocked by the setup gate still needs to be able to see why.',
        security,
        responses: {
          200: {
            description: 'Current tenancy setup status',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: true },
                message: { type: 'string' },
                data: { $ref: '#/components/schemas/TenantSetupStatus' },
              },
            }}},
          },
          ...responses.unauthorized,
        },
      },
    },
    '/api/admin/app-config': {
      get: {
        tags: ['Admin — App Config'],
        summary: 'Get global application configuration (SUPER-ADMIN only)',
        description: 'Returns system-wide settings such as the onboarding auto-approval flag. Requires TENANT:SUPER_ADMIN.',
        security,
        responses: {
          200: { description: 'Current application configuration', content: { 'application/json': { schema: { $ref: '#/components/schemas/AppConfig' } } } },
          ...responses.unauthorized,
          ...responses.forbidden,
        },
      },
      patch: {
        tags: ['Admin — App Config'],
        summary: 'Update global application configuration (SUPER-ADMIN only)',
        description: 'Updates system-wide settings. When onboarding auto-approval is enabled, brand-new sign-ins are provisioned automatically into a new tenant as its TENANT_ADMIN. Requires TENANT:SUPER_ADMIN.',
        security,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AppConfigUpdate' } } },
        },
        responses: {
          200: { description: 'Updated application configuration', content: { 'application/json': { schema: { $ref: '#/components/schemas/AppConfig' } } } },
          ...responses.validation,
          ...responses.unauthorized,
          ...responses.forbidden,
        },
      },
    },
    ...crudPaths('UOMFactors',                     '/api/uomfactors',                      'UOMFactorCreate',                     'UOMFactorUpdate',                     'UOMFactor',                     false),
    ...crudPaths('TransactionTypes',               '/api/transactiontypes',                'TransactionTypeCreate',               'TransactionTypeUpdate',               'TransactionType',               true),
    ...crudPaths('AccountTypeBases',               '/api/accounttypebases',                'AccountTypeBaseCreate',               'AccountTypeBaseUpdate',               'AccountTypeBase',               false),
    ...crudPaths('TransactionTypeStatuses',        '/api/transactiontypestatuses',         'TransactionTypeStatusCreate',         'TransactionTypeStatusUpdate',         'TransactionTypeStatus',         false),
    ...crudPaths('ContactAddressTypes',            '/api/contactaddresstypes',             'ContactAddressTypeCreate',            'ContactAddressTypeUpdate',            'ContactAddressType',            false),
    ...crudPaths('TaxGroups',                      '/api/taxgroups',                       'TaxGroupCreate',                      'TaxGroupUpdate',                      'TaxGroup',                      false),
    ...crudPaths('TaxGroupTaxTypeMappers',         '/api/taxgrouptaxtypemappers',          'TaxGroupTaxTypeMapperCreate',         'TaxGroupTaxTypeMapperUpdate',         'TaxGroupTaxTypeMapper',         false),
    ...crudPaths('MapProviders',                   '/api/mapproviders',                    'MapProviderCreate',                   'MapProviderUpdate',                   'MapProvider',                   false),
    ...crudPaths('LocationDetails',                '/api/locationdetails',                 'LocationDetailCreate',                'LocationDetailUpdate',                'LocationDetail',                false),
    ...crudPaths('MapProviderLocationMappers',     '/api/mapproviderlocationmappers',      'MapProviderLocationMapperCreate',     'MapProviderLocationMapperUpdate',     'MapProviderLocationMapper',     true),
    ...crudPaths('ContactDetails',                 '/api/contactdetails',                  'ContactDetailCreate',                 'ContactDetailUpdate',                 'ContactDetail',                 true),
    ...crudPaths('AddressDetails',                 '/api/addressdetails',                  'AddressDetailCreate',                 'AddressDetailUpdate',                 'AddressDetail',                 true),
    ...crudPaths('CostInfos',                      '/api/costinfos',                       'CostInfoCreate',                      'CostInfoUpdate',                      'CostInfo',                      true),
    ...crudPaths('BranchDetails',                  '/api/branchdetails',                   'BranchDetailCreate',                  'BranchDetailUpdate',                  'BranchDetail',                  true),
    ...crudPaths('BranchUserGroupMappers',         '/api/branchusergroupmappers',          'BranchUserGroupMapperCreate',         'BranchUserGroupMapperUpdate',         'BranchUserGroupMapper',         false),
    ...crudPaths('BatchDetails',                   '/api/batchdetails',                    'BatchDetailCreate',                   'BatchDetailUpdate',                   'BatchDetail',                   true),
    ...crudPaths('ItemDetails',                    '/api/itemdetails',                     'ItemDetailCreate',                    'ItemDetailUpdate',                    'ItemDetail',                    true),
    ...crudPaths('TransactionTypeBaseConversions', '/api/transactiontypebaseconversions',  'TransactionTypeBaseConversionCreate', 'TransactionTypeBaseConversionUpdate', 'TransactionTypeBaseConversion', true),
    ...crudPaths('TransactionDetailLogs',          '/api/transactiondetaillogs',           'TransactionDetailLogCreate',          'TransactionDetailLogUpdate',          'TransactionDetailLog',          true),
    ...crudPaths('TransactionItemDetails',         '/api/transactionitemdetails',          'TransactionItemDetailCreate',         'TransactionItemDetailUpdate',         'TransactionItemDetail',         true),
    ...crudPaths('TransactionTypeConversionMappers', '/api/transactiontypeconversionmappers', 'TransactionTypeConversionMapperCreate', 'TransactionTypeConversionMapperUpdate', 'TransactionTypeConversionMapper', true),
    ...crudPaths('PaymentReceivedTypes',           '/api/paymentreceivedtypes',            'PaymentReceivedTypeCreate',           'PaymentReceivedTypeUpdate',           'PaymentReceivedType',           false),
    ...crudPaths('PaymentModes',                   '/api/paymentmodes',                    'PaymentModeCreate',                   'PaymentModeUpdate',                   'PaymentMode',                   false),
    ...crudPaths('PaymentModeTransactionDetails',  '/api/paymentmodetransactiondetails',   'PaymentModeTransactionDetailCreate',  'PaymentModeTransactionDetailUpdate',  'PaymentModeTransactionDetail',  true),
    ...crudPaths('PaymentDetails',                 '/api/paymentdetails',                  'PaymentDetailCreate',                 'PaymentDetailUpdate',                 'PaymentDetail',                 true),
    ...crudPaths('PaymentBreakups',                '/api/paymentbreakups',                 'PaymentBreakupCreate',                'PaymentBreakupUpdate',                'PaymentBreakup',                true),

    // ─── POS (Front Desk) ───
    ...crudPaths('PosFloors', '/api/pos/floors', 'PosFloorCreate', 'PosFloorUpdate', 'PosFloor', false),
    ...crudPaths('PosTables', '/api/pos/tables', 'PosTableCreate', 'PosTableUpdate', 'PosTable', false),
    ...crudPaths('PosItemMeta', '/api/pos/item-meta', 'PosItemMetaCreate', 'PosItemMetaUpdate', 'PosItemMeta', false),
    ...crudPaths('PosChannels', '/api/pos/channels', 'PosChannelCreate', 'PosChannelUpdate', 'PosChannel', false),
    ...crudPaths('PosVariants', '/api/pos/variants', 'PosVariantCreate', 'PosVariantUpdate', 'PosVariant', false),
    ...crudPaths('PosCustomers', '/api/pos/customers', 'PosCustomerCreate', 'PosCustomerUpdate', 'PosCustomer', false),
    ...crudPaths('PosOrders', '/api/pos/orders', 'PosOrderCreate', 'PosOrderUpdate', 'PosOrder', false),
    ...crudPaths('PosKots', '/api/pos/kots', 'PosKotCreate', 'PosKotUpdate', 'PosKot', false),
    ...crudPaths('PosBills', '/api/pos/bills', 'PosBillCreate', 'PosBillUpdate', 'PosBill', false),
    ...crudPaths('PosOnlineOrders', '/api/pos/online-orders', 'PosOnlineOrderCreate', 'PosOnlineOrderUpdate', 'PosOnlineOrder', false),
    ...crudPaths('PosFeedback', '/api/pos/feedback', 'PosFeedbackCreate', 'PosFeedbackUpdate', 'PosFeedback', false),
    ...crudPaths('PosTokens', '/api/pos/tokens', 'PosTokenCreate', 'PosTokenUpdate', 'PosToken', false),
    ...crudPaths('PosExpenses', '/api/pos/expenses', 'PosExpenseCreate', 'PosExpenseUpdate', 'PosExpense', false),

    // POS domain actions (beyond CRUD)
    '/api/pos/orders/{id}/fire-kot': {
      post: {
        tags: ['PosOrders'], summary: 'Fire a KOT from this order', security,
        parameters: [idParam],
        responses: { ...singleResponse('PosKot', 201), ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/pos/kots/{id}/ready': {
      patch: {
        tags: ['PosKots'], summary: 'Mark a KOT ready (KDS)', security,
        parameters: [idParam],
        responses: { ...singleResponse('PosKot'), ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/pos/bills/{id}/settle': {
      post: {
        tags: ['PosBills'],
        summary: 'Settle a bill (record payments, mark paid)',
        // A counter sale — every round takeaway, none at a table — also gets its
        // queue token minted here, inside the same transaction, and the response
        // carries TokenLabel/TokenNumber/TokenDate.
        description: 'Posts the bill to the ledger. For a counter sale the response also '
          + 'carries the token issued to the customer (TokenLabel, TokenNumber, TokenDate).',
        security,
        parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PosBillSettle' } } } },
        responses: { ...singleResponse('PosBill'), ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/import/items': {
      post: {
        tags: ['Import'],
        summary: 'Bulk-create catalogue items from a parsed CSV',
        description: 'TENANT ADMIN ONLY, deliberately narrower than the scopes the individual '
          + 'screens use: one request creates categories, units, tax groups, items and cost info '
          + 'across the whole tenancy, so the blast radius of a bad file is the catalogue rather '
          + 'than a row. MASTER_DATA:WRITE, INVENTORY:WRITE or POS_CONFIG:WRITE on their own are '
          + 'all refused. '
          + 'The CSV is parsed in the BROWSER and posted as JSON — there is no upload endpoint, no '
          + 'multipart handling and no new dependency, and the person sees the parse before '
          + 'anything is sent. '
          + 'Categories, units and tax groups are resolved by name and created only when missing, '
          + 'so 56 rows naming eight categories produce eight categories. '
          + 'Every record is written through the same createTx the ordinary forms call, so an '
          + 'imported item is an ORDINARY item — it edits in Master Data → Items and publishes in '
          + 'Menu Master like any other, and carries no import marker of any kind. '
          + 'ALWAYS answers 200: one transaction per ROW, so a bad row 37 does not discard the 36 '
          + 'before it, and the response reports the outcome of every row.',
        security,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ItemImportRequest' } } },
        },
        responses: {
          200: { description: 'Finished — check the per-row outcomes',
            content: { 'application/json': { schema: { type: 'object', properties: {
              success: { type: 'boolean' }, message: { type: 'string' },
              data: { $ref: '#/components/schemas/ImportResult' },
            } } } } },
          ...responses.validation, ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/import/menu-entries': {
      post: {
        tags: ['Import'],
        summary: 'Publish catalogue items onto one branch’s menu',
        description: 'TENANT ADMIN ONLY. The second half of an import, and the half people forget: '
          + 'items are tenancy-wide, and nothing sells until it exists as a menu entry against a '
          + 'branch. Takes item NAMES rather than ids so the same file drives both passes. '
          + 'UNIQUE (ItemDetailId, BranchDetailId, TenantId) means a re-run reports "already on '
          + 'this branch\'s menu" instead of failing. '
          + 'Menu entries are created through positemmeta\'s ordinary create(), which already '
          + 'opens its own transaction and syncs the channel and variant links — so that module '
          + 'is untouched by this feature.',
        security,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MenuImportRequest' } } },
        },
        responses: {
          200: { description: 'Finished — check the per-row outcomes',
            content: { 'application/json': { schema: { type: 'object', properties: {
              success: { type: 'boolean' }, message: { type: 'string' },
              data: { $ref: '#/components/schemas/ImportResult' },
            } } } } },
          ...responses.validation, ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/import/preview': {
      post: {
        tags: ['Import'],
        summary: 'Checks the browser cannot make for itself',
        description: 'TENANT ADMIN ONLY. Writes nothing. Returns which of the named tax groups '
          + 'hold no tax types — a group with none computes 0% tax and looks like a perfectly '
          + 'working setup, which is the failure mode that silently prices a whole menu at zero. '
          + 'A group that does not exist yet counts as empty, because the import would create it '
          + 'empty. Reported as a warning rather than an error: a genuinely zero-rated group is '
          + 'legitimate.',
        security,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['taxGroups'],
            properties: { taxGroups: { type: 'array', items: { type: 'string' }, maxItems: 50 } },
          } } },
        },
        responses: {
          200: { description: 'Checks complete',
            content: { 'application/json': { schema: { type: 'object', properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: {
                emptyTaxGroups: { type: 'array', items: { type: 'string' } },
              } },
            } } } } },
          ...responses.validation, ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/admin/tenants': {
      get: {
        tags: ['AdminUsers'],
        summary: 'Every tenancy on the platform, with its own totals',
        description: 'SUPER ADMIN ONLY. One row per tenancy rather than per membership — '
          + '/api/admin/users/all pages the flat membership list, which cannot be grouped for '
          + 'display because a page boundary can fall inside a tenancy and split its people '
          + 'across two pages. Counts use COUNT(DISTINCT CASE …) rather than SUM: joining '
          + 'user_roles multiplies a membership by the roles it holds, so SUM(is_admin) would '
          + 'report an admin holding three roles as three admins. '
          + 'admin_count = 0 is worth surfacing — nobody in that tenancy can invite staff, '
          + 'assign a role or open Access & Staff, and only a super admin can see it.',
        security,
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: { description: 'Success', content: { 'application/json': { schema: { type: 'object', properties: {
            success: { type: 'boolean' }, message: { type: 'string' },
            data: { type: 'array', items: {
              type: 'object',
              properties: {
                tenant_id: { type: 'string', format: 'uuid' },
                tenant_name: { type: 'string', nullable: true, description: 'First organisation on the tenancy. Null when none has been created — render a fallback rather than a blank.' },
                user_count: { type: 'integer' },
                admin_count: { type: 'integer' },
                super_admin_count: { type: 'integer' },
                suspended_count: { type: 'integer' },
                branch_count: { type: 'integer' },
                last_active_at: { type: 'string', format: 'date-time', nullable: true },
                setup_status: { type: 'string', enum: ['COMPLETED', 'PENDING'] },
                setup_completed_at: { type: 'string', format: 'date-time', nullable: true },
                roles: { type: 'string', nullable: true, description: 'Distinct role names in use in that tenancy, comma-joined.' },
              },
            } },
            pagination: { type: 'object' },
          } } } } },
          ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/admin/tenants/{tenantId}/users': {
      get: {
        tags: ['AdminUsers'],
        summary: 'The people in one tenancy — any tenancy',
        description: 'SUPER ADMIN ONLY, and read-only. The tenancy comes from the PATH rather '
          + 'than from the token, which is the whole difference between this and GET /users and '
          + 'the reason for the guard: a tenant admin passing another tenancy id here would be '
          + 'reading somebody else\'s staff list. '
          + 'Returns the same shape as GET /users, staff profile included. An empty array means '
          + 'the tenancy has no members — an answer, not a 404. '
          + 'There is deliberately no matching write: role assignment stays scoped to the '
          + 'caller\'s own tenancy.',
        security,
        parameters: [{ name: 'tenantId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Success', content: { 'application/json': { schema: { type: 'object', properties: {
            success: { type: 'boolean' }, message: { type: 'string' },
            data: { type: 'array', items: { $ref: '#/components/schemas/TenantMember' } },
          } } } } },
          ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/admin/users/{email}/profile': {
      put: {
        tags: ['AdminUsers'],
        summary: 'Update a member\'s staff details (name, phone, branch)',
        description: 'Staff and users are ONE entity: a membership of a tenancy IS a staff record, '
          + 'so these details live on user_tenants and there is no separate roster to keep in step. '
          + '(The old pos_staff table and /api/pos/staff are retired.) They are per-MEMBERSHIP, not '
          + 'per-person: the same Google account can be "Priya, Head Chef, Central" here and hold a '
          + 'different name and branch in another tenancy. '
          + 'Deliberately separate from roles and from the admin flag — what somebody is CALLED, '
          + 'what they may DO and whether they may ADMINISTER are three decisions carrying three '
          + 'different risks, and correcting a phone number should not go near a permission.',
        security,
        parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string', format: 'email' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', minProperties: 1,
            properties: {
              fullName: { type: 'string', maxLength: 100, nullable: true },
              phone: { type: 'string', maxLength: 20, nullable: true },
              branchDetailId: { type: 'string', format: 'uuid', nullable: true, description: 'Home branch. Null for someone who is not tied to one.' },
            },
          } } },
        },
        responses: {
          200: { description: 'Staff details updated' },
          ...responses.validation, ...responses.notFound,
          ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/admin/users/{email}/admin': {
      put: {
        tags: ['AdminUsers'],
        summary: 'Grant or withdraw tenant-administrator access',
        description: 'TENANT:ADMIN is derived from user_tenants.is_admin at login and NEVER from '
          + 'a role — assigning a role NAMED "TENANT_ADMIN" or "SUPER_ADMIN" grants that role\'s '
          + 'feature scopes and nothing more, which is why such a user could still be refused the '
          + 'admin screens. Deriving the flag from role names is deliberately not done: roles are '
          + 'per-tenant and freely renamable, so a rename would silently revoke administration. '
          + 'is_super_admin is NOT settable here — it bypasses every scope check and reaches '
          + 'across tenancies, so it stays a deployment decision. '
          + 'Scopes live in the JWT, so the affected user must sign in again for this to take effect.',
        security,
        parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string', format: 'email' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object', required: ['isAdmin'],
            properties: { isAdmin: { type: 'boolean' } },
          } } },
        },
        responses: {
          200: { description: 'Access updated' },
          403: { description: 'Self-demotion, or the target is a super admin' },
          ...responses.validation, ...responses.notFound,
          ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/admin/users/{email}': {
      delete: {
        tags: ['AdminUsers'],
        summary: 'Remove a user from THIS tenancy',
        description: 'Membership-scoped, never a global delete. There is no users table — identity '
          + 'is the Google account — so this ends the membership and its role grants for the '
          + 'caller\'s tenancy only. A person who belongs to other tenancies keeps those; a person '
          + 'left with none becomes an unprovisioned email and starts fresh on their next sign-in '
          + '(a new onboarding request, or a new tenancy if auto-approval is on). '
          + 'Use PUT /users/{email}/status to suspend reversibly instead.',
        security,
        parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string', format: 'email' } }],
        responses: {
          200: { description: 'Removed from this tenancy' },
          403: { description: 'You cannot remove your own account' },
          ...responses.notFound, ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/admin/invitations': {
      get: {
        tags: ['Invitations'],
        summary: 'Invitations this tenancy has raised',
        description: 'Scoped to the caller\'s own tenancy. Tenant admins and super admins.',
        security,
        responses: {
          200: { description: 'Success', content: { 'application/json': { schema: { type: 'object', properties: {
            success: { type: 'boolean' }, message: { type: 'string' },
            data: { type: 'array', items: { $ref: '#/components/schemas/Invitation' } },
          } } } } },
          ...responses.unauthorized, ...responses.forbidden,
        },
      },
      post: {
        tags: ['Invitations'],
        summary: 'Invite an email into this tenancy',
        description: 'The invitee joins on their next sign-in, with the roles named here. Works '
          + 'whether or not they already have an account, and whether or not onboarding '
          + 'auto-approval is enabled — an invitation is itself the authorization.',
        security,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/InvitationCreate' } } } },
        responses: {
          ...singleResponse('Invitation', 201),
          409: { description: 'Already a member of this tenancy, or an invitation is already pending for that email' },
          ...responses.validation, ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/admin/invitations/{id}': {
      delete: {
        tags: ['Invitations'],
        summary: 'Withdraw a pending invitation',
        description: 'Marked REVOKED rather than deleted — who invited whom, and who changed '
          + 'their mind, stays answerable. The email may then be re-invited.',
        security,
        parameters: [idParam],
        responses: {
          ...responses.noContent,
          404: { description: 'No pending invitation with that id in this tenancy' },
          ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/pos/customers/search': {
      get: {
        tags: ['PosCustomers'],
        summary: 'Find a customer at the counter',
        description: 'Phone or name, capped at ten. Backs a type-ahead beside a till, not an export.',
        security,
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 50 } }],
        responses: {
          200: { description: 'Matches', content: { 'application/json': { schema: { type: 'object', properties: {
            success: { type: 'boolean' }, message: { type: 'string' },
            data: { type: 'array', items: { $ref: '#/components/schemas/PosCustomerSearchResult' } },
          } } } } },
          ...responses.validation, ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/pos/customers/{id}/profile': {
      get: {
        tags: ['PosCustomers'],
        summary: 'A customer\'s spend, order history and ratings',
        security,
        parameters: [idParam],
        responses: {
          ...singleResponse('PosCustomerProfile'),
          ...responses.notFound, ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/pos/tokens/stats': {
      get: {
        tags: ['PosTokens'],
        summary: 'Counter queue performance',
        description: 'How long people waited, not what they paid. Shares the finance reports\' timeframe vocabulary so one range means the same thing on both sides of the screen.',
        security,
        parameters: reportParams.filter((p) => ['preset', 'fromDate', 'toDate', 'branchId'].includes(p.name)),
        responses: {
          ...singleResponse('TokenQueueStats'),
          ...responses.validation, ...responses.unauthorized, ...responses.forbidden,
        },
      },
    },
    '/api/pos/tokens/{id}/call': {
      post: {
        tags: ['PosTokens'],
        summary: 'Call a token to the counter',
        description: 'Stamps CalledAt the first time only, so a recall keeps the original call time.',
        security,
        parameters: [idParam],
        responses: { ...singleResponse('PosToken'), ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/pos/tokens/{id}/serve': {
      post: {
        tags: ['PosTokens'], summary: 'Mark a token handed over', security,
        parameters: [idParam],
        responses: { ...singleResponse('PosToken'), ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/pos/settings': {
      get: {
        tags: ['PosSettings'],
        summary: 'Per-branch POS settings',
        description: 'Every known key is returned, with defaults filled in for keys this branch has never saved.',
        security,
        parameters: [{ name: 'branchId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { ...singleResponse('PosSettings'), ...responses.validation, ...responses.unauthorized, ...responses.forbidden },
      },
      put: {
        tags: ['PosSettings'], summary: 'Update per-branch POS settings', security,
        parameters: [{ name: 'branchId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PosSettings' } } } },
        responses: { ...singleResponse('PosSettings'), ...responses.validation, ...responses.unauthorized, ...responses.forbidden },
      },
    },

    // ── Onboarding (guest scope) ───────────────────────────────────────────
    '/api/onboarding/status': {
      get: {
        tags: ['Onboarding'], summary: 'Get my onboarding request status', security,
        responses: { ...singleResponse('OnboardingStatus'), ...responses.unauthorized, ...responses.forbidden, ...responses.notFound },
      },
    },
    '/api/onboarding/note': {
      put: {
        tags: ['Onboarding'], summary: 'Update my onboarding request note', security,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OnboardingNoteUpdate' } } } },
        responses: { ...singleResponse('OnboardingStatus'), ...responses.validation, ...responses.unauthorized, ...responses.forbidden },
      },
    },

    // ── Admin — Onboarding (Part 2I — shorter paths, PUT method) ─────────
    '/api/admin/onboarding': {
      get: {
        tags: ['Admin — Onboarding'], summary: 'List onboarding requests (short URL)', security,
        parameters: [
          ...paginationParams,
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'], default: 'PENDING' } },
        ],
        responses: { ...paginatedResponse('OnboardingRequest'), ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/onboarding/{id}/approve': {
      put: {
        tags: ['Admin — Onboarding'], summary: 'Approve an onboarding request', security,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OnboardingApproveSimple' } } } },
        responses: { 200: { description: 'Approved and user provisioned' }, ...responses.validation, ...responses.notFound, 409: { description: 'User already exists in tenant' }, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/onboarding/{id}/reject': {
      put: {
        tags: ['Admin — Onboarding'], summary: 'Reject an onboarding request', security,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OnboardingRejectFrontend' } } } },
        responses: { 200: { description: 'Request rejected' }, ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/onboarding/{id}/reopen': {
      put: {
        tags: ['Admin — Onboarding'], summary: 'Reopen a rejected onboarding request (returns it to PENDING)', security,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Request reopened and set to PENDING' }, ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },

    // ── Admin — Onboarding requests ───────────────────────────────────────
    '/api/admin/onboarding-requests': {
      get: {
        tags: ['Admin — Onboarding'], summary: 'List onboarding requests', security,
        parameters: [
          ...paginationParams,
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'], default: 'PENDING' } },
        ],
        responses: { ...paginatedResponse('OnboardingRequest'), ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/onboarding-requests/{requestId}/approve': {
      post: {
        tags: ['Admin — Onboarding'], summary: 'Approve an onboarding request', security,
        parameters: [{ name: 'requestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OnboardingApprove' } } } },
        responses: { 200: { description: 'Approved' }, ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/onboarding-requests/{requestId}/reject': {
      post: {
        tags: ['Admin — Onboarding'], summary: 'Reject an onboarding request', security,
        parameters: [{ name: 'requestId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OnboardingReject' } } } },
        responses: { 200: { description: 'Rejected' }, ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },

    // ── Admin — Users ─────────────────────────────────────────────────────
    '/api/admin/users': {
      get: {
        tags: ['Admin — Users'], summary: 'List users in caller\'s tenant', security,
        parameters: paginationParams,
        responses: { ...paginatedResponse('AdminUser'), ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/users/all': {
      get: {
        tags: ['Admin — Users'],
        summary: 'List users across ALL tenants (super admin only)',
        description: 'Cross-tenant listing of every user_tenants membership. Requires TENANT:SUPER_ADMIN. Each row carries its tenant_id and a best-effort organization name (tenant_name).',
        security,
        parameters: paginationParams,
        responses: { ...paginatedResponse('AdminUser'), ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/users/all/status': {
      put: {
        tags: ['Admin — Users'],
        summary: 'Activate or suspend a user in any tenant (super admin only)',
        description: 'Suspending a user sets is_active = 0, which blocks their login (the login query filters is_active = TRUE). Activating restores access. Requires TENANT:SUPER_ADMIN.\n\n**Protected operation.** Rejected with 403 when: (a) the target email matches the authenticated caller and status is not ACTIVE — you cannot suspend your own account (self-ACTIVATE is still permitted); or (b) the target is a super admin. Email matching is case-insensitive.',
        security,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: {
            type: 'object',
            required: ['email', 'tenantId', 'status'],
            properties: {
              email:    { type: 'string', format: 'email', description: 'Target user email' },
              tenantId: { type: 'string', description: 'Tenant the membership belongs to' },
              status:   { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] },
            },
          }}},
        },
        responses: {
          200: { description: 'Status updated' },
          ...responses.validation,
          ...responses.forbidden,
          ...responses.notFound,
          ...responses.unauthorized,
        },
      },
    },
    '/api/admin/users/{email}': {
      get: {
        tags: ['Admin — Users'], summary: 'Get user detail (including roles)', security,
        parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string', format: 'email' } }],
        responses: { ...singleResponse('AdminUser'), ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
      delete: {
        tags: ['Admin — Users'],
        summary: 'Remove user from tenant',
        description: '**Protected operation.** Rejected with 403 when the target email matches the authenticated caller — you cannot remove your own account. Email matching is case-insensitive.',
        security,
        parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string', format: 'email' } }],
        responses: { 200: { description: 'Removed' }, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/users/{email}/roles': {
      get: {
        tags: ['Admin — Users'], summary: 'Get current roles for a user', security,
        parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string', format: 'email' } }],
        responses: {
          200: {
            description: 'User roles',
            content: { 'application/json': { schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: true },
                message: { type: 'string' },
                data: { type: 'array', items: { $ref: '#/components/schemas/UserRole' } },
              },
            }}},
          },
          ...responses.notFound, ...responses.unauthorized, ...responses.forbidden,
        },
      },
      put: {
        tags: ['Admin — Users'], summary: 'Replace user\'s roles', security,
        parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string', format: 'email' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UserRolesUpdate' } } } },
        responses: { 200: { description: 'Roles updated' }, ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/users/{email}/status': {
      put: {
        tags: ['Admin — Users'],
        summary: 'Activate or suspend a user',
        description: '**Protected operation.** Rejected with 403 when the target email matches the authenticated caller and status is not ACTIVE — you cannot suspend your own account. Self-ACTIVATE is still permitted. Email matching is case-insensitive.',
        security,
        parameters: [{ name: 'email', in: 'path', required: true, schema: { type: 'string', format: 'email' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UserStatusUpdate' } } } },
        responses: { 200: { description: 'Status updated' }, ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },

    // ── Admin — Roles ─────────────────────────────────────────────────────
    '/api/admin/roles': {
      get: {
        tags: ['Admin — Roles'], summary: 'List roles in tenant', security,
        responses: { 200: { description: 'Roles list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Role' } } } } }, ...responses.unauthorized, ...responses.forbidden },
      },
      post: {
        tags: ['Admin — Roles'], summary: 'Create a new role', security,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RoleCreate' } } } },
        responses: { ...singleResponse('Role', 201), ...responses.validation, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/roles/{roleId}': {
      put: {
        tags: ['Admin — Roles'], summary: 'Update a role', security,
        parameters: [{ name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RoleUpdate' } } } },
        responses: { ...singleResponse('Role'), ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
      delete: {
        tags: ['Admin — Roles'], summary: 'Delete a role (non-system only)', security,
        parameters: [{ name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { ...responses.noContent, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/roles/{roleId}/permissions': {
      get: {
        tags: ['Admin — Roles'], summary: 'Get permissions assigned to a role', security,
        parameters: [{ name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Permissions list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/RolePermission' } } } } }, ...responses.unauthorized, ...responses.forbidden },
      },
      put: {
        tags: ['Admin — Roles'], summary: 'Replace all permissions for a role', security,
        parameters: [{ name: 'roleId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RolePermissionsUpdate' } } } },
        responses: { 200: { description: 'Permissions updated' }, ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
    },

    // ── Admin — Features ──────────────────────────────────────────────────
    '/api/admin/features': {
      get: {
        tags: ['Admin — Features'], summary: 'List all features/scopes', security,
        responses: { 200: { description: 'Features list', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Feature' } } } } }, ...responses.unauthorized, ...responses.forbidden },
      },
      post: {
        tags: ['Admin — Features'], summary: 'Create a new feature/scope', security,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/FeatureCreate' } } } },
        responses: { ...singleResponse('Feature', 201), ...responses.validation, ...responses.unauthorized, ...responses.forbidden },
      },
    },
    '/api/admin/features/{featureId}': {
      put: {
        tags: ['Admin — Features'], summary: 'Update a feature/scope', security,
        parameters: [{ name: 'featureId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/FeatureUpdate' } } } },
        responses: { ...singleResponse('Feature'), ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
      },
      delete: {
        tags: ['Admin — Features'], summary: 'Delete a feature/scope (if not in use)', security,
        parameters: [{ name: 'featureId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { ...responses.noContent, ...responses.notFound, 409: { description: 'Feature is in use by one or more roles' }, ...responses.unauthorized, ...responses.forbidden },
      },
    },
  },
};

module.exports = swaggerSpec;
