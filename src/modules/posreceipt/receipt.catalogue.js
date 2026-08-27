// src/modules/posreceipt/receipt.catalogue.js
//
// EVERY field that can appear on a printed document, and what it may be set to.
//
// WHY THIS IS ONE FILE
// The editor, the validator, the resolver and (later) the ESC/POS renderer all
// need the same answer to "what fields exist, what may they be, and which of
// them is this branch not allowed to change". Three copies of that list is
// three answers, and the one that drifts is the one nobody is reading.
//
// Adding a field is ONE entry here. No schema change, no migration, no edit to
// the validator, the editor or the API — they are all generated from this.
//
// THE CONTROL IS NOT A CHECKBOX
// Most fields carry three states, not two. Take the customer's name: ALWAYS
// prints "Customer: —" on every walk-in bill, NEVER loses the name for the
// customers who did give one. IF_PRESENT is what anyone actually wants, and no
// boolean can express it.

const VISIBILITY = {
  ALWAYS: 'always',
  IF_PRESENT: 'if_present',
  NEVER: 'never',
};

// How a branch charges tax. Not a field — a MODE, because it cascades: it
// decides the document's own title, whether the tax rows exist at all, and
// whether a legal declaration is mandatory in the footer. Three independent
// checkboxes could each be set wrong; one mode cannot.
const TAX_MODE = {
  GST: 'gst',                   // registered — TAX INVOICE, tax rows, GSTIN
  COMPOSITION: 'composition',   // BILL OF SUPPLY, no tax collected, declaration
  UNREGISTERED: 'unregistered', // BILL OF SUPPLY, no tax rows, no declaration
};

const PAPER = { MM80: '80', MM58: '58' };

const DOC = {
  BILL: 'bill',
  CREDIT_NOTE: 'creditNote',
  KOT: 'kot',
  TOKEN_SLIP: 'tokenSlip',
};

const FIELD_TYPE = {
  VISIBILITY: 'visibility',
  ENUM: 'enum',
  TEXT: 'text',
};

// ── Lock predicates ──────────────────────────────────────────────────────────
// A settings screen that lets a restaurant print an illegal bill is a bad
// settings screen. A locked field states WHY and names the setting that would
// change it — refusing without an explanation just reads as broken.
const ALWAYS_REQUIRED = () => ({
  value: VISIBILITY.ALWAYS,
  reason: 'Required on every document',
  changeAt: null,
});

const lockGstin = (ctx) => {
  if (ctx.taxMode !== TAX_MODE.GST) {
    return { value: VISIBILITY.NEVER, reason: 'This branch is not GST registered', changeAt: 'Branch → Tax' };
  }
  return { value: VISIBILITY.ALWAYS, reason: 'Mandatory on a tax invoice', changeAt: 'Branch → Tax' };
};

const lockTaxRows = (ctx) => {
  if (ctx.taxMode === TAX_MODE.GST) return null; // free to choose the layout
  return {
    value: 'none',
    reason: ctx.taxMode === TAX_MODE.COMPOSITION
      ? 'A composition dealer may not collect tax'
      : 'An unregistered branch may not collect tax',
    changeAt: 'Branch → Tax',
  };
};

const lockCompositionNote = (ctx) => {
  if (ctx.taxMode !== TAX_MODE.COMPOSITION) {
    return { value: VISIBILITY.NEVER, reason: 'Only applies on the composition scheme', changeAt: 'Branch → Tax' };
  }
  return {
    value: VISIBILITY.ALWAYS,
    reason: 'A composition dealer must carry this declaration',
    changeAt: null,
  };
};

// Shorthand builders — the catalogue below stays readable rather than becoming
// a wall of near-identical object literals.
const vis = (key, label, def, hint, extra = {}) => ({
  key, label, hint, type: FIELD_TYPE.VISIBILITY, default: def,
  states: [VISIBILITY.ALWAYS, VISIBILITY.NEVER], ...extra,
});
// A field whose value depends on the SALE, not on a preference. These are the
// ones a boolean gets wrong.
const conditional = (key, label, def, hint, extra = {}) => ({
  key, label, hint, type: FIELD_TYPE.VISIBILITY, default: def,
  states: [VISIBILITY.ALWAYS, VISIBILITY.IF_PRESENT, VISIBILITY.NEVER], ...extra,
});
const choice = (key, label, def, options, hint, extra = {}) => ({
  key, label, hint, type: FIELD_TYPE.ENUM, default: def, options, ...extra,
});
const text = (key, label, def, hint, maxLength = 120) => ({
  key, label, hint, type: FIELD_TYPE.TEXT, default: def, maxLength,
});

// ── The catalogue ────────────────────────────────────────────────────────────
const DOCUMENTS = {
  [DOC.BILL]: {
    label: 'Bill',
    description: 'What the customer walks away with.',
    sections: [
      { key: 'header', label: 'Header', fields: [
        vis('logo', 'Logo', VISIBILITY.NEVER,
          'Monochrome, max 384px wide. A thermal printer has one ink.'),
        vis('shopName', 'Shop name', VISIBILITY.ALWAYS,
          'Double width. The one line read across a counter.', { locked: ALWAYS_REQUIRED }),
        vis('address', 'Address', VISIBILITY.ALWAYS,
          'From the branch record — never retyped here.'),
        vis('gstin', 'GSTIN', VISIBILITY.ALWAYS,
          'Mandatory on a tax invoice.', { locked: lockGstin }),
        vis('fssai', 'FSSAI licence', VISIBILITY.ALWAYS,
          'Display is a licence condition for most food businesses.'),
        text('headerLine', 'Extra header line', '',
          'Free text. Blank prints nothing.'),
      ] },

      { key: 'identity', label: 'Identity', fields: [
        vis('documentNo', 'Invoice number', VISIBILITY.ALWAYS,
          'The legal handle. Gap-free, per series.', { locked: ALWAYS_REQUIRED }),
        choice('dateTime', 'Date & time', 'datetime', [
          { value: 'datetime', label: 'Date + time' },
          { value: 'date', label: 'Date only' },
          { value: 'never', label: 'Never' },
        ]),
        conditional('token', 'Token', VISIBILITY.IF_PRESENT,
          'Counter sales have one; a table sale does not.'),
        conditional('table', 'Table & waiter', VISIBILITY.IF_PRESENT,
          'A table sale has one; a counter sale does not.'),
        conditional('customer', 'Customer name & mobile', VISIBILITY.IF_PRESENT,
          'Most walk-ins give neither.'),
        conditional('portalOrder', 'Portal order id', VISIBILITY.IF_PRESENT,
          'Zomato / Swiggy / District. Only on an aggregator sale.'),
        vis('cashier', 'Cashier', VISIBILITY.ALWAYS,
          'Who took the money. The standard shrinkage control.'),
      ] },

      { key: 'items', label: 'Items', fields: [
        choice('itemLayout', 'Layout', 'two_line', [
          { value: 'two_line', label: 'Name, then qty × rate' },
          { value: 'single_line', label: 'One line per item' },
        ], 'One line breaks the moment a dish is called "Paneer Tikka Masala Dry".'),
        vis('itemCode', 'Item code', VISIBILITY.NEVER,
          'Useful where staff key by code.'),
        vis('foodTypeMark', 'Veg / non-veg mark', VISIBILITY.NEVER,
          'The green or brown dot beside each dish.'),
        conditional('itemNotes', 'Modifiers & notes', VISIBILITY.IF_PRESENT,
          '"Jain, no onion" — what the kitchen was told.'),
        conditional('returnedQty', 'Returned quantity', VISIBILITY.IF_PRESENT,
          'On a reprint, how much of each line has come back.'),
      ] },

      { key: 'totals', label: 'Totals & tax', fields: [
        vis('subtotal', 'Subtotal', VISIBILITY.ALWAYS),
        conditional('discount', 'Discount', VISIBILITY.IF_PRESENT,
          'A zero-discount line on every bill is noise.'),
        choice('taxRows', 'Tax breakdown', 'split', [
          { value: 'split', label: 'CGST / SGST split' },
          { value: 'single', label: 'One tax line' },
          { value: 'none', label: 'No tax rows' },
        ], 'Stated from the document\'s own components — the rate the sale was raised at, never today\'s.',
        { locked: lockTaxRows }),
        conditional('roundOff', 'Round off', VISIBILITY.IF_PRESENT),
        vis('total', 'Total', VISIBILITY.ALWAYS, null, { locked: ALWAYS_REQUIRED }),
        conditional('returnsBlock', 'Returned & net', VISIBILITY.IF_PRESENT,
          'On a reprint. The original total keeps the weight; these ride beneath it.'),
      ] },

      { key: 'payment', label: 'Payment', fields: [
        vis('tenders', 'Tender lines', VISIBILITY.ALWAYS,
          'How it was paid — cash, card, UPI.'),
        conditional('tenderRef', 'Card / UPI reference', VISIBILITY.IF_PRESENT),
        conditional('changeDue', 'Change due', VISIBILITY.IF_PRESENT,
          'Only when cash was tendered over the total.'),
        conditional('balanceDue', 'Balance outstanding', VISIBILITY.IF_PRESENT,
          'A partly-paid bill must say so on the paper.'),
      ] },

      { key: 'footer', label: 'Footer', fields: [
        text('footerLine1', 'Footer line 1', 'Thank you — please come again'),
        text('footerLine2', 'Footer line 2', ''),
        vis('compositionNote', 'Composition declaration', VISIBILITY.NEVER,
          'Composition taxable person, not eligible to collect tax on supplies.',
          { locked: lockCompositionNote }),
        vis('upiQr', 'UPI QR code', VISIBILITY.NEVER,
          'Prints the branch VPA as a scannable block.'),
        vis('signature', 'Signature line', VISIBILITY.NEVER),
      ] },

      { key: 'paper', label: 'Paper & hardware', fields: [
        choice('paperWidth', 'Paper width', PAPER.MM80, [
          { value: PAPER.MM80, label: '80mm · 48 columns' },
          { value: PAPER.MM58, label: '58mm · 32 columns' },
        ], 'Not a scale: at 32 columns the totals restack.'),
        choice('copies', 'Copies', '1', [
          { value: '1', label: '1 — customer' },
          { value: '2', label: '2 — customer + merchant' },
        ]),
      ] },
    ],
  },

  [DOC.CREDIT_NOTE]: {
    label: 'Credit note',
    description: 'Money going the other way. Must not look like a bill.',
    sections: [
      { key: 'header', label: 'Header', fields: [
        vis('shopName', 'Shop name', VISIBILITY.ALWAYS, null, { locked: ALWAYS_REQUIRED }),
        vis('address', 'Address', VISIBILITY.ALWAYS),
        vis('gstin', 'GSTIN', VISIBILITY.ALWAYS, null, { locked: lockGstin }),
      ] },
      { key: 'identity', label: 'Identity', fields: [
        vis('documentNo', 'Credit note number', VISIBILITY.ALWAYS, null, { locked: ALWAYS_REQUIRED }),
        vis('originalNo', 'Against invoice', VISIBILITY.ALWAYS,
          'A credit note is meaningless without the sale it came off.',
          { locked: ALWAYS_REQUIRED }),
        choice('dateTime', 'Date & time', 'datetime', [
          { value: 'datetime', label: 'Date + time' },
          { value: 'date', label: 'Date only' },
        ]),
        conditional('reason', 'Reason', VISIBILITY.ALWAYS,
          'Why it came back. The kitchen-quality signal.'),
        vis('cashier', 'Cashier', VISIBILITY.ALWAYS),
        conditional('customer', 'Customer', VISIBILITY.IF_PRESENT),
      ] },
      { key: 'totals', label: 'Totals & tax', fields: [
        choice('taxRows', 'Tax breakdown', 'split', [
          { value: 'split', label: 'CGST / SGST split' },
          { value: 'single', label: 'One tax line' },
          { value: 'none', label: 'No tax rows' },
        ], 'Priced from the ORIGINAL line — an invoice raised at 18% gives back 18%.',
        { locked: lockTaxRows }),
        vis('total', 'Refunded total', VISIBILITY.ALWAYS, null, { locked: ALWAYS_REQUIRED }),
        vis('refundedTo', 'Refunded to', VISIBILITY.ALWAYS,
          'Which tender the money went back on.'),
      ] },
      { key: 'footer', label: 'Footer', fields: [
        vis('signature', 'Customer signature line', VISIBILITY.ALWAYS,
          'A refund somebody can prove they received.'),
        text('footerLine1', 'Footer line 1', 'Retain this note. It is your proof of refund.'),
        vis('compositionNote', 'Composition declaration', VISIBILITY.NEVER, null,
          { locked: lockCompositionNote }),
      ] },
      { key: 'paper', label: 'Paper & hardware', fields: [
        choice('paperWidth', 'Paper width', PAPER.MM80, [
          { value: PAPER.MM80, label: '80mm · 48 columns' },
          { value: PAPER.MM58, label: '58mm · 32 columns' },
        ]),
        // ONE, like the bill. A merchant copy for the customer's signature is a
        // reasonable thing to want and this is where you turn it on — but a
        // default that silently prints twice spends a shop's paper on a choice
        // nobody made, and reads as a bug rather than a courtesy.
        choice('copies', 'Copies', '1', [
          { value: '1', label: '1 — customer' },
          { value: '2', label: '2 — customer + merchant, for signature' },
        ]),
      ] },
    ],
  },

  [DOC.KOT]: {
    label: 'Kitchen ticket',
    description: 'Read at arm’s length by somebody holding a pan.',
    sections: [
      { key: 'identity', label: 'Identity', fields: [
        vis('documentNo', 'KOT number', VISIBILITY.ALWAYS, null, { locked: ALWAYS_REQUIRED }),
        conditional('table', 'Table', VISIBILITY.IF_PRESENT),
        conditional('token', 'Token', VISIBILITY.IF_PRESENT),
        vis('round', 'Round number', VISIBILITY.ALWAYS,
          'Which round of the meal this is.'),
        vis('waiter', 'Waiter', VISIBILITY.ALWAYS),
        choice('dateTime', 'Time', 'time', [
          { value: 'time', label: 'Time only' },
          { value: 'datetime', label: 'Date + time' },
          { value: 'never', label: 'Never' },
        ]),
      ] },
      { key: 'items', label: 'Items', fields: [
        // The default that makes a kitchen ticket a kitchen ticket.
        vis('prices', 'Prices', VISIBILITY.NEVER,
          'Off by default. A cook does not price the dish, and every character that is not the dish or the quantity is noise.'),
        vis('bigQty', 'Oversized quantity', VISIBILITY.ALWAYS,
          'Quantity first at double height. A "2" hidden after a long dish name gets read as a 1.'),
        conditional('itemNotes', 'Modifiers & notes', VISIBILITY.ALWAYS,
          '"Jain, no onion". The single most important line on this ticket.'),
        vis('foodTypeMark', 'Veg / non-veg mark', VISIBILITY.NEVER),
      ] },
      { key: 'paper', label: 'Paper & hardware', fields: [
        choice('paperWidth', 'Paper width', PAPER.MM80, [
          { value: PAPER.MM80, label: '80mm · 48 columns' },
          { value: PAPER.MM58, label: '58mm · 32 columns' },
        ]),
        choice('copies', 'Copies', '1', [
          { value: '1', label: '1' },
          { value: '2', label: '2 — kitchen + pass' },
        ]),
      ] },
    ],
  },

  [DOC.TOKEN_SLIP]: {
    label: 'Token slip',
    description: 'Exists for one number, so it gets the whole slip.',
    sections: [
      { key: 'header', label: 'Header', fields: [
        vis('shopName', 'Shop name', VISIBILITY.ALWAYS, null, { locked: ALWAYS_REQUIRED }),
        vis('address', 'Address', VISIBILITY.NEVER),
      ] },
      { key: 'identity', label: 'Identity', fields: [
        vis('token', 'Token number', VISIBILITY.ALWAYS,
          'Printed at 54px. The whole slip exists for this.', { locked: ALWAYS_REQUIRED }),
        conditional('documentNo', 'Invoice number', VISIBILITY.ALWAYS),
        choice('dateTime', 'Time', 'time', [
          { value: 'time', label: 'Time only' },
          { value: 'datetime', label: 'Date + time' },
          { value: 'never', label: 'Never' },
        ]),
        vis('itemCount', 'Item count', VISIBILITY.ALWAYS),
        vis('total', 'Amount paid', VISIBILITY.ALWAYS),
      ] },
      { key: 'footer', label: 'Footer', fields: [
        text('footerLine1', 'Footer line 1', 'Please wait for your number to be called'),
      ] },
      { key: 'paper', label: 'Paper & hardware', fields: [
        choice('paperWidth', 'Paper width', PAPER.MM80, [
          { value: PAPER.MM80, label: '80mm · 48 columns' },
          { value: PAPER.MM58, label: '58mm · 32 columns' },
        ]),
        choice('copies', 'Copies', '1', [
          { value: '1', label: '1' },
          { value: '2', label: '2 — customer + counter' },
        ]),
      ] },
    ],
  },
};

// ── Derived lookups ──────────────────────────────────────────────────────────
// Built once from DOCUMENTS rather than maintained beside it, so they can never
// disagree with the catalogue they describe.

/** Every field of a document, flattened, with its section key attached. */
const fieldsOf = (doc) => (DOCUMENTS[doc]?.sections || [])
  .flatMap((s) => s.fields.map((f) => ({ ...f, section: s.key })));

/** One field's definition, or undefined. */
const fieldDef = (doc, key) => fieldsOf(doc).find((f) => f.key === key);

/** The default value of every field of a document. */
const defaultsOf = (doc) => Object.fromEntries(
  fieldsOf(doc).map((f) => [f.key, String(f.default)]),
);

/** The values a field will accept, or null for free text. */
const allowedValues = (field) => {
  if (field.type === FIELD_TYPE.VISIBILITY) return field.states;
  if (field.type === FIELD_TYPE.ENUM) return field.options.map((o) => o.value);
  return null;
};

/**
 * The lock in force on a field, given the branch's context — or null when the
 * branch is free to choose.
 *
 * @param {Object} field - A catalogue field.
 * @param {Object} ctx - { taxMode }
 * @returns {{value: string, reason: string, changeAt: string|null}|null}
 */
const lockOf = (field, ctx) => (typeof field.locked === 'function' ? field.locked(ctx) : null);

/** Storage key for one field. `pos_setting.SettingKey` is VARCHAR(100). */
const settingKey = (doc, fieldKey) => `receipt.${doc}.${fieldKey}`;

/** The branch-level tax mode key — a MODE, so it hangs off no single document. */
const TAX_MODE_KEY = 'receipt.taxMode';

module.exports = {
  VISIBILITY, TAX_MODE, PAPER, DOC, FIELD_TYPE,
  DOCUMENTS,
  fieldsOf, fieldDef, defaultsOf, allowedValues, lockOf, settingKey, TAX_MODE_KEY,
};
