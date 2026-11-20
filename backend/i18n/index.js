// Two-language UI. The English sentence is the key; Thai comes from ./th.js and
// short English labels for database codes (ACTIVE, PHARMACIST...) from EN below.
// A key with no translation is shown as it is, so a missing entry never breaks a page.
const TH = require('./th');

const EN = {
  ADMIN: 'Admin', PHARMACIST: 'Pharmacist', ASSISTANT: 'Assistant',
  ACTIVE: 'Ready to sell', QUARANTINED: 'Quarantined', EXPIRED: 'Expired', RECALLED: 'Recalled',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled',
  OPEN: 'Open', ACKNOWLEDGED: 'Acknowledged', RESOLVED: 'Resolved',
  LOW_STOCK: 'Low stock', NEAR_EXPIRY: 'Near expiry',
  HOUSEHOLD: 'Household remedy', PACKAGED_NON_DANGEROUS: 'Packaged, not dangerous',
  DANGEROUS: 'Dangerous drug', SPECIAL_CONTROLLED: 'Specially controlled',
  ALLERGY: 'Allergy', INTOLERANCE: 'Intolerance',
  'criticality.HIGH': 'High', 'criticality.LOW': 'Low', 'criticality.UNABLE_TO_ASSESS': 'Not assessed',
  CONFIRMED: 'Confirmed', UNCONFIRMED: 'Unconfirmed', REFUTED: 'Refuted',
  MILD: 'Mild', MODERATE: 'Moderate', SEVERE: 'Severe',
  SALE_COMMITTED: 'Sale saved', SALE_ROLLED_BACK: 'Sale rolled back', SALE_CANCELLED: 'Sale cancelled',
  ALLERGY_OVERRIDE: 'Allergy override', STOCK_SCANNED: 'Stock scanned',
  LOT_CREATED: 'Lot received', LOT_UPDATED: 'Lot updated', LOT_DELETED: 'Lot deleted',
  MEDICINE_CREATED: 'Medicine added', MEDICINE_UPDATED: 'Medicine updated', MEDICINE_DELETED: 'Medicine deleted',
  MEDICINE_DEACTIVATED: 'Medicine deactivated',
  SUPPLIER_CREATED: 'Supplier added', SUPPLIER_UPDATED: 'Supplier updated', SUPPLIER_DELETED: 'Supplier deleted',
  SUPPLIER_DEACTIVATED: 'Supplier deactivated',
  STAFF_CREATED: 'Staff added', STAFF_UPDATED: 'Staff updated', STAFF_DELETED: 'Staff deleted',
  STAFF_DEACTIVATED: 'Staff deactivated',
  PATIENT_CREATED: 'Patient added', PATIENT_UPDATED: 'Patient updated', PATIENT_DELETED: 'Patient deleted',
  ALLERGY_ADDED: 'Allergy recorded', ALLERGY_REMOVED: 'Allergy removed',
};

const DICT = { th: TH, en: EN };
const LANGS = Object.keys(DICT);

function translate(lang, key, ...args) {
  const dict = DICT[lang] || EN;
  let text = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
  if (text === null || text === undefined) return '';
  text = String(text);
  args.forEach((value, i) => {
    text = text.split(`{${i}}`).join(String(value));
  });
  return text;
}

module.exports = { translate, LANGS, TH, EN };
