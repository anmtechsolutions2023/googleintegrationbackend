// src/config/swagger.menu.js
// OpenAPI documentation for the Menu workspace (/api/menu), merged into
// swagger.js: the dish editor, the menu file, the prices grid and photos.

const security = [{ bearerAuth: [] }];
const errorContent = { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } };
const err = (code, description) => ({ [code]: { description, content: errorContent } });
const ok = (schema, description = 'Success') => ({
  200: { description, content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: schema } } } } },
});
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const itemId = { name: 'itemId', in: 'path', required: true, schema: { type: 'string' }, description: 'The dish (itemdetail.Id).' };
const READ = 'Requires POS_CONFIG:READ (or POS_CONFIG:WRITE, or tenant admin).';
const WRITE = 'Requires POS_CONFIG:WRITE (or tenant admin).';

const schemas = {
  MenuDish: {
    type: 'object',
    description: 'A dish: the catalogue item, its price, and its menu entry at every branch, as one object. '
      + 'Masters are named (category, unit, diet, meat type, tax group, variants, add-on groups, tags) and are CREATED when they do not exist. '
      + 'Branches, channels and portals are ids and are never created. Diet, options, tags, serving and nutrition apply to every branch alike.',
    required: ['name', 'category', 'diet', 'unit', 'price', 'branches'],
    properties: {
      itemId: { type: 'string', readOnly: true },
      code: { type: 'string', example: 'MNS-02' },
      name: { type: 'string', example: 'Veg Biryani' },
      category: { type: 'string', example: 'Biryani & Rice', description: '"Parent › Child" sets a parent category.' },
      description: { type: 'string', nullable: true },
      diet: { type: 'string', example: 'Veg', description: 'A food type; created if new.' },
      meatType: { type: 'string', nullable: true, example: 'Chicken' },
      unit: { type: 'string', example: 'Plate' },
      sku: { type: 'string', nullable: true },
      barcode: { type: 'string', nullable: true },
      hsn: { type: 'string', nullable: true, example: '22011010' },
      sac: { type: 'string', nullable: true, example: '996331' },
      price: { type: 'number', example: 220 },
      taxGroup: { type: 'string', nullable: true, example: 'GST 5%', description: 'Blank = Exempt (0%). A NEW group needs taxComponents.' },
      taxComponents: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', example: 'CGST' }, value: { type: 'string', example: '2.5' } } } },
      taxIncluded: { type: 'boolean', example: false },
      branches: {
        type: 'array',
        description: 'Where it is sold. A branch left out is switched off (its entry kept for history).',
        items: { type: 'object', properties: {
          branchId: { type: 'string' },
          channelIds: { type: 'array', items: { type: 'string' } },
          price: { type: 'number', nullable: true, description: 'This branch\'s own price; null = the base price.' },
        } },
      },
      variants: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', example: 'Large' }, surcharge: { type: 'number', example: 60, description: 'Added to the base price FOR THIS DISH.' } } } },
      addonGroups: { type: 'array', items: { type: 'string' }, example: ['Toppings'] },
      tags: { type: 'array', items: { type: 'string' }, example: ['Main Course', 'Chef special'] },
      serves: { type: 'integer', nullable: true },
      portion: { type: 'string', nullable: true, example: '500 g' },
      prepMin: { type: 'integer', nullable: true },
      maxPerOrder: { type: 'integer', nullable: true },
      stockTracked: { type: 'boolean' },
      nutrition: { type: 'object', nullable: true, properties: {
        ServingSizeG: { type: 'number' }, Calories: { type: 'number' }, ProteinG: { type: 'number' }, CarbohydrateG: { type: 'number' },
        SugarG: { type: 'number' }, FatG: { type: 'number' }, SaturatedFatG: { type: 'number' }, FibreG: { type: 'number' },
        SodiumMg: { type: 'number' }, Allergens: { type: 'string' },
      } },
      portals: { type: 'array', items: { type: 'object', properties: {
        portalId: { type: 'string' }, listed: { type: 'boolean' },
        price: { type: 'number', nullable: true, description: 'null = the branch price.' }, name: { type: 'string', nullable: true },
      } } },
      status: { type: 'string', enum: ['Active', 'Hidden'] },
      hasPhoto: { type: 'boolean', readOnly: true },
    },
  },
  MenuImportResult: {
    type: 'object',
    properties: {
      dryRun: { type: 'boolean' },
      summary: { type: 'object', properties: { total: { type: 'integer' }, new: { type: 'integer' }, changed: { type: 'integer' }, unchanged: { type: 'integer' }, errors: { type: 'integer' } } },
      created: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } }, example: { categories: ['Desserts'], tags: ['Festive'], variants: ['4 pcs'] } },
      rows: { type: 'array', items: { type: 'object', properties: {
        line: { type: 'integer' }, name: { type: 'string' }, code: { type: 'string', nullable: true },
        action: { type: 'string', enum: ['new', 'changed', 'unchanged', 'error'] },
        changes: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } } },
        error: { type: 'string' },
      } } },
      addons: { type: 'object' },
      hours: { type: 'object', nullable: true },
    },
  },
};

const FILE_RULES = 'Rows are the parsed CSV (header → cell). menu.csv: one row per dish, matched by `code` then `name`. '
  + 'A blank cell keeps the current value; a single `-` clears it. Category, unit, diet, meat type, tag, variant, add-on group and tax group are created when named; '
  + 'branch, channel and portal names must exist. Columns: see GET /api/exports/menu (the export writes exactly what the import reads), '
  + 'plus `price@<branch>` and `<portal>_listed / _price / _name`. Variants: `Regular=0; Large=+60`. Optional addons.csv (group,min,max,addon,code,price,diet,sort) '
  + 'and hours.csv (category,days,from,to). Each row applies on its own; a bad row is reported and skipped.';

const filesBody = {
  required: true,
  content: { 'application/json': { schema: { type: 'object', properties: {
    menu: { type: 'array', items: { type: 'object', additionalProperties: { type: 'string' } } },
    addons: { type: 'array', items: { type: 'object', additionalProperties: { type: 'string' } } },
    hours: { type: 'array', items: { type: 'object', additionalProperties: { type: 'string' } } },
  } } } },
};

const paths = {
  '/api/menu/options': { get: { tags: ['Menu'], summary: 'Everything the dish editor offers', description: `Branches, channels, portals, categories, units, tax groups (with rates), diets, meat types, tags, variants (with default price), add-on groups (with add-ons). ${READ}`, security, responses: { ...ok({ type: 'object' }), ...err(403, 'Forbidden') } } },
  '/api/menu/dishes': {
    get: { tags: ['Menu'], summary: 'One line per dish', description: READ, security, responses: { ...ok({ type: 'object' }) } },
    post: { tags: ['Menu'], summary: 'Add a dish, creating any master it names', description: `One transaction. The response lists what was created alongside (alsoCreated). ${WRITE}`, security,
      requestBody: { required: true, content: { 'application/json': { schema: ref('MenuDish') } } },
      responses: { 201: { description: 'Saved' }, ...err(400, 'Validation error, or a new tax group without its rates'), ...err(409, 'Another dish has that name or code') } },
  },
  '/api/menu/dishes/bulk': { post: { tags: ['Menu'], summary: 'Hide, show, tag or (un)list many dishes', description: WRITE, security,
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: {
      itemIds: { type: 'array', items: { type: 'string' } }, action: { type: 'string', enum: ['hide', 'show', 'addTag', 'removeTag', 'list', 'unlist'] },
      value: { type: 'string', description: 'The tag, for addTag/removeTag.' }, portalId: { type: 'string', description: 'For list/unlist.' },
    } } } } }, responses: { ...ok({ type: 'object' }) } } },
  '/api/menu/dishes/{itemId}': {
    get: { tags: ['Menu'], summary: 'One dish, whole', description: READ, security, parameters: [itemId], responses: { ...ok(ref('MenuDish')), ...err(404, 'Not found') } },
    put: { tags: ['Menu'], summary: 'Save a dish', description: `A changed price is a NEW cost record; the old one stays for the bills that used it. ${WRITE}`, security, parameters: [itemId],
      requestBody: { required: true, content: { 'application/json': { schema: ref('MenuDish') } } }, responses: { ...ok({ type: 'object' }), ...err(404, 'Not found'), ...err(409, 'Name or code taken') } },
  },
  '/api/menu/dishes/{itemId}/photo': {
    get: { tags: ['Menu'], summary: 'The dish photo, as a data URI', description: READ, security, parameters: [itemId], responses: { ...ok({ type: 'object', properties: { dataUri: { type: 'string' }, mimeType: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' } } }), ...err(404, 'No photo') } },
    put: { tags: ['Menu'], summary: 'Set the dish photo', description: `PNG or JPEG data URI, up to 512KB; the bytes decide the type. ${WRITE}`, security, parameters: [itemId],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { dataUri: { type: 'string' } } } } } }, responses: { 201: { description: 'Saved' }, ...err(400, 'Not an image, or too large') } },
    delete: { tags: ['Menu'], summary: 'Remove the dish photo', description: WRITE, security, parameters: [itemId], responses: { 204: { description: 'Removed' } } },
  },
  '/api/menu/import/preview': { post: { tags: ['Menu'], summary: 'What a menu file would do — writes nothing', description: `${FILE_RULES}\n\nRuns exactly the apply code inside a transaction and rolls it back, so the review is what applying will do. ${WRITE}`, security, requestBody: filesBody, responses: { ...ok(ref('MenuImportResult')) } } },
  '/api/menu/import/apply': { post: { tags: ['Menu'], summary: 'Apply a menu file', description: `${FILE_RULES}\n\nAudit-logged with the counts. ${WRITE}`, security, requestBody: filesBody, responses: { ...ok(ref('MenuImportResult')) } } },
  '/api/menu/prices': {
    get: { tags: ['Menu'], summary: 'Base, branch and portal prices for every dish', description: READ, security, responses: { ...ok({ type: 'object' }) } },
    put: { tags: ['Menu'], summary: 'Save a batch of price and listing changes', description: `All or nothing. A change names the dish and at most one of branchId / portalId; neither = the base price. ${WRITE}`, security,
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { changes: { type: 'array', items: { type: 'object', properties: {
        itemId: { type: 'string' }, branchId: { type: 'string' }, portalId: { type: 'string' }, price: { type: 'number', nullable: true }, listed: { type: 'boolean' },
      } } } } } } } }, responses: { ...ok({ type: 'object' }), ...err(400, 'A branch the dish is not sold at') } },
  },
};

const tags = [{ name: 'Menu', description: 'Dishes as one object: the one-page editor, the menu file (CSV round-trip that creates missing masters), the prices grid and dish photos.' }];

module.exports = { schemas, paths, tags };
