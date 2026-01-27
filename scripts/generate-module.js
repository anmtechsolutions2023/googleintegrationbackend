#!/usr/bin/env node

// scripts/generate-module.js
// Template generator for CRUD modules
// Usage: node scripts/generate-module.js <moduleName>

const fs = require('fs');
const path = require('path');

if (process.argv.length < 3) {
  console.error('Usage: node scripts/generate-module.js <moduleName>');
  console.error('Example: node scripts/generate-module.js category');
  process.exit(1);
}

const moduleName = process.argv[2].toLowerCase();
const className = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
const moduleDir = path.join(__dirname, '..', 'src', 'modules', moduleName);

// Create module directory
if (!fs.existsSync(moduleDir)) {
  fs.mkdirSync(moduleDir, { recursive: true });
}

// Service template
const serviceTemplate = `// src/modules/${moduleName}/${moduleName}.service.js
// ${className} Service extending BaseCRUDService
// Handles business logic for ${moduleName} operations with standardized patterns

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

/**
 * ${className} Service extending base CRUD functionality
 */
class ${className}Service extends BaseCRUDService {
  constructor() {
    super('${className}', QUERIES.${moduleName.toUpperCase()}S);
  }

  /**
   * Prepare parameters for ${moduleName} insertion
   * @param {string} id - Generated ID
   * @param {Object} data - ${className} data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Array} Parameters for INSERT query
   */
  prepareInsertParams(id, data, tenantId, userEmail) {
    // TODO: Customize based on your table structure
    return [
      id,
      tenantId,
      data.Name, // Adjust field names as needed
      userEmail,
      userEmail,
    ];
  }

  /**
   * Prepare parameters for ${moduleName} update
   * @param {Object} data - New data
   * @param {Object} existing - Existing record
   * @param {string} userEmail - User email
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @returns {Array} Parameters for UPDATE query
   */
  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    // TODO: Customize based on your table structure
    const updatedName = data.Name !== undefined ? data.Name : existing.Name;
    
    return [
      updatedName,
      userEmail,
      id,
      tenantId,
    ];
  }

  /**
   * Get all ${moduleName}s for a tenant with pagination.
   * @param {string} tenantId - Tenant ID
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>} Paginated results
   */
  async getAll${className}s(tenantId, page = 1, limit = 10) {
    logger.info('${className}Service.getAll${className}s called', { tenantId, page, limit });
    return await this.getAll(tenantId, page, limit);
  }

  /**
   * Get ${moduleName} by ID.
   * @param {string} id - ${className} ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} ${className} object
   */
  async get${className}ById(id, tenantId) {
    logger.info('${className}Service.get${className}ById called', { id, tenantId });
    return await this.getById(id, tenantId);
  }

  /**
   * Create new ${moduleName}.
   * @param {Object} ${moduleName}Data - ${className} data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Created ${moduleName}
   */
  async create${className}(${moduleName}Data, tenantId, userEmail) {
    logger.info('${className}Service.create${className} called', { tenantId, userEmail });
    return await this.create(${moduleName}Data, tenantId, userEmail);
  }

  /**
   * Update existing ${moduleName}.
   * @param {string} id - ${className} ID
   * @param {Object} updateData - Updated data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Updated ${moduleName}
   */
  async update${className}(id, updateData, tenantId, userEmail) {
    logger.info('${className}Service.update${className} called', { id, tenantId, userEmail });
    return await this.update(id, updateData, tenantId, userEmail);
  }

  /**
   * Delete ${moduleName}.
   * @param {string} id - ${className} ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<void>}
   */
  async delete${className}(id, tenantId) {
    logger.info('${className}Service.delete${className} called', { id, tenantId });
    return await this.delete(id, tenantId);
  }
}

// Create singleton instance
const ${moduleName}Service = new ${className}Service();

module.exports = {
  getAll${className}s: (tenantId, page, limit) => ${moduleName}Service.getAll${className}s(tenantId, page, limit),
  get${className}ById: (id, tenantId) => ${moduleName}Service.get${className}ById(id, tenantId),
  create${className}: (data, tenantId, userEmail) => ${moduleName}Service.create${className}(data, tenantId, userEmail),
  update${className}: (id, data, tenantId, userEmail) => ${moduleName}Service.update${className}(id, data, tenantId, userEmail),
  delete${className}: (id, tenantId) => ${moduleName}Service.delete${className}(id, tenantId),
};
`;

// Schema template
const schemaTemplate = `// src/modules/${moduleName}/${moduleName}.schemas.js
// Joi validation schemas for ${moduleName} operations
// Centralized validation rules for better maintainability

const Joi = require('joi');

// Schema for creating a new ${moduleName}
const create${className}Schema = Joi.object({
  Name: Joi.string().required().max(100).trim(),
  // TODO: Add your specific fields here
  Active: Joi.boolean().optional().default(true),
});

// Schema for updating an existing ${moduleName}
const update${className}Schema = Joi.object({
  Name: Joi.string().optional().max(100).trim(),
  // TODO: Add your specific fields here
  Active: Joi.boolean().optional(),
}).min(1); // At least one field must be provided

// Schema for pagination query parameters
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

// Schema for UUID parameter validation
const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  create${className}Schema,
  update${className}Schema,
  paginationSchema,
  uuidParamSchema,
};
`;

// Controller template
const controllerTemplate = `// src/modules/${moduleName}/${moduleName}.controller.js
// Controller layer for ${moduleName} operations
// Handles HTTP requests and responses with standardized patterns

const ${moduleName}Service = require('./${moduleName}.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse, paginatedResponse, createdResponse, noContentResponse } = require('../../utils/responseHelper');
const { validateBody, validateQuery, validateParams } = require('../../middleware/validation');
const { create${className}Schema, update${className}Schema, paginationSchema, uuidParamSchema } = require('./${moduleName}.schemas');
const { logger } = require('../../utils/logger');

/**
 * Get all ${moduleName}s with pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAll${className}s = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { page, limit } = req.query;

  logger.info('getAll${className}s called', { tenantId, page, limit });

  const result = await ${moduleName}Service.getAll${className}s(tenantId, page, limit);
  
  paginatedResponse(res, result.data, result.pagination, '${className}s retrieved successfully');
});

/**
 * Get a specific ${moduleName} by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const get${className}ById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tenantId } = req.user;

  logger.info('get${className}ById called', { id, tenantId });

  const ${moduleName} = await ${moduleName}Service.get${className}ById(id, tenantId);
  
  successResponse(res, ${moduleName}, '${className} retrieved successfully');
});

/**
 * Create a new ${moduleName}
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const create${className} = asyncHandler(async (req, res) => {
  const { tenantId, email } = req.user;
  const ${moduleName}Data = req.body;

  logger.info('create${className} called', { tenantId, email });

  const new${className} = await ${moduleName}Service.create${className}(${moduleName}Data, tenantId, email);
  
  createdResponse(res, new${className}, '${className} created successfully');
});

/**
 * Update an existing ${moduleName}
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const update${className} = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tenantId, email } = req.user;
  const updateData = req.body;

  logger.info('update${className} called', { id, tenantId, email });

  const updated${className} = await ${moduleName}Service.update${className}(id, updateData, tenantId, email);
  
  successResponse(res, updated${className}, '${className} updated successfully');
});

/**
 * Delete a ${moduleName}
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const delete${className} = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tenantId } = req.user;

  logger.info('delete${className} called', { id, tenantId });

  await ${moduleName}Service.delete${className}(id, tenantId);
  
  noContentResponse(res, '${className} deleted successfully');
});

module.exports = {
  getAll${className}s: [
    validateQuery(paginationSchema),
    getAll${className}s
  ],
  get${className}ById: [
    validateParams(uuidParamSchema),
    get${className}ById
  ],
  create${className}: [
    validateBody(create${className}Schema),
    create${className}
  ],
  update${className}: [
    validateParams(uuidParamSchema),
    validateBody(update${className}Schema),
    update${className}
  ],
  delete${className}: [
    validateParams(uuidParamSchema),
    delete${className}
  ],
};
`;

// Routes template
const routesTemplate = `// src/modules/${moduleName}/${moduleName}.routes.js
// Routes for ${moduleName} operations
// Uses standardized middleware chains from controller

const express = require('express');
const router = express.Router();
const ${moduleName}Controller = require('./${moduleName}.controller');
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');

/**
 * GET /api/${moduleName}s
 * Get all ${moduleName}s for the authenticated user's tenant.
 */
router.get(
  '/',
  authenticateToken,
  auditLog(),
  ...${moduleName}Controller.getAll${className}s
);

/**
 * GET /api/${moduleName}s/:id
 * Get a specific ${moduleName} by ID.
 */
router.get(
  '/:id',
  authenticateToken,
  auditLog(),
  ...${moduleName}Controller.get${className}ById
);

/**
 * POST /api/${moduleName}s
 * Create a new ${moduleName} (Admin access required).
 */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...${moduleName}Controller.create${className}
);

/**
 * PUT /api/${moduleName}s/:id
 * Update an existing ${moduleName} (Admin access required).
 */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...${moduleName}Controller.update${className}
);

/**
 * DELETE /api/${moduleName}s/:id
 * Delete a ${moduleName} (Admin access required).
 */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...${moduleName}Controller.delete${className}
);

module.exports = router;
`;

// README template
const readmeTemplate = `# ${className} Module

This module follows the standardized CRUD architecture pattern established in the project.

## Quick Start

1. **Update Database Queries**: Add ${moduleName.toUpperCase()}S queries to \`src/config/constants.js\`
2. **Customize Service**: Modify \`prepareInsertParams\` and \`prepareUpdateParams\` in the service
3. **Update Schemas**: Adjust validation schemas in \`${moduleName}.schemas.js\`
4. **Register Routes**: Add to \`src/config/routes.js\`
5. **Create Database Table**: See SQL schema below

## Database Schema Template

\`\`\`sql
CREATE TABLE ${className}s (
  Id VARCHAR(36) PRIMARY KEY,
  TenantId VARCHAR(36) NOT NULL,
  Name VARCHAR(100) NOT NULL,
  -- Add your specific columns here
  Active BOOLEAN DEFAULT TRUE,
  CreatedBy VARCHAR(255) NOT NULL,
  UpdatedBy VARCHAR(255) NOT NULL,
  CreatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UpdatedOn TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_name_per_tenant (TenantId, Name),
  INDEX idx_tenant_active (TenantId, Active)
);
\`\`\`

## Required Constants

Add to \`src/config/constants.js\`:

\`\`\`javascript
${moduleName.toUpperCase()}S: {
  SELECT_ALL: 'SELECT * FROM ${className}s WHERE TenantId = ? ORDER BY CreatedOn DESC',
  COUNT: 'SELECT COUNT(*) as total FROM ${className}s WHERE TenantId = ?',
  SELECT_BY_ID: 'SELECT * FROM ${className}s WHERE Id = ? AND TenantId = ?',
  INSERT: 'INSERT INTO ${className}s (Id, TenantId, Name, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?)',
  UPDATE: 'UPDATE ${className}s SET Name = ?, UpdatedBy = ?, UpdatedOn = CURRENT_TIMESTAMP WHERE Id = ? AND TenantId = ?',
  DELETE: 'DELETE FROM ${className}s WHERE Id = ? AND TenantId = ?',
}
\`\`\`

## API Endpoints

- \`GET /api/${moduleName}s\` - List all ${moduleName}s (paginated)
- \`GET /api/${moduleName}s/:id\` - Get ${moduleName} by ID  
- \`POST /api/${moduleName}s\` - Create new ${moduleName} (Admin)
- \`PUT /api/${moduleName}s/:id\` - Update ${moduleName} (Admin)
- \`DELETE /api/${moduleName}s/:id\` - Delete ${moduleName} (Admin)

## Next Steps

1. Customize the field names and validation rules
2. Update the database queries
3. Test the endpoints
4. Add any custom business logic to the service layer

This module template provides a complete CRUD implementation following project standards.
`;

// Write files
fs.writeFileSync(
  path.join(moduleDir, `${moduleName}.service.js`),
  serviceTemplate
);
fs.writeFileSync(
  path.join(moduleDir, `${moduleName}.schemas.js`),
  schemaTemplate
);
fs.writeFileSync(
  path.join(moduleDir, `${moduleName}.controller.js`),
  controllerTemplate
);
fs.writeFileSync(
  path.join(moduleDir, `${moduleName}.routes.js`),
  routesTemplate
);
fs.writeFileSync(path.join(moduleDir, 'README.md'), readmeTemplate);

console.log(`✅ ${className} module generated successfully!`);
console.log(`📁 Location: ${moduleDir}`);
console.log(`\n📝 Next steps:`);
console.log(
  `1. Add ${moduleName.toUpperCase()}S queries to src/config/constants.js`
);
console.log(`2. Register routes in src/config/routes.js`);
console.log(`3. Create database table`);
console.log(`4. Customize validation schemas and service methods`);
console.log(`5. Test the endpoints`);

// Generate constants template
const constantsTemplate = `
// Add this to src/config/constants.js in the QUERIES object:

${moduleName.toUpperCase()}S: {
  SELECT_ALL: 'SELECT * FROM ${className}s WHERE TenantId = ? ORDER BY CreatedOn DESC',
  COUNT: 'SELECT COUNT(*) as total FROM ${className}s WHERE TenantId = ?',
  SELECT_BY_ID: 'SELECT * FROM ${className}s WHERE Id = ? AND TenantId = ?',
  INSERT: 'INSERT INTO ${className}s (Id, TenantId, Name, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?)',
  UPDATE: 'UPDATE ${className}s SET Name = ?, UpdatedBy = ?, UpdatedOn = CURRENT_TIMESTAMP WHERE Id = ? AND TenantId = ?',
  DELETE: 'DELETE FROM ${className}s WHERE Id = ? AND TenantId = ?',
},
`;

fs.writeFileSync(
  path.join(moduleDir, 'constants-template.txt'),
  constantsTemplate
);

// Generate routes registration template
const routesRegTemplate = `
// Add this to src/config/routes.js:

const ${moduleName}Routes = require('../modules/${moduleName}/${moduleName}.routes');
router.use('/api/${moduleName}s', ${moduleName}Routes);
`;

fs.writeFileSync(
  path.join(moduleDir, 'routes-registration.txt'),
  routesRegTemplate
);

console.log(`\n📄 Template files created:`);
console.log(`   - constants-template.txt`);
console.log(`   - routes-registration.txt`);
