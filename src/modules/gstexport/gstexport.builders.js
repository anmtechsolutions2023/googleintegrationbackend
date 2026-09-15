// src/modules/gstexport/gstexport.builders.js
// Turns a month of ledger documents into the sheets a GST return needs.
//
// PURE: no database, no clock except where passed in. Everything here is a
// function of the documents handed to it, which is what makes the tie-out
// trustworthy — the check and the files are built from the same model, so they
// cannot disagree about what was sold.
//
// CLASSIFICATION, per line of every ISSUED document (settled, part-paid or
// refunded; drafts were never issued, cancelled ones only count in docs.csv):
//
//   sold through a portal ........ eco.csv (Table 14) — the aggregator pays the tax
//   issued with GST switched off . withoutGst — NOT a GSTR-1 table; its own file
//   0% rate ...................... exemp.csv (Table 8)
//   buyer GSTIN on the invoice ... b2b.csv / cdnr.csv
//   everything else .............. b2cs.csv, credit notes netted in
//
// Money is accumulated in paise (integers) and only formatted on the way out,
// so a month of additions cannot drift by a paisa.

const { toMinor, fromMinor } = require('../../utils/taxCalculator');
const { placeOfSupply, isGstin, normaliseGstin } = require('../../utils/gstStates');
const { toCsv, money } = require('../../utils/csv');
const { LEDGER } = require('../../config/constants');

const ISSUED = new Set([LEDGER.STATUS_SETTLED, LEDGER.STATUS_PARTIALLY_PAID, LEDGER.STATUS_REFUNDED]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parseJson = (v, fallback) => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

/** 'YYYY-MM-DD' from a DATE column, whichever way the driver hands it over. */
const isoDate = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

/** '07-Aug-2026' — the date format the GST offline tool reads. */
const portalDate = (v) => {
  const iso = isoDate(v);
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
};

const m2 = (minor) => money(fromMinor(minor));

/**
 * CGST / SGST / IGST / cess out of a line's stored components.
 *
 * Matched by NAME, because tax types are tenant-defined. A component whose name
 * says none of them (a single "GST 5%") is intra-state GST in all but name, so
 * it is split half and half — the only representation a return accepts.
 */
const splitComponents = (components) => {
  let cgst = 0; let sgst = 0; let igst = 0; let cess = 0; let other = 0; let rateMinor = 0;
  (Array.isArray(components) ? components : []).forEach((c) => {
    const name = String(c?.name || '').toUpperCase();
    const amount = toMinor(c?.amount || 0);
    if (name.includes('CESS')) { cess += amount; return; }
    rateMinor += toMinor(c?.rate || 0);
    if (name.includes('IGST')) igst += amount;
    else if (name.includes('CGST')) cgst += amount;
    else if (name.includes('SGST') || name.includes('UTGST')) sgst += amount;
    else other += amount;
  });
  if (other) {
    const half = Math.floor(other / 2);
    cgst += half;
    sgst += other - half;
  }
  return { cgst, sgst, igst, cess, rate: fromMinor(rateMinor) };
};

const choicesOf = (row) => [
  ...parseJson(row.Variants, []),
  ...parseJson(row.Addons, []),
].filter((c) => c && c.name)
  .map((c) => (Number(c.price) > 0 ? `${c.name} +${money(c.price)}` : c.name))
  .join('; ');

/** Natural order for document numbers, so INV-0010 follows INV-0009. */
const trailingNumber = (no) => {
  const m = String(no || '').match(/^(.*?)(\d+)$/);
  return m ? { prefix: m[1], n: Number(m[2]) } : { prefix: String(no || ''), n: null };
};
const byDocNumber = (a, b) => {
  const x = trailingNumber(a); const y = trailingNumber(b);
  if (x.prefix !== y.prefix) return x.prefix < y.prefix ? -1 : 1;
  if (x.n !== null && y.n !== null) return x.n - y.n;
  return String(a).localeCompare(String(b));
};

/**
 * The normalised model every sheet is built from.
 *
 * @param {Object} input
 * @param {Array} input.documents - GST_EXPORT.SELECT_DOCUMENTS rows
 * @param {Array} input.lines     - GST_EXPORT.SELECT_LINES rows
 * @param {Map<string,string>} [input.tenders] - logId → "Cash + UPI"
 */
const buildModel = ({ documents = [], lines = [], tenders = new Map() }) => {
  const byLog = new Map();
  lines.forEach((l) => {
    const list = byLog.get(l.LogId) || [];
    list.push(l);
    byLog.set(l.LogId, list);
  });

  return documents.map((d) => {
    const isReturn = d.TypeName === LEDGER.TYPE_POS_RETURN;
    const status = String(d.StatusName || '').toUpperCase();
    const taxMode = d.TaxMode || 'gst';
    const source = parseJson(d.Source, null) || {};
    const rawBuyer = isReturn ? (d.OriginalBuyerGstin || d.BuyerGstin) : d.BuyerGstin;
    const buyerGstin = isGstin(rawBuyer) ? normaliseGstin(rawBuyer) : null;

    return {
      id: d.Id,
      number: d.TransactionNo,
      date: isoDate(d.TransactionDate),
      branchName: d.BranchName || '',
      isReturn,
      sign: isReturn ? -1 : 1,
      status,
      issued: ISSUED.has(status),
      cancelled: status === LEDGER.STATUS_CANCELLED,
      taxMode,
      buyerGstin,
      // The registration the document was issued under. NULL when the branch
      // had no GSTIN at the time.
      sellerGstin: isGstin(d.SellerGstin) ? normaliseGstin(d.SellerGstin) : null,
      buyerName: (isReturn ? d.OriginalBuyerLegalName : d.BuyerLegalName) || d.CustomerName || '',
      customerName: d.CustomerName || '',
      originalNo: d.OriginalNo || '',
      portalName: source.portalName || null,
      portalGstin: isGstin(source.portalGstin) ? normaliseGstin(source.portalGstin) : null,
      channel: source.portalName || source.channel || source.orderType || '',
      net: toMinor(d.NetAmount || 0),
      tax: toMinor(d.TaxAmount || 0),
      roundOff: toMinor(d.RoundOff || 0),
      gross: toMinor(d.GrossAmount || 0),
      tenders: tenders.get(d.Id) || '',
      lines: (byLog.get(d.Id) || []).map((l) => {
        const split = splitComponents(parseJson(l.TaxComponents, []));
        const sac = String(l.SACCode || '').trim();
        const hsn = String(l.HSNCode || '').trim();
        return {
          lineNo: Number(l.LineNo) || 0,
          itemName: l.ItemName || l.Comment || 'Item',
          code: sac || hsn,
          isService: !!sac || !hsn,
          qty: Number(l.Quantity) || 0,
          unitPrice: Number(l.UnitPrice) || 0,
          taxable: toMinor(l.NetAmount || 0),
          discount: toMinor(l.DiscountAmount || 0),
          tax: toMinor(l.TaxAmount || 0),
          gross: toMinor(l.GrossAmount || 0),
          ...split,
          charged: Number(l.TaxCharged ?? 1) === 1 && taxMode === 'gst',
          choices: choicesOf(l),
        };
      }),
    };
  });
};

const bump = (map, key, seed) => {
  if (!map.has(key)) map.set(key, seed());
  return map.get(key);
};

/**
 * Classifies every line of every issued document.
 * @param {Array} model - from buildModel
 * @param {string|null} branchGstin
 */
const classify = (model, branchGstin) => {
  const pos = placeOfSupply(branchGstin) || '';
  const acc = {
    pos,
    b2cs: new Map(),
    b2b: new Map(),
    cdnr: new Map(),
    exempt: { registered: 0, unregistered: 0 },
    hsn: { b2c: new Map(), b2b: new Map() },
    eco: new Map(),
    t31a: { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 },
    portalTax: 0,
    portalTaxDocs: new Set(),
    withoutGst: { taxable: 0, tax: 0, docs: new Set() },
    missingCodes: new Set(),
    portalsWithoutGstin: new Set(),
    b2bInvoices: new Set(),
  };

  model.filter((d) => d.issued).forEach((doc) => {
    const s = doc.sign;
    doc.lines.forEach((line) => {
      if (doc.portalName) {
        const eco = bump(acc.eco, doc.portalGstin || doc.portalName, () => ({
          name: doc.portalName, gstin: doc.portalGstin, value: 0,
        }));
        eco.value += s * line.taxable;
        if (!doc.portalGstin) acc.portalsWithoutGstin.add(doc.portalName);
        if (line.tax) { acc.portalTax += s * line.tax; acc.portalTaxDocs.add(doc.id); }
        return;
      }

      if (!line.charged) {
        acc.withoutGst.taxable += s * line.taxable;
        acc.withoutGst.tax += s * line.tax;
        acc.withoutGst.docs.add(doc.id);
        return;
      }

      if (!line.code) acc.missingCodes.add(line.itemName);
      const hsn = bump(doc.buyerGstin ? acc.hsn.b2b : acc.hsn.b2c, `${line.code}|${line.rate}`, () => ({
        code: line.code, isService: line.isService, rate: line.rate,
        qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0,
      }));
      if (!line.isService) hsn.qty += s * line.qty;
      hsn.taxable += s * line.taxable;
      hsn.cgst += s * line.cgst;
      hsn.sgst += s * line.sgst;
      hsn.igst += s * line.igst;
      hsn.cess += s * line.cess;

      if (line.rate === 0) {
        acc.exempt[doc.buyerGstin ? 'registered' : 'unregistered'] += s * line.taxable;
        return;
      }

      acc.t31a.taxable += s * line.taxable;
      acc.t31a.cgst += s * line.cgst;
      acc.t31a.sgst += s * line.sgst;
      acc.t31a.igst += s * line.igst;
      acc.t31a.cess += s * line.cess;

      if (doc.buyerGstin) {
        // Notes are reported as positive values in their own sheet, not netted.
        const target = doc.isReturn ? acc.cdnr : acc.b2b;
        const row = bump(target, `${doc.id}|${line.rate}`, () => ({ doc, rate: line.rate, taxable: 0, cess: 0 }));
        row.taxable += line.taxable;
        row.cess += line.cess;
        if (!doc.isReturn) acc.b2bInvoices.add(doc.id);
      } else {
        const row = bump(acc.b2cs, `${pos}|${line.rate}`, () => ({ pos, rate: line.rate, taxable: 0, cess: 0 }));
        row.taxable += s * line.taxable;
        row.cess += s * line.cess;
      }
    });
  });

  return acc;
};

/** Number range, total and cancelled count for one document series. */
const docSeries = (docs) => {
  const numbers = docs.map((d) => d.number).sort(byDocNumber);
  let gaps = 0;
  const parsed = numbers.map(trailingNumber);
  const samePrefix = parsed.length > 1 && parsed.every((p) => p.n !== null && p.prefix === parsed[0].prefix);
  if (samePrefix) {
    const distinct = new Set(parsed.map((p) => p.n)).size;
    gaps = Math.max(0, (parsed[parsed.length - 1].n - parsed[0].n + 1) - distinct);
  }
  return {
    from: numbers[0] || '',
    to: numbers[numbers.length - 1] || '',
    total: numbers.length,
    cancelled: docs.filter((d) => d.cancelled).length,
    gaps,
  };
};

/**
 * Ties the return back to the ledger: every issued document's header, against
 * the sum of what the sheets classified from its lines.
 */
const tieOut = (model, acc) => {
  const issued = model.filter((d) => d.issued);
  const ledgerNet = issued.reduce((sum, d) => sum + d.sign * d.net, 0);
  const ledgerTax = issued.reduce((sum, d) => sum + d.sign * d.tax, 0);
  const ecoTotal = [...acc.eco.values()].reduce((sum, e) => sum + e.value, 0);
  const returnNet = acc.t31a.taxable + acc.exempt.registered + acc.exempt.unregistered
    + ecoTotal + acc.withoutGst.taxable;
  const returnTax = acc.t31a.cgst + acc.t31a.sgst + acc.t31a.igst + acc.t31a.cess
    + acc.portalTax + acc.withoutGst.tax;
  return {
    ledgerNet, returnNet, netDifference: returnNet - ledgerNet,
    ledgerTax, returnTax, taxDifference: returnTax - ledgerTax,
    ecoTotal,
    matches: returnNet === ledgerNet && returnTax === ledgerTax,
  };
};

// ── The sheets ─────────────────────────────────────────────────────────────

const B2CS_HEADERS = ['Type', 'Place Of Supply', 'Rate', 'Applicable % of Tax Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'];
const B2B_HEADERS = ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'];
const CDNR_HEADERS = ['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'];
const EXEMP_HEADERS = ['Description', 'Nil Rated Supplies', 'Exempted(other than nil rated/non GST supply)', 'Non-GST Supplies'];
const HSN_HEADERS = ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'];
const DOCS_HEADERS = ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'];
const ECO_HEADERS = ['Nature of Supply', 'GSTIN of E-Commerce Operator', 'E-Commerce Operator Name', 'Net value of supplies', 'Integrated tax', 'Central tax', 'State/UT tax', 'Cess'];
const G3B_HEADERS = ['Section', 'Description', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess'];
const REGISTER_HEADERS = ['Document No', 'Date', 'Document Type', 'Status', 'Against', 'Customer', 'Customer GSTIN', 'Place Of Supply', 'Channel', 'Line', 'Item', 'SAC/HSN', 'Qty', 'Unit Price', 'Options & Add-ons', 'Discount', 'Taxable Value', 'GST Rate', 'CGST', 'SGST', 'IGST', 'Cess', 'Line Total', 'Round Off', 'Document Total', 'Payment Modes', 'GST Charged', 'Seller GSTIN'];
const NO_GST_HEADERS = ['Bill No', 'Bill Date', 'Document Type', 'Branch', 'Channel', 'Line', 'Item', 'SAC/HSN', 'Qty', 'Unit Price', 'Options & Add-ons', 'Discount', 'Line Amount', 'Bill Total', 'Payment Modes', 'Tax Mode At Sale', 'Status'];

const sheetB2cs = (acc) => toCsv(B2CS_HEADERS, [...acc.b2cs.values()]
  .filter((r) => r.taxable || r.cess)
  .map((r) => ['OE', r.pos, r.rate, '', m2(r.taxable), m2(r.cess), '']));

const sheetB2b = (acc) => toCsv(B2B_HEADERS, [...acc.b2b.values()].map((r) => [
  r.doc.buyerGstin, r.doc.buyerName, r.doc.number, portalDate(r.doc.date), m2(r.doc.gross),
  acc.pos, 'N', '', 'Regular B2B', '', r.rate, m2(r.taxable), m2(r.cess),
]));

const sheetCdnr = (acc) => toCsv(CDNR_HEADERS, [...acc.cdnr.values()].map((r) => [
  r.doc.buyerGstin, r.doc.buyerName, r.doc.number, portalDate(r.doc.date), 'C',
  acc.pos, 'N', 'Regular B2B', m2(r.doc.gross), '', r.rate, m2(r.taxable), m2(r.cess),
]));

const sheetExemp = (acc) => toCsv(EXEMP_HEADERS, [
  ['Inter-State supplies to registered persons', m2(0), m2(0), m2(0)],
  ['Intra-State supplies to registered persons', m2(0), m2(acc.exempt.registered), m2(0)],
  ['Inter-State supplies to unregistered persons', m2(0), m2(0), m2(0)],
  ['Intra-State supplies to unregistered persons', m2(0), m2(acc.exempt.unregistered), m2(0)],
]);

const sheetHsn = (bucket) => toCsv(HSN_HEADERS, [...bucket.values()].map((r) => {
  const tax = r.cgst + r.sgst + r.igst + r.cess;
  return [
    r.code, '', r.isService ? 'NA' : 'NOS-NUMBERS', r.isService ? 0 : r.qty,
    m2(r.taxable + tax), r.rate, m2(r.taxable), m2(r.igst), m2(r.cgst), m2(r.sgst), m2(r.cess),
  ];
}));

const sheetDocs = (model) => {
  const sales = model.filter((d) => !d.isReturn && (d.issued || d.cancelled));
  const notes = model.filter((d) => d.isReturn && (d.issued || d.cancelled));
  const rows = [];
  if (sales.length) {
    const s = docSeries(sales);
    rows.push(['Invoices for outward supply', s.from, s.to, s.total, s.cancelled]);
  }
  if (notes.length) {
    const n = docSeries(notes);
    rows.push(['Credit Note', n.from, n.to, n.total, n.cancelled]);
  }
  return toCsv(DOCS_HEADERS, rows);
};

const sheetEco = (acc) => toCsv(ECO_HEADERS, [...acc.eco.values()].map((e) => [
  'Liable to pay tax u/s 9(5)', e.gstin || '', e.name, m2(e.value), '', '', '', '',
]));

const sheetGstr3b = (acc, tie) => toCsv(G3B_HEADERS, [
  ['3.1(a)', 'Outward taxable supplies (other than zero rated, nil rated and exempted)',
    m2(acc.t31a.taxable), m2(acc.t31a.igst), m2(acc.t31a.cgst), m2(acc.t31a.sgst), m2(acc.t31a.cess)],
  ['3.1(b)', 'Outward taxable supplies (zero rated)', m2(0), m2(0), '', '', m2(0)],
  ['3.1(c)', 'Other outward supplies (nil rated, exempted)',
    m2(acc.exempt.registered + acc.exempt.unregistered), '', '', '', ''],
  ['3.1(e)', 'Non-GST outward supplies', m2(0), '', '', '', ''],
  ['3.1.1(ii)', 'Supplies made through e-commerce operators u/s 9(5)', m2(tie.ecoTotal), '', '', '', ''],
  ['3.2', 'Inter-State supplies to unregistered persons', m2(0), m2(0), '', '', ''],
  [],
  ['Check', 'Return total (3.1a + 3.1c + 3.1.1(ii) + sales without GST)', m2(tie.returnNet), '', '', '', ''],
  ['Check', 'Ledger — issued documents net of credit notes, before tax', m2(tie.ledgerNet), '', '', '', ''],
  ['Check', tie.matches ? 'Matches' : 'DIFFERENCE — see README.txt', m2(tie.netDifference), '', '', '', ''],
]);

const sheetRegister = (model, pos) => {
  const rows = [];
  model.filter((d) => d.issued || d.cancelled).forEach((doc) => {
    const s = doc.sign;
    const type = doc.isReturn ? 'Credit Note' : (doc.taxMode === 'gst' ? 'Tax Invoice' : 'Bill of Supply');
    doc.lines.forEach((l) => {
      rows.push([
        doc.number, portalDate(doc.date), type, doc.status, doc.originalNo,
        doc.buyerName || doc.customerName, doc.buyerGstin || '', pos, doc.channel,
        l.lineNo, l.itemName, l.code, s * l.qty, money(l.unitPrice), l.choices,
        m2(s * l.discount), m2(s * l.taxable), l.charged ? l.rate : 0,
        m2(s * l.cgst), m2(s * l.sgst), m2(s * l.igst), m2(s * l.cess), m2(s * l.gross),
        m2(s * doc.roundOff), m2(s * doc.gross), doc.tenders, l.charged ? 'Y' : 'N',
        doc.sellerGstin || '',
      ]);
    });
  });
  return toCsv(REGISTER_HEADERS, rows, { bom: true });
};

/**
 * Sales issued without GST, line by line, with a totals row. Your own record —
 * and, in composition months, the turnover the quarterly return is paid on.
 */
const sheetWithoutGst = (model) => {
  const rows = [];
  const bills = new Set();
  let qty = 0; let amount = 0;
  model.filter((d) => d.issued).forEach((doc) => {
    const s = doc.sign;
    const type = doc.isReturn ? 'Credit Note' : 'Bill of Supply';
    doc.lines.filter((l) => !l.charged && !doc.portalName).forEach((l) => {
      bills.add(doc.id);
      qty += s * l.qty;
      amount += s * l.gross;
      rows.push([
        doc.number, portalDate(doc.date), type, doc.branchName, doc.channel,
        l.lineNo, l.itemName, l.code, s * l.qty, money(l.unitPrice), l.choices,
        m2(s * l.discount), m2(s * l.gross), m2(s * doc.gross), doc.tenders,
        doc.taxMode === 'gst' ? 'GST on (line not charged)' : doc.taxMode, doc.status,
      ]);
    });
  });
  rows.push(['TOTAL', '', '', '', '', '', `${bills.size} documents`, '', qty, '', '', '', m2(amount), '', '', '', '']);
  return { csv: toCsv(NO_GST_HEADERS, rows, { bom: true }), bills: bills.size, amount };
};

/** Human-readable checks — the same list the export screen shows. */
const checksFor = ({ model, acc, tie, branch, filing }) => {
  const checks = [];
  const sales = model.filter((d) => !d.isReturn && (d.issued || d.cancelled));

  if (!branch.gstin) {
    checks.push({ key: 'gstin', level: 'block', text: 'This branch has no GSTIN, so the pack cannot state a place of supply.', action: 'gstin' });
  } else {
    // Each document carries the GSTIN it was issued under. Two ways that can
    // disagree with the branch as it stands today, and both matter to a return.
    const taxDocs = model.filter((d) => d.issued && d.taxMode === 'gst');
    const unsigned = taxDocs.filter((d) => !d.sellerGstin);
    if (unsigned.length > 0) {
      const one = unsigned.length === 1;
      checks.push({
        key: 'seller-gstin', level: 'warn',
        text: `${unsigned.length} tax invoice${one ? ' was' : 's were'} issued with no GSTIN on ${one ? 'it' : 'them'} — the branch had none when ${one ? 'it was' : 'they were'} settled. ${one ? 'It is' : 'They are'} filed here under ${branch.gstin}.`,
      });
    }
    const elsewhere = taxDocs.filter((d) => d.sellerGstin && d.sellerGstin !== branch.gstin);
    if (elsewhere.length > 0) {
      const one = elsewhere.length === 1;
      const gstins = [...new Set(elsewhere.map((d) => d.sellerGstin))];
      checks.push({
        key: 'seller-gstin-changed', level: 'warn',
        text: `${elsewhere.length} document${one ? ' was' : 's were'} issued under ${gstins.join(', ')}, not ${branch.gstin} — the branch's GSTIN has changed since. ${one ? 'It belongs' : 'They belong'} in the return for ${gstins.length === 1 ? 'that GSTIN' : 'those GSTINs'}.`,
      });
    }
  }
  if (sales.length === 0) {
    checks.push({ key: 'documents', level: 'warn', text: 'No invoices were issued in this month.' });
  } else {
    const s = docSeries(sales);
    checks.push({
      key: 'documents',
      level: s.gaps > 0 ? 'warn' : 'ok',
      text: `${s.total} invoices, ${s.from} to ${s.to}${s.gaps > 0 ? `, ${s.gaps} missing from the sequence` : ', no gaps'}${s.cancelled ? ` · ${s.cancelled} cancelled` : ''}.`,
    });
  }
  checks.push({
    key: 'tieout',
    level: tie.matches ? 'ok' : 'warn',
    text: tie.matches
      ? `Ties out to the ledger — ₹${m2(tie.ledgerNet)} before tax.`
      : `Does not tie out: the sheets total ₹${m2(tie.returnNet)} against ₹${m2(tie.ledgerNet)} in the ledger (difference ₹${m2(tie.netDifference)}).`,
  });
  if (acc.missingCodes.size > 0) {
    const names = [...acc.missingCodes];
    checks.push({
      key: 'codes', level: 'warn', action: 'menu',
      text: `${names.length} dish${names.length === 1 ? '' : 'es'} sold this month ${names.length === 1 ? 'has' : 'have'} no SAC or HSN code: ${names.slice(0, 6).join(', ')}${names.length > 6 ? '…' : ''}.`,
      items: names,
    });
  }
  if (acc.portalsWithoutGstin.size > 0) {
    checks.push({
      key: 'portals', level: 'warn', action: 'portals',
      text: `${[...acc.portalsWithoutGstin].join(', ')} ${acc.portalsWithoutGstin.size === 1 ? 'has' : 'have'} no GSTIN — the aggregator sheet cannot name the operator.`,
    });
  }
  if (acc.portalTaxDocs.size > 0) {
    checks.push({
      key: 'portal-tax', level: 'warn',
      text: `GST of ₹${m2(acc.portalTax)} is recorded on ${acc.portalTaxDocs.size} online order${acc.portalTaxDocs.size === 1 ? '' : 's'}. For food sold through an aggregator, the aggregator pays this tax.`,
    });
  }
  if (acc.withoutGst.docs.size > 0) {
    checks.push({
      key: 'without-gst', level: 'warn',
      text: `${acc.withoutGst.docs.size} document${acc.withoutGst.docs.size === 1 ? ' was' : 's were'} issued with GST switched off. They are not in the GSTR-1 sheets; the pack includes them as sales_without_gst.csv.`,
    });
  }
  if (filing) {
    checks.push({ key: 'filed', level: 'ok', text: `Marked as filed on ${portalDate(filing.FiledOn)}.` });
  }
  return checks;
};

const summaryFor = (model, acc, tie) => ({
  taxable: fromMinor(acc.t31a.taxable),
  cgst: fromMinor(acc.t31a.cgst),
  sgst: fromMinor(acc.t31a.sgst),
  igst: fromMinor(acc.t31a.igst),
  cess: fromMinor(acc.t31a.cess),
  exempt: fromMinor(acc.exempt.registered + acc.exempt.unregistered),
  viaAggregators: fromMinor(tie.ecoTotal),
  withoutGst: fromMinor(acc.withoutGst.taxable),
  withoutGstDocuments: acc.withoutGst.docs.size,
  invoices: model.filter((d) => !d.isReturn && d.issued).length,
  cancelled: model.filter((d) => !d.isReturn && d.cancelled).length,
  creditNotes: model.filter((d) => d.isReturn && d.issued).length,
  b2bInvoices: acc.b2bInvoices.size,
  ledgerNet: fromMinor(tie.ledgerNet),
  matches: tie.matches,
});

const readme = ({ period, branch, generatedAt, checks, tie, includesWithoutGst }) => [
  `GST export — ${period}`,
  `Branch: ${branch.name || ''}`,
  `GSTIN: ${branch.gstin || '(none on file)'}`,
  `Place of supply: ${placeOfSupply(branch.gstin) || '(unknown)'}`,
  `Generated: ${generatedAt}`,
  '',
  tie.matches
    ? `Tie-out: matches the ledger (${m2(tie.ledgerNet)} before tax).`
    : `Tie-out: DOES NOT MATCH. Sheets ${m2(tie.returnNet)} vs ledger ${m2(tie.ledgerNet)}; tax ${m2(tie.returnTax)} vs ${m2(tie.ledgerTax)}.`,
  '',
  'Checks:',
  ...checks.map((c) => `  [${c.level.toUpperCase()}] ${c.text}`),
  '',
  'Files:',
  '  gstr3b_summary.csv   GSTR-3B sales-side figures and the tie-out',
  '  b2cs.csv             GSTR-1 Table 7  — B2C sales by place of supply and rate, credit notes netted',
  '  b2b.csv              GSTR-1 Table 4  — invoices to buyers with a GSTIN',
  '  cdnr.csv             GSTR-1 Table 9B — credit notes to buyers with a GSTIN',
  '  exemp.csv            GSTR-1 Table 8  — 0% rated lines, reported as exempted',
  '  hsn_b2c.csv          GSTR-1 Table 12 — by SAC/HSN, B2C',
  '  hsn_b2b.csv          GSTR-1 Table 12 — by SAC/HSN, B2B',
  '  docs.csv             GSTR-1 Table 13 — document series issued and cancelled',
  '  eco.csv              GSTR-1 Table 14 — food sold through aggregators, tax paid by them',
  '  invoice_register.csv Every line of every invoice and credit note',
  ...(includesWithoutGst ? ['  sales_without_gst.csv Documents issued with GST switched off'] : []),
  '',
  'Column headers follow the GST offline tool. Do one test import before relying on',
  'them: the portal revises its templates from time to time. 0% lines are reported as',
  'exempted; move them to nil rated if that is what your menu items are.',
  '',
].join('\r\n');

module.exports = {
  isoDate,
  portalDate,
  splitComponents,
  buildModel,
  classify,
  docSeries,
  tieOut,
  sheetB2cs,
  sheetB2b,
  sheetCdnr,
  sheetExemp,
  sheetHsn,
  sheetDocs,
  sheetEco,
  sheetGstr3b,
  sheetRegister,
  sheetWithoutGst,
  checksFor,
  summaryFor,
  readme,
};
