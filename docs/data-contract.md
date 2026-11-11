# Data contract between PostgreSQL and MongoDB

Allergy checks compare data in MongoDB (`patient_notes`) with data in PostgreSQL (`medicines`). A foreign key cannot cross two databases, so both sides must follow the rules below. **Lock these on day 1.** Changing them later means changing three places together:

1. `src/config/contract.js`
2. `db/sql/001_schema.sql` (enums and CHECK constraints)
3. `db/mongo/collections.js` (validators)

## 1. `medicines.generic_name`

- Lowercase only (enforced by a CHECK constraint).
- Combination products: ingredients joined by `+`, no spaces around it.
  - `amoxicillin`
  - `amoxicillin+clavulanic acid`
- Use the substance name from TMT (SUBS/VTM level), translated to its English INN.

## 2. `medicines.drug_class`

One value from this list (enforced by a CHECK constraint). ATC codes are for reference; they come from the WHO ATC index and were entered by hand.

| drug_class | ATC | Examples |
|---|---|---|
| `PENICILLINS` | J01C | amoxicillin, amoxicillin+clavulanic acid, dicloxacillin |
| `CEPHALOSPORINS` | J01D | cefalexin |
| `MACROLIDES` | J01FA | azithromycin, roxithromycin |
| `FLUOROQUINOLONES` | J01MA | ciprofloxacin, norfloxacin |
| `TETRACYCLINES` | J01AA | doxycycline |
| `SULFONAMIDES` | J01E | sulfamethoxazole+trimethoprim |
| `NSAIDS` | M01A | ibuprofen, diclofenac, naproxen |
| `PARACETAMOL` | N02BE | paracetamol |
| `OPIOIDS` | N02A | tramadol+paracetamol |
| `ANTIHISTAMINES` | R06A | chlorpheniramine, cetirizine, loratadine |
| `ANTITUSSIVES` | R05D | dextromethorphan |
| `CORTICOSTEROIDS` | H02AB | prednisolone |
| `PDE5_INHIBITORS` | G04BE | sildenafil |
| `ANTACIDS` | A02A | aluminium hydroxide+magnesium hydroxide |
| `PPIS` | A02BC | omeprazole |
| `ANTIDIARRHEALS` | A07 | loperamide, oral rehydration salts |
| `VITAMINS` | A11 | vitamin c, vitamin b complex |
| `OTHER` | – | anything else (no cross-class check) |

A combination product gets the class of its main active ingredient (e.g. `amoxicillin+clavulanic acid` → `PENICILLINS`).

## 3. Allergen format in `patient_notes.allergies[].allergen`

```json
{ "level": "CLASS",      "code": "PENICILLINS", "display": "Penicillin allergy" }
{ "level": "INGREDIENT", "code": "ibuprofen",   "display": "Ibuprofen" }
```

- `level: "CLASS"` → `code` must be a `drug_class` value from the table above.
- `level: "INGREDIENT"` → `code` must be one ingredient name exactly as it appears inside `generic_name`.
- `display` is free text for humans only. **Never** match on `display`.

## 4. Matching rule (used before every sale)

A medicine triggers an allergy warning for a patient if any allergen matches:

- `CLASS`: `allergen.code === medicine.drug_class`
- `INGREDIENT`: `medicine.generic_name.split('+')` contains `allergen.code`

Example: a patient with `{level: CLASS, code: PENICILLINS}` is warned for both `amoxicillin` and `amoxicillin+clavulanic acid`. A patient with `{level: INGREDIENT, code: "amoxicillin"}` is also warned for `amoxicillin+clavulanic acid`.

## 5. `sales.patient_code`

- Refers to `patient_notes.patient_code` in MongoDB (unique index there).
- Not a real foreign key: the app must check the patient exists before saving a sale.
- Format: `P` + 5 digits, e.g. `P00001`.

## 6. Units

All quantities and prices in SQL are in the **base unit** (`medicines.base_unit`, e.g. tablet). Convert packs to base units when receiving stock: `qty_received = packs × units_per_pack`.
