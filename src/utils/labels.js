// Display labels used in the views (not part of the database contract).
const LEGAL_LABELS = {
  HOUSEHOLD: 'Household remedy (ยาสามัญประจำบ้าน)',
  PACKAGED_NON_DANGEROUS: 'Packaged, not dangerous (ยาบรรจุเสร็จที่ไม่ใช่ยาอันตราย)',
  DANGEROUS: 'Dangerous drug (ยาอันตราย)',
  SPECIAL_CONTROLLED: 'Specially controlled (ยาควบคุมพิเศษ)',
};

const LEGAL_SHORT = {
  HOUSEHOLD: 'Household',
  PACKAGED_NON_DANGEROUS: 'Packaged',
  DANGEROUS: 'Dangerous',
  SPECIAL_CONTROLLED: 'Special controlled',
};

module.exports = { LEGAL_LABELS, LEGAL_SHORT };
