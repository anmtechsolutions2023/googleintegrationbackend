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
  forbidden:    { 403: { description: 'Forbidden — insufficient scope' } },
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

      // ─── AddressDetail ─────────────────────────────────────────────────────
      AddressDetailCreate: {
        type: 'object', required: ['MapProviderLocationMapperId', 'ContactAddressTypeId'],
        properties: {
          AddressLine1:               { type: 'string', maxLength: 50, nullable: true, example: '123 Main St' },
          AddressLine2:               { type: 'string', maxLength: 50, nullable: true },
          City:                       { type: 'string', maxLength: 50, nullable: true, example: 'Bengaluru' },
          State:                      { type: 'string', maxLength: 50, nullable: true, example: 'Karnataka' },
          Pincode:                    { type: 'string', maxLength: 50, nullable: true, example: '560001' },
          MapProviderLocationMapperId: { type: 'string', format: 'uuid' },
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
          MapProviderLocationMapperId: { type: 'string', format: 'uuid' }, Landmark: { type: 'string', nullable: true },
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
        properties: { ...auditFields, Amount: { type: 'string' }, TaxGroupId: { type: 'string' }, IsTaxIncluded: { type: 'integer' } },
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
        properties: { ...auditFields, BatchNo: { type: 'string' }, Barcode: { type: 'string', nullable: true }, Quantity: { type: 'string', nullable: true }, IsNonReturnable: { type: 'integer' } },
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
        properties: { ...auditFields, Name: { type: 'string' }, Code: { type: 'string', nullable: true }, SKU: { type: 'string', nullable: true }, Barcode: { type: 'string', nullable: true } },
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
        properties: {
          TransactionDetailLogId: { type: 'string', format: 'uuid' },
          ItemId:                 { type: 'string', format: 'uuid' },
          Comment:                { type: 'string', maxLength: 100, nullable: true },
          Active:                 { type: 'boolean', default: true },
        },
      },
      TransactionItemDetailUpdate: {
        type: 'object', minProperties: 1,
        properties: {
          TransactionDetailLogId: { type: 'string', format: 'uuid' },
          ItemId:                 { type: 'string', format: 'uuid' },
          Comment:                { type: 'string', maxLength: 100, nullable: true },
          Active:                 { type: 'boolean' },
        },
      },
      TransactionItemDetail: {
        type: 'object',
        properties: { ...auditFields, TransactionDetailLogId: { type: 'string' }, ItemId: { type: 'string' }, Comment: { type: 'string', nullable: true } },
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
        properties: { ...auditFields, AccountTypeBaseId: { type: 'string' }, TransactionDetailLogId: { type: 'string' }, TotalAmount: { type: 'string' }, GrossAmount: { type: 'string' }, DiscountAmount: { type: 'string', nullable: true } },
      },

      // ─── PaymentBreakup ────────────────────────────────────────────────────
      PaymentBreakupCreate: {
        type: 'object', required: ['AccountTypeBaseId', 'PaymentDetailId', 'PaymentModeTransactionDetailId', 'PaymentReceivedTypeId', 'Timestamp'],
        properties: {
          AccountTypeBaseId:             { type: 'string', format: 'uuid' },
          PaymentDetailId:               { type: 'string', format: 'uuid' },
          PaymentModeTransactionDetailId: { type: 'string', format: 'uuid' },
          PaymentReceivedTypeId:         { type: 'string', format: 'uuid' },
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
          UserId:                        { type: 'string', format: 'uuid', nullable: true },
          Timestamp:                     { type: 'string', description: 'ISO datetime or DD-MM-YYYY' },
          Active:                        { type: 'boolean' },
        },
      },
      PaymentBreakup: {
        type: 'object',
        properties: { ...auditFields, AccountTypeBaseId: { type: 'string' }, PaymentDetailId: { type: 'string' }, PaymentModeTransactionDetailId: { type: 'string' }, PaymentReceivedTypeId: { type: 'string' }, UserId: { type: 'string', nullable: true }, Timestamp: { type: 'string' } },
      },
    },
  },

  paths: {
    ...crudPaths('TaxTypes',                       '/api/taxtypes',                        'TaxTypeCreate',                       'TaxTypeUpdate',                       'TaxType',                       false),
    ...crudPaths('UOM',                            '/api/uom',                             'UOMCreate',                           'UOMUpdate',                           'UOM',                           false),
    ...crudPaths('Categories',                     '/api/categories',                      'CategoryCreate',                      'CategoryUpdate',                      'Category',                      false),
    ...crudPaths('TransactionTypeConfig',          '/api/transactiontypeconfigs',          'TransactionTypeConfigCreate',         'TransactionTypeConfigUpdate',         'TransactionTypeConfig',         true),
    ...crudPaths('Organizations',                  '/api/organizations',                   'OrganizationCreate',                  'OrganizationUpdate',                  'Organization',                  false),
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
  },
};

module.exports = swaggerSpec;
