// src/config/swagger.qrOrdering.js
// OpenAPI documentation for QR table ordering, merged into swagger.js.
//
// Three surfaces:
//   Auth — OTP      /api/auth/otp/*   staff sign-in codes (the same machinery a
//                                     diner's code uses, with its own limits)
//   QR Ordering     /api/pos/qr/*     staff: table codes, branch switch, limits,
//                                     and the review queue of guests' orders
//   Dine (public)   /api/dine/*       the guest's phone at a table
// See QR_TABLE_ORDERING_DESIGN.md.

const staffSecurity = [{ bearerAuth: [] }];
const dinerSecurity = [{ dinerAuth: [] }];

const errorContent = { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } };
const err = (code, description) => ({ [code]: { description, content: errorContent } });

const ok = (schema, status = 200, description = 'Success') => ({
  [status]: {
    description,
    content: { 'application/json': { schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string' },
        data: schema,
      },
    } } },
  },
});
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const listOf = (name) => ({ type: 'array', items: ref(name) });
const body = (name) => ({ required: true, content: { 'application/json': { schema: ref(name) } } });

const branchQuery = { name: 'branchId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' }, description: 'The branch (branchdetail.Id).' };
const tokenParam = { name: 'token', in: 'path', required: true, schema: { type: 'string', pattern: '^[0-9a-f]{32}$' }, description: 'The token printed inside the table\'s QR code.' };

const staffErrors = {
  ...err(401, 'Unauthorized — missing or invalid staff bearer token'),
  403: { description: 'Forbidden — the user holds none of the scopes this route admits' },
};
const dinerErrors = {
  ...err(401, 'Diner session ended — expired, the table\'s code was rotated, the table retired, or QR ordering switched off. Body carries `code: "DINER_SESSION_ENDED"`: send the guest back to scan again.'),
};

const DECIDE_SCOPES = 'Admits TENANT:ADMIN, TENANT:SUPER_ADMIN, POS_QR:WRITE, or POS_ORDER:WRITE — reviewing a guest\'s order IS taking an order, so floor staff decide them without a second grant.';
const QUEUE_SCOPES = 'Admits TENANT:ADMIN, TENANT:SUPER_ADMIN, POS_QR:READ/WRITE, or POS_ORDER:READ/WRITE.';
const CODES_SCOPES = 'Admits TENANT:ADMIN, TENANT:SUPER_ADMIN, POS_QR:READ or POS_QR:WRITE.';
const MANAGE_SCOPES = 'Admits TENANT:ADMIN, TENANT:SUPER_ADMIN or POS_QR:WRITE.';

const securitySchemes = {
  dinerAuth: {
    type: 'http', scheme: 'bearer', bearerFormat: 'JWT (diner session)',
    description: 'The token returned by POST /api/dine/{token}/otp/verify. Signed with a DIFFERENT key from staff tokens (DINER_JWT_SECRET, or one derived from JWT_SECRET), so it is refused by every staff route and a staff token is refused here. Bound to one table, one customer, 3 hours by default (DINER_SESSION_TTL_SECONDS).',
  },
};

const schemas = {
  // ── OTP ────────────────────────────────────────────────────────────────
  OtpRequest: {
    type: 'object', required: ['phone'],
    properties: {
      phone: { type: 'string', example: '+919876543210', description: 'Any common format; normalised to E.164.' },
      purpose: { type: 'string', enum: ['LOGIN', 'SIGNUP'], default: 'LOGIN', description: 'DINER codes are requested through /api/dine, never here.' },
    },
  },
  OtpChallenge: {
    type: 'object',
    properties: {
      challengeId: { type: 'string', format: 'uuid' },
      expiresInSeconds: { type: 'integer', example: 300 },
      resendInSeconds: { type: 'integer', example: 60 },
    },
  },
  OtpVerify: {
    type: 'object', required: ['challengeId', 'code'],
    properties: {
      challengeId: { type: 'string', format: 'uuid' },
      code: { type: 'string', pattern: '^\\d{4,8}$', example: '482913' },
      name: { type: 'string', maxLength: 255, description: 'Read only when the number turns out to be new.' },
    },
  },

  // ── QR Ordering (staff) ────────────────────────────────────────────────
  QrCode: {
    type: 'object',
    properties: {
      tableId: { type: 'string', format: 'uuid' },
      tableName: { type: 'string', example: 'T4' },
      capacity: { type: 'integer', nullable: true, example: 4 },
      floorId: { type: 'string', format: 'uuid', nullable: true },
      floorName: { type: 'string', nullable: true, example: 'Ground floor' },
      qrId: { type: 'string', format: 'uuid' },
      token: { type: 'string', example: '9f2c4e1ab07d4c55e3a1f0b6d8c2e7a4', description: 'Encode `<public origin>/t/<token>` in the QR image.' },
      issuedOn: { type: 'string', format: 'date-time', nullable: true },
      rotatedOn: { type: 'string', format: 'date-time', nullable: true },
    },
  },
  QrCodeList: {
    type: 'object',
    properties: {
      branchId: { type: 'string', format: 'uuid' },
      issued: { type: 'integer', description: 'How many tables got their first code in this call.' },
      codes: listOf('QrCode'),
    },
  },
  QrSettings: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', description: 'Off (the default) = every code at this branch answers "not active".' },
      mode: { type: 'string', enum: ['menu', 'order'], description: '`menu` = guests verify and browse; staff take the order. `order` = guests place orders for staff to accept.' },
      canOrder: { type: 'boolean', readOnly: true, description: 'enabled AND mode = order.' },
      showPhotos: { type: 'boolean', description: 'Dish photos on the guest menu. On (the default) unless turned off. Stored as qr.ordering.showPhotos.' },
    },
  },
  QrSettingsUpdate: {
    type: 'object', minProperties: 1,
    properties: {
      enabled: { type: 'boolean' },
      mode: { type: 'string', enum: ['menu', 'order'] },
      showPhotos: { type: 'boolean' },
    },
  },
  QrLimit: {
    type: 'object',
    properties: {
      key: { type: 'string', example: 'perTable' },
      label: { type: 'string', example: 'Codes per table' },
      value: { type: 'integer', example: 20 },
      per: { type: 'string', nullable: true, example: '15 min' },
      scope: { type: 'string', example: 'Each QR code' },
      env: { type: 'string', example: 'DINER_MAX_PER_TABLE', description: 'The environment variable that overrides it.' },
      sharedWithStaff: { type: 'boolean', description: 'true = the same rule staff sign-in obeys (counted per number/IP). Daily caps are NEVER shared.' },
    },
  },
  QrLimits: {
    type: 'object',
    properties: {
      limits: listOf('QrLimit'),
      usage: {
        type: 'object',
        properties: {
          sentToday: { type: 'integer', description: 'Diner codes sent today by this restaurant.' },
          tenantDailyCap: { type: 'integer' },
        },
      },
    },
  },
  QrPendingOrder: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      orderNo: { type: 'string', example: 'ORD-0142' },
      tableId: { type: 'string', format: 'uuid' },
      tableName: { type: 'string', example: 'T4' },
      floorName: { type: 'string', nullable: true },
      branchId: { type: 'string', format: 'uuid' },
      items: { type: 'array', items: { type: 'object' }, description: 'The priced line snapshot, as on any round.' },
      subTotal: { type: 'number' },
      taxAmount: { type: 'number' },
      total: { type: 'number' },
      cookingInstructions: { type: 'string', nullable: true },
      placedAt: { type: 'string', format: 'date-time' },
      customer: {
        type: 'object', nullable: true,
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          phone: { type: 'string', example: '+919876543210' },
          visits: { type: 'integer' },
          totalSpent: { type: 'number' },
          lastVisitAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
  },
  QrRejectionReason: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string', example: 'Item out of stock' },
      code: { type: 'string', example: 'OUT_OF_STOCK' },
    },
  },
  QrReject: {
    type: 'object', required: ['reasonId'],
    properties: {
      reasonId: { type: 'string', format: 'uuid', description: 'A HOUSE reason (pos_rejection_reason with no portal).' },
      note: { type: 'string', maxLength: 200, description: 'Shown to the guest on their phone.' },
    },
  },
  QrAcceptResult: {
    type: 'object',
    properties: {
      orderId: { type: 'string', format: 'uuid' },
      kot: { type: 'object', description: 'The kitchen ticket, as POST /api/pos/orders/{id}/fire-kot returns it.' },
    },
  },
  QrRejectResult: {
    type: 'object',
    properties: {
      orderId: { type: 'string', format: 'uuid' },
      status: { type: 'string', example: 'cancelled' },
    },
  },

  // ── Dine (public) ──────────────────────────────────────────────────────
  DineVenue: {
    type: 'object',
    properties: {
      businessName: { type: 'string', nullable: true, example: 'Saffron House' },
      branchName: { type: 'string', nullable: true, example: 'Indiranagar' },
      tableName: { type: 'string', example: 'T4' },
      floorName: { type: 'string', nullable: true, example: 'Ground floor' },
      mode: { type: 'string', enum: ['menu', 'order'] },
      canOrder: { type: 'boolean' },
    },
  },
  DineLogo: {
    type: 'object', nullable: true,
    properties: {
      mimeType: { type: 'string', example: 'image/png' },
      dataUri: { type: 'string', description: 'data:image/...;base64,...' },
      updatedOn: { type: 'string', format: 'date-time' },
    },
  },
  DinePhone: {
    type: 'object', required: ['phone'],
    properties: { phone: { type: 'string', example: '98765 43210', description: 'A 10-digit Indian mobile, any common format; normalised to +91XXXXXXXXXX.' } },
  },
  DineVerify: {
    type: 'object', required: ['challengeId', 'code'],
    properties: {
      challengeId: { type: 'string', format: 'uuid' },
      code: { type: 'string', pattern: '^\\d{4,8}$' },
      name: { type: 'string', maxLength: 100, description: 'Optional. Saved only if the customer is new or still "Guest"; a name staff entered is never overwritten.' },
    },
  },
  DineSession: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Diner session JWT — send as `Authorization: Bearer <token>` to the session routes.' },
      expiresInSeconds: { type: 'integer', example: 10800 },
      customer: {
        type: 'object',
        properties: {
          name: { type: 'string', nullable: true, description: 'null when they have not given one.' },
          isNew: { type: 'boolean', description: 'true on their first visit to this restaurant.' },
        },
      },
      venue: ref('DineVenue'),
    },
  },
  DineName: {
    type: 'object', required: ['name'],
    properties: { name: { type: 'string', minLength: 1, maxLength: 100, example: 'Priya' } },
  },
  DineSessionState: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['menu', 'order'] },
      canOrder: { type: 'boolean' },
    },
  },
  DineMenuItem: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid', description: 'pos_item_meta.Id — what an order line sends.' },
      name: { type: 'string', example: 'Paneer Tikka' },
      description: { type: 'string', nullable: true },
      isVeg: { type: 'boolean', nullable: true },
      foodType: { type: 'string', nullable: true },
      portionSize: { type: 'string', nullable: true },
      serves: { type: 'integer', nullable: true },
      price: { type: 'number', example: 280, description: 'What one costs before options — the gross the till shows.' },
      taxIncluded: { type: 'boolean' },
      available: { type: 'boolean', description: 'false when its category is outside trading hours right now.' },
      opensAt: { type: 'string', nullable: true, example: '19:00' },
      photoVersion: { type: 'integer', nullable: true, example: 1791310866, description: 'null = no photo, or photos off at this branch. Otherwise load GET /api/dine/{token}/photo/{id}?v=<this>.' },
      variants: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, price: { type: 'number', description: 'Surcharge on top of `price`.' } } },
      },
      addonGroups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            min: { type: 'integer', description: '> 0 makes the group mandatory.' },
            max: { type: 'integer', description: '0 = no upper limit.' },
            options: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, price: { type: 'number' } } } },
          },
        },
      },
    },
  },
  DineMenu: {
    type: 'object',
    properties: {
      canOrder: { type: 'boolean' },
      categories: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string', nullable: true }, name: { type: 'string' }, items: listOf('DineMenuItem') } },
      },
    },
  },
  DineLine: {
    type: 'object', required: ['id', 'quantity'], additionalProperties: false,
    description: 'Only these fields are accepted. A price, discount, name, table or customer in the body is refused — all of those come from the server.',
    properties: {
      id: { type: 'string', format: 'uuid', description: 'DineMenuItem.id' },
      quantity: { type: 'integer', minimum: 1, maximum: 50 },
      variantIds: { type: 'array', maxItems: 10, items: { type: 'string', format: 'uuid' } },
      addonIds: { type: 'array', maxItems: 30, items: { type: 'string', format: 'uuid' } },
      note: { type: 'string', maxLength: 140, description: 'For the kitchen, e.g. "less spicy".' },
    },
  },
  DineQuoteRequest: {
    type: 'object', required: ['items'],
    properties: { items: { type: 'array', minItems: 1, maxItems: 40, items: ref('DineLine') } },
  },
  DineQuote: {
    type: 'object',
    properties: {
      lines: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, quantity: { type: 'integer' }, amount: { type: 'number' } } } },
      subTotal: { type: 'number' },
      taxAmount: { type: 'number' },
      total: { type: 'number' },
    },
  },
  DinePlaceOrder: {
    type: 'object', required: ['items'],
    properties: {
      items: { type: 'array', minItems: 1, maxItems: 40, items: ref('DineLine') },
      cookingInstructions: { type: 'string', maxLength: 500, description: 'For the whole order.' },
    },
  },
  DinePlacedOrder: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      orderNo: { type: 'string' },
      status: { type: 'string', example: 'waiting' },
      total: { type: 'number' },
    },
  },
  DineOrder: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      orderNo: { type: 'string' },
      status: { type: 'string', enum: ['waiting', 'kitchen', 'ready', 'rejected'], description: 'waiting = staff have not accepted it yet; kitchen = KOT fired; ready = KOT ready/served; rejected = staff cancelled it (see `rejection`).' },
      placedAt: { type: 'string', format: 'date-time' },
      items: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'integer' }, variants: { type: 'array', items: { type: 'string' } }, addons: { type: 'array', items: { type: 'string' } }, note: { type: 'string', nullable: true } } },
      },
      subTotal: { type: 'number' },
      taxAmount: { type: 'number' },
      total: { type: 'number' },
      rejection: {
        type: 'object', nullable: true,
        properties: { reason: { type: 'string', nullable: true }, note: { type: 'string', nullable: true } },
      },
    },
  },
};

const paths = {
  // ── Auth — OTP ───────────────────────────────────────────────────────────
  '/api/auth/otp/request': {
    post: {
      tags: ['Auth — OTP'],
      summary: 'Send a staff sign-in code on WhatsApp',
      description: 'Answers identically whether or not the number is registered (an unknown number is recorded and sent nothing), which closes enumeration.\n\n**Limits** (config/rateLimits.js): per number 3 / 15 min, per IP 10 / 15 min, 60 s resend wait, and a platform daily cap (`OTP_DAILY_SEND_CAP`) counted over LOGIN and SIGNUP codes ONLY — diner codes have their own cap and can never switch staff sign-in off.',
      requestBody: body('OtpRequest'),
      responses: {
        ...ok(ref('OtpChallenge')),
        ...err(400, 'Invalid number, or the number has no WhatsApp'),
        ...err(429, 'Too many requests / resend too soon'),
        ...err(502, 'WhatsApp could not be reached'),
        ...err(503, 'Staff daily send cap reached, or WhatsApp not configured'),
      },
    },
  },
  '/api/auth/otp/verify': {
    post: {
      tags: ['Auth — OTP'],
      summary: 'Spend a staff sign-in code; returns the session token',
      description: 'Only LOGIN / SIGNUP challenges are accepted — a code a diner was sent at a QR table is refused here as expired. Five wrong tries lock the challenge; the attempt count is committed even though the request fails.',
      requestBody: body('OtpVerify'),
      responses: {
        200: { description: 'Signed in. Body: { success, message, token, onboardingStatus, user }' },
        ...err(400, 'Wrong code'),
        ...err(410, 'Expired, already used, or not a staff code'),
        ...err(429, 'Too many wrong tries — ask for a new code'),
      },
    },
  },

  // ── QR Ordering (staff) ──────────────────────────────────────────────────
  '/api/pos/qr/codes': {
    get: {
      tags: ['QR Ordering'],
      summary: 'Every table\'s QR code in a branch (issues missing ones)',
      description: `Returns each active table with its code. A table without one is issued a fresh 128-bit token in the same call, so a printed sheet is one request. The QR image should encode \`<public origin>/t/<token>\` — the backend returns only the token.\n\n${CODES_SCOPES} Audited.`,
      security: staffSecurity,
      parameters: [branchQuery],
      responses: { ...ok(ref('QrCodeList')), ...err(400, 'branchId missing or invalid'), ...staffErrors },
    },
  },
  '/api/pos/qr/codes/{tableId}/rotate': {
    post: {
      tags: ['QR Ordering'],
      summary: 'Rotate one table\'s code',
      description: `Replaces the token. The printed card stops resolving immediately and every diner session opened with it ends on its next request. Use when a card was photographed or taken, or orders arrive from people not at the table.\n\n${MANAGE_SCOPES} Audited at WARN.`,
      security: staffSecurity,
      parameters: [{ name: 'tableId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        ...ok(ref('QrCode')),
        ...err(404, 'Table not found or retired'),
        ...err(409, 'The table is not on a branch floor'),
        ...staffErrors,
      },
    },
  },
  '/api/pos/qr/settings': {
    get: {
      tags: ['QR Ordering'],
      summary: 'Is QR ordering on at this branch, and in which mode',
      description: `Stored per branch in pos_setting (qr.ordering.enabled / qr.ordering.mode). No row = OFF, mode \`order\`.\n\nStaff approval of every guest order is ALWAYS on and is not a setting.\n\n${CODES_SCOPES}`,
      security: staffSecurity,
      parameters: [branchQuery],
      responses: { ...ok(ref('QrSettings')), ...staffErrors },
    },
    put: {
      tags: ['QR Ordering'],
      summary: 'Switch QR ordering on/off or change its mode',
      description: `Partial update. Setting a value back to its default removes the override. Switching OFF ends open diner sessions at this branch on their next request.\n\n${MANAGE_SCOPES} Audited at WARN.`,
      security: staffSecurity,
      parameters: [branchQuery],
      requestBody: body('QrSettingsUpdate'),
      responses: { ...ok(ref('QrSettings')), ...err(400, 'Validation error'), ...staffErrors },
    },
  },
  '/api/pos/qr/limits': {
    get: {
      tags: ['QR Ordering'],
      summary: 'Diner code limits (read-only) and today\'s usage',
      description: `The limits are defined once in config/rateLimits.js (DINER block, plus the shared OTP_REQUEST / OTP_VERIFY rules), each overridable by the environment variable named in \`env\`. They are NOT editable through the API.\n\n${CODES_SCOPES}`,
      security: staffSecurity,
      responses: { ...ok(ref('QrLimits')), ...staffErrors },
    },
  },
  '/api/pos/qr/orders/pending': {
    get: {
      tags: ['QR Ordering'],
      summary: 'Orders guests placed that await a decision',
      description: `Rounds on the QR channel that are still open and have never been sent to the kitchen, oldest first, with the verified customer (visits, spend) attached. Omit branchId for every branch.\n\n${QUEUE_SCOPES}`,
      security: staffSecurity,
      parameters: [{ ...branchQuery, required: false }],
      responses: { ...ok(listOf('QrPendingOrder')), ...staffErrors },
    },
  },
  '/api/pos/qr/rejection-reasons': {
    get: {
      tags: ['QR Ordering'],
      summary: 'Reasons a guest\'s order may be rejected with',
      description: `House reasons only (no portal). Served here so a cashier deciding orders does not need POS_CONFIG to read the master.\n\n${QUEUE_SCOPES}`,
      security: staffSecurity,
      responses: { ...ok(listOf('QrRejectionReason')), ...staffErrors },
    },
  },
  '/api/pos/qr/orders/{id}/accept': {
    post: {
      tags: ['QR Ordering'],
      summary: 'Accept a guest\'s order — send it to the kitchen',
      description: `Fires the KOT through the till's send-once path. Nothing a guest orders is cooked until this is called.\n\n${DECIDE_SCOPES} Audited at WARN.`,
      security: staffSecurity,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: {
        ...ok(ref('QrAcceptResult')),
        ...err(404, 'Order not found'),
        ...err(409, 'Not a QR order, or already accepted / rejected'),
        ...staffErrors,
      },
    },
  },
  '/api/pos/qr/orders/{id}/reject': {
    post: {
      tags: ['QR Ordering'],
      summary: 'Reject a guest\'s order with a reason',
      description: `Cancels the round, records the reason (pos_order.RejectionReasonId / RejectionNote) and frees the table if it was its only open round. The guest sees the reason on their phone.\n\n${DECIDE_SCOPES} Audited at WARN.`,
      security: staffSecurity,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      requestBody: body('QrReject'),
      responses: {
        ...ok(ref('QrRejectResult')),
        ...err(400, 'Unknown rejection reason'),
        ...err(404, 'Order not found'),
        ...err(409, 'Not a QR order, or already accepted / rejected'),
        ...staffErrors,
      },
    },
  },

  // ── Dine (public, guest's phone) ────────────────────────────────────────
  '/api/dine/{token}': {
    get: {
      tags: ['Dine (public)'],
      summary: 'Resolve a scanned QR code',
      description: 'No authentication. Unknown, rotated and switched-off codes all answer the same 404 so nobody can probe which exist. No ids are returned.',
      parameters: [tokenParam],
      responses: { ...ok(ref('DineVenue')), ...err(404, 'This QR code is not active') },
    },
  },
  '/api/dine/{token}/logo': {
    get: {
      tags: ['Dine (public)'],
      summary: 'The branch logo for the landing screen',
      description: '`data` is null when the branch has no logo.',
      parameters: [tokenParam],
      responses: { ...ok(ref('DineLogo')), ...err(404, 'This QR code is not active') },
    },
  },
  '/api/dine/{token}/photo/{itemId}': {
    get: {
      tags: ['Dine (public)'],
      summary: 'A dish photo for the guest menu',
      description: 'The image itself (image/jpeg or image/png), for an `<img>`. `itemId` is the menu entry id from GET /api/dine/menu; `v` is that item\'s `photoVersion`. A versioned request is cached publicly for a year (the URL changes when the photo does). `size=thumb` (default) is the ≤480px list copy; `full` the ≤1024px photo for the dish sheet.\n\nOnly dishes at the branch the code belongs to. 404 when the dish has no photo or the branch turned photos off. Rate-limited per IP by `DINER_PHOTO_MAX_REQUESTS` (2000 / 15 min), separately from the other guest routes.',
      parameters: [
        tokenParam,
        { name: 'itemId', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'size', in: 'query', schema: { type: 'string', enum: ['thumb', 'full'], default: 'thumb' } },
        { name: 'v', in: 'query', schema: { type: 'string', pattern: '^[0-9]+$' } },
      ],
      responses: {
        200: { description: 'The image', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } } } },
        ...err(404, 'Not active, no such dish here, no photo, or photos off'),
        ...err(429, 'Too many photo requests from this address'),
      },
    },
  },
  '/api/dine/{token}/otp/request': {
    post: {
      tags: ['Dine (public)'],
      summary: 'Send the guest a WhatsApp code',
      description: 'Purpose DINER, bound to this table. Always sent (every diner is a new number).\n\n**Limits:** the shared per-number / per-IP / resend rules, plus per table (`DINER_MAX_PER_TABLE`, 20 / 15 min), per restaurant per day (`DINER_TENANT_DAILY_CAP`, 500) and a platform diner cap (`DINER_DAILY_SEND_CAP`) that is separate from the staff cap.',
      parameters: [tokenParam],
      requestBody: body('DinePhone'),
      responses: {
        ...ok(ref('OtpChallenge')),
        ...err(400, 'Invalid number, or the number has no WhatsApp'),
        ...err(404, 'This QR code is not active'),
        ...err(429, 'Too many requests for this number, device or table'),
        ...err(502, 'WhatsApp could not be reached'),
        ...err(503, 'Diner codes paused — restaurant or platform daily cap reached (staff sign-in unaffected)'),
      },
    },
  },
  '/api/dine/{token}/otp/verify': {
    post: {
      tags: ['Dine (public)'],
      summary: 'Spend the code; save the guest as a customer; open a diner session',
      description: 'The challenge must be a DINER code requested at THIS table. On success the guest is found or created in pos_customer by normalised phone for this restaurant (one person = one customer across its branches), and a diner session token is returned.',
      parameters: [tokenParam],
      requestBody: body('DineVerify'),
      responses: {
        ...ok(ref('DineSession')),
        ...err(400, 'Wrong code'),
        ...err(404, 'This QR code is not active'),
        ...err(410, 'Expired, already used, or requested at a different table'),
        ...err(429, 'Too many wrong tries'),
      },
    },
  },
  '/api/dine/session': {
    get: {
      tags: ['Dine (public)'],
      summary: 'Is my diner session still valid?',
      security: dinerSecurity,
      responses: { ...ok(ref('DineSessionState')), ...dinerErrors },
    },
  },
  '/api/dine/me': {
    put: {
      tags: ['Dine (public)'],
      summary: 'Save a first-time guest\'s name',
      description: 'Applied only while the customer is still the "Guest" placeholder — a name staff or an earlier visit recorded is never overwritten from a phone. Returns the name now on record.',
      security: dinerSecurity,
      requestBody: body('DineName'),
      responses: {
        ...ok({ type: 'object', properties: { name: { type: 'string', nullable: true } } }),
        ...err(400, 'Validation error'),
        ...dinerErrors,
      },
    },
  },
  '/api/dine/menu': {
    get: {
      tags: ['Dine (public)'],
      summary: 'This branch\'s menu for a guest at a table',
      description: 'Dishes on this branch linked to the QR channel (or, until any are, the dine-in channel), plus dishes on no channel. Priced exactly as the till prices them; category trading hours applied. Dishes with no price are omitted.',
      security: dinerSecurity,
      responses: { ...ok(ref('DineMenu')), ...dinerErrors },
    },
  },
  '/api/dine/orders/quote': {
    post: {
      tags: ['Dine (public)'],
      summary: 'Price a cart without placing it',
      security: dinerSecurity,
      requestBody: body('DineQuoteRequest'),
      responses: { ...ok(ref('DineQuote')), ...err(400, 'Validation error, or a dish not on this branch\'s menu'), ...dinerErrors },
    },
  },
  '/api/dine/orders': {
    get: {
      tags: ['Dine (public)'],
      summary: 'My rounds at this table this session',
      security: dinerSecurity,
      responses: { ...ok(listOf('DineOrder')), ...dinerErrors },
    },
    post: {
      tags: ['Dine (public)'],
      summary: 'Place a round — it waits for staff before the kitchen sees it',
      description: 'Runs the till\'s full checks (on sale, trading hours, add-on rules) and pricing. Table, customer and branch come from the session; dish names from the catalogue. The round is created OPEN on the QR channel with NO kitchen ticket; staff accept it via POST /api/pos/qr/orders/{id}/accept.',
      security: dinerSecurity,
      requestBody: body('DinePlaceOrder'),
      responses: {
        ...ok(ref('DinePlacedOrder'), 201, 'Created'),
        ...err(400, 'Validation error, empty order, a dish not on this branch, not on sale, or outside trading hours'),
        ...err(409, 'This branch is in menu-only mode'),
        ...dinerErrors,
      },
    },
  },
};

module.exports = { securitySchemes, schemas, paths };
