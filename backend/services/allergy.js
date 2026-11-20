// Allergy matching rule from docs/data-contract.md:
//   CLASS      -> allergen.code === medicine.drug_class
//   INGREDIENT -> allergen.code is one of the '+'-separated ingredients of medicine.generic_name
// The same rule is repeated in public/js/sale.js for the live warning; this one is the authority.
const { INGREDIENT_SEPARATOR } = require('../config/contract');

function matchAllergies(allergies, medicine) {
  const ingredients = String(medicine.generic_name).split(INGREDIENT_SEPARATOR);
  return (allergies || [])
    .filter((a) => a.verification_status !== 'REFUTED')
    .filter((a) =>
      a.allergen.level === 'CLASS'
        ? a.allergen.code === medicine.drug_class
        : ingredients.includes(a.allergen.code)
    )
    .map((a) => ({
      level: a.allergen.level,
      code: a.allergen.code,
      display: a.allergen.display,
      criticality: a.criticality || 'UNABLE_TO_ASSESS',
      medicine_id: medicine.medicine_id,
      medicine_name: `${medicine.generic_name} ${medicine.strength}`,
    }));
}

module.exports = { matchAllergies };
