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
      PosBillSettle: {
        type: 'object', required: ['Payments'],
        properties: {
          Payments: { type: 'array', items: { type: 'object' } },
          Discount: { type: 'number' },
          Total: { type: 'number' },
        },
      },
      PosBill: {
        type: 'object',
        properties: { ...auditFields,
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
          Comments: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosTokenCreate: {
        type: 'object', required: ["TokenNumber"],
        properties: {
          TokenNumber: {"type":"integer"},
          OrderId: {"type":"string","format":"uuid"},
          Status: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosTokenUpdate: {
        type: 'object',
        properties: {
          TokenNumber: {"type":"integer"},
          OrderId: {"type":"string","format":"uuid"},
          Status: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosToken: {
        type: 'object',
        properties: { ...auditFields,
          TokenNumber: {"type":"integer"},
          OrderId: {"type":"string","format":"uuid"},
          Status: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
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
      PosStaffCreate: {
        type: 'object', required: ["Name"],
        properties: {
          Name: {"type":"string"},
          Role: {"type":"string"},
          Phone: {"type":"string"},
          Email: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosStaffUpdate: {
        type: 'object',
        properties: {
          Name: {"type":"string"},
          Role: {"type":"string"},
          Phone: {"type":"string"},
          Email: {"type":"string"},
          BranchDetailId: {"type":"string","format":"uuid"},
          Active: {"type":"boolean"},
        },
      },
      PosStaff: {
        type: 'object',
        properties: { ...auditFields,
          Name: {"type":"string"},
          Role: {"type":"string"},
          Phone: {"type":"string"},
          Email: {"type":"string"},
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
    ...crudPaths('PosStaff', '/api/pos/staff', 'PosStaffCreate', 'PosStaffUpdate', 'PosStaff', false),

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
        tags: ['PosBills'], summary: 'Settle a bill (record payments, mark paid)', security,
        parameters: [idParam],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PosBillSettle' } } } },
        responses: { ...singleResponse('PosBill'), ...responses.validation, ...responses.notFound, ...responses.unauthorized, ...responses.forbidden },
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
