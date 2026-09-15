// src/utils/gstStates.js
// GST state codes, and Place of Supply in the form the GST offline tool expects:
// "29-Karnataka".
//
// A GSTIN's first two digits ARE its state code, so a branch's state is derived
// from its GSTIN rather than stored beside it — two fields that must agree are
// two fields that eventually will not.

const STATES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  10: 'Bihar',
  11: 'Sikkim',
  12: 'Arunachal Pradesh',
  13: 'Nagaland',
  14: 'Manipur',
  15: 'Mizoram',
  16: 'Tripura',
  17: 'Meghalaya',
  18: 'Assam',
  19: 'West Bengal',
  20: 'Jharkhand',
  21: 'Odisha',
  22: 'Chhattisgarh',
  23: 'Madhya Pradesh',
  24: 'Gujarat',
  26: 'Dadra and Nagar Haveli and Daman and Diu',
  27: 'Maharashtra',
  29: 'Karnataka',
  30: 'Goa',
  31: 'Lakshadweep',
  32: 'Kerala',
  33: 'Tamil Nadu',
  34: 'Puducherry',
  35: 'Andaman and Nicobar Islands',
  36: 'Telangana',
  37: 'Andhra Pradesh',
  38: 'Ladakh',
  97: 'Other Territory',
};

// Format only — 2-digit state, 10-char PAN, entity digit, Z, checksum. Enough to
// catch a typo or a pasted phone number; the portal is the authority on whether
// a GSTIN is real.
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

const normaliseGstin = (value) => String(value || '').trim().toUpperCase();

const isGstin = (value) => GSTIN_PATTERN.test(normaliseGstin(value));

const stateCodeOf = (gstin) => {
  const g = normaliseGstin(gstin);
  if (!isGstin(g)) return null;
  const code = g.slice(0, 2);
  return STATES[code] ? code : null;
};

/** "29-Karnataka", or null when the GSTIN is missing or malformed. */
const placeOfSupply = (gstin) => {
  const code = stateCodeOf(gstin);
  return code ? `${code}-${STATES[code]}` : null;
};

module.exports = {
  STATES, GSTIN_PATTERN, normaliseGstin, isGstin, stateCodeOf, placeOfSupply,
};
