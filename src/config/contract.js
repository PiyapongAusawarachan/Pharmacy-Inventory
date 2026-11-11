// Shared data contract between PostgreSQL and MongoDB.
// These values MUST match the CHECK constraints in db/sql/001_schema.sql
// and the validators in db/mongo/collections.js. See docs/data-contract.md.
// Change them only by changing all three places together.

// Pharmacological drug classes, used for cross-class allergy checks.
// ATC code is for reference only (WHO ATC, entered by hand).
const DRUG_CLASSES = {
  PENICILLINS: { atc: 'J01C', label: 'Penicillins' },
  CEPHALOSPORINS: { atc: 'J01D', label: 'Cephalosporins' },
  MACROLIDES: { atc: 'J01FA', label: 'Macrolides' },
  FLUOROQUINOLONES: { atc: 'J01MA', label: 'Fluoroquinolones' },
  TETRACYCLINES: { atc: 'J01AA', label: 'Tetracyclines' },
  SULFONAMIDES: { atc: 'J01E', label: 'Sulfonamides' },
  NSAIDS: { atc: 'M01A', label: 'NSAIDs' },
  PARACETAMOL: { atc: 'N02BE', label: 'Paracetamol (anilides)' },
  OPIOIDS: { atc: 'N02A', label: 'Opioids' },
  ANTIHISTAMINES: { atc: 'R06A', label: 'Antihistamines (systemic)' },
  ANTITUSSIVES: { atc: 'R05D', label: 'Cough suppressants' },
  CORTICOSTEROIDS: { atc: 'H02AB', label: 'Corticosteroids (systemic)' },
  PDE5_INHIBITORS: { atc: 'G04BE', label: 'PDE5 inhibitors' },
  ANTACIDS: { atc: 'A02A', label: 'Antacids' },
  PPIS: { atc: 'A02BC', label: 'Proton pump inhibitors' },
  ANTIDIARRHEALS: { atc: 'A07', label: 'Antidiarrheals' },
  VITAMINS: { atc: 'A11', label: 'Vitamins' },
  OTHER: { atc: null, label: 'Other (no cross-class check)' },
};

// Thai Drug Act categories that affect who may sell.
const LEGAL_CATEGORIES = [
  'HOUSEHOLD', // ยาสามัญประจำบ้าน
  'PACKAGED_NON_DANGEROUS', // ยาบรรจุเสร็จที่ไม่ใช่ยาอันตราย
  'DANGEROUS', // ยาอันตราย - pharmacist must be present
  'SPECIAL_CONTROLLED', // ยาควบคุมพิเศษ - pharmacist + prescription
];

const STAFF_ROLES = ['ADMIN', 'PHARMACIST', 'ASSISTANT'];
const LOT_STATUSES = ['ACTIVE', 'QUARANTINED', 'EXPIRED', 'RECALLED'];
const SALE_STATUSES = ['COMPLETED', 'CANCELLED'];

// Allergen reference stored in MongoDB patient_notes.allergies[].allergen
//   level = 'CLASS'      -> code is a key of DRUG_CLASSES (e.g. 'PENICILLINS')
//   level = 'INGREDIENT' -> code is one ingredient name, lowercase,
//                           exactly as it appears in medicines.generic_name
const ALLERGEN_LEVELS = ['INGREDIENT', 'CLASS'];

// medicines.generic_name format: lowercase ingredients joined by '+',
// e.g. 'amoxicillin+clavulanic acid'. This lets an INGREDIENT allergy
// match combination products.
const INGREDIENT_SEPARATOR = '+';

module.exports = {
  DRUG_CLASSES,
  LEGAL_CATEGORIES,
  STAFF_ROLES,
  LOT_STATUSES,
  SALE_STATUSES,
  ALLERGEN_LEVELS,
  INGREDIENT_SEPARATOR,
};
