# Where the demo data comes from

This project is coursework. The seed data (`database/scripts/seed.js`) is for demonstration only and is **not clinical advice**. Every medicine is saved with `data_status = 'UNVERIFIED'` until a pharmacist checks it against the Thai FDA registered label.

## Medicines (54 rows)

| Field | Source | Reliability |
|---|---|---|
| Which medicines | Commonly sold items in Thai community pharmacies, from the team's research report | Reasonable, not from sales data |
| Brand names | Examples of brands on the Thai market | Examples only; no relationship with the brand owners |
| `legal_category`, `requires_khy11`, `max_qty_per_sale` | Secondary sources (news, pharmacy blogs, university Q&A pages) | **Unverified.** The official Thai FDA product search could not be reached |
| `indication`, `side_effects`, `warnings`, `max_daily_dose`, `storage_note` | Standard drug references, summarised | **Unverified** against Thai registered labels |
| `registration_no` | Left empty | Real numbers were not confirmed, so none are seeded. Format: `1A 114/55` |
| `unit_cost` of lots | 60% of the sell price | Invented |

### Prices actually observed (14 Nov 2026)

| Seed row | Observed price | Where |
|---|---|---|
| Tylenol 500 mg | 18 THB per 10 tablets | Watsons Thailand product page |
| Paracap 500 mg | 10 THB per 10 tablets | Marketplace listing via a price-comparison site |
| Air-X 80 mg | 179 THB per 100 tablets (bulk pack) | Makro PRO product page |
| Betadine 15 ml | 55 THB | Watsons Thailand product page |

All other prices are estimates. Dangerous drugs (antibiotics, NSAIDs, PPIs, chronic-disease drugs) have no public online price in Thailand.

### Known open questions

- Whether amlodipine, metformin and simvastatin may be sold by a pharmacist without a prescription. They are seeded as dangerous drugs, which is the common understanding, but one news source says a prescription is needed.
- The 2025 household-remedy list (ยาสามัญประจำบ้านแผนปัจจุบัน พ.ศ. 2568): the official annex was not read, so strengths and pack-size limits are not checked. Pack size can change the category.
- The monthly purchase limit for dextromethorphan differs between sources and is not modelled.

### Left out on purpose

Single-ingredient tramadol (specially controlled since 2025), pseudoephedrine (not sellable in pharmacies), codeine cough syrups and oral steroids.

## Patients, suppliers, staff

All invented. No real person or company is described.

## Ledgers

The ข.ย.9 and ข.ย.11 pages show the same information as the legal ledgers in a simplified layout. Form numbering and required columns were taken from secondary sources and should be checked against the current Thai FDA announcement.
