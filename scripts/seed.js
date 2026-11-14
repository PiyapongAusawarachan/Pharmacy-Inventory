// DEV ONLY: fills PostgreSQL with demo data (accounts, suppliers, medicines, stock lots).
// Run after `npm run db:reset`:   npm run db:seed
//
// IMPORTANT - about the medicine data:
//  * This is a hand-written demo list, not an import of Thai Medicines Terminology (TMT).
//  * The legal_category / requires_khy11 values are the team's working assumptions taken from
//    secondary sources (see the research report). Check them with a pharmacist or the Thai FDA
//    lists before presenting them as legally accurate.
//  * Single-ingredient tramadol is NOT seeded on purpose: it became specially controlled in 2025.
const bcrypt = require('bcryptjs');
const { pool, withTransaction } = require('../src/db/pg');

const ACCOUNTS = [
  { username: 'admin', password: 'admin123', full_name: 'Demo Admin', role: 'ADMIN' },
  { username: 'pharmacist', password: 'pharma123', full_name: 'Demo Pharmacist', role: 'PHARMACIST' },
  { username: 'assistant', password: 'assist123', full_name: 'Demo Assistant', role: 'ASSISTANT' },
];

const SUPPLIERS = [
  { name: 'Siam Pharma Supply', phone: '02-111-2222', address: 'Bangkok' },
  { name: 'Northern Drug Wholesale', phone: '053-333-4444', address: 'Chiang Mai' },
  { name: 'Southern Medical Distribution', phone: '074-555-6666', address: 'Songkhla' },
];

// key, generic_name (lowercase, '+' for combos), strength, form, class, legal, rx, khy11,
// base unit, units per pack, price per unit, reorder level, lowStock (stock below reorder)
const M = (key, generic, strength, form, cls, legal, unit, perPack, price, reorder, extra = {}) => ({
  key, generic, strength, form, cls, legal, unit, perPack, price, reorder,
  rx: false, khy11: false, lowStock: false, ...extra,
});

const MEDICINES = [
  M('para500', 'paracetamol', '500 mg', 'tablet', 'PARACETAMOL', 'HOUSEHOLD', 'tablet', 100, 0.5, 200),
  M('parasyr', 'paracetamol', '120 mg/5 ml', 'syrup', 'PARACETAMOL', 'HOUSEHOLD', 'bottle', 12, 35, 12),
  M('ibu400', 'ibuprofen', '400 mg', 'tablet', 'NSAIDS', 'DANGEROUS', 'tablet', 100, 1.5, 100),
  M('diclo25', 'diclofenac', '25 mg', 'tablet', 'NSAIDS', 'DANGEROUS', 'tablet', 100, 1.2, 100),
  M('napro250', 'naproxen', '250 mg', 'tablet', 'NSAIDS', 'DANGEROUS', 'tablet', 100, 2, 80),
  M('amox500', 'amoxicillin', '500 mg', 'capsule', 'PENICILLINS', 'DANGEROUS', 'capsule', 100, 3, 100),
  M('amoxclav', 'amoxicillin+clavulanic acid', '500 mg+125 mg', 'tablet', 'PENICILLINS', 'DANGEROUS', 'tablet', 14, 18, 56),
  M('diclox500', 'dicloxacillin', '500 mg', 'capsule', 'PENICILLINS', 'DANGEROUS', 'capsule', 100, 3.5, 60),
  M('cefalexin500', 'cefalexin', '500 mg', 'capsule', 'CEPHALOSPORINS', 'DANGEROUS', 'capsule', 100, 4, 50, { lowStock: true }),
  M('azithro250', 'azithromycin', '250 mg', 'tablet', 'MACROLIDES', 'DANGEROUS', 'tablet', 6, 25, 30),
  M('roxithro150', 'roxithromycin', '150 mg', 'tablet', 'MACROLIDES', 'DANGEROUS', 'tablet', 10, 9, 40),
  M('cipro500', 'ciprofloxacin', '500 mg', 'tablet', 'FLUOROQUINOLONES', 'DANGEROUS', 'tablet', 10, 8, 40),
  M('doxy100', 'doxycycline', '100 mg', 'capsule', 'TETRACYCLINES', 'DANGEROUS', 'capsule', 100, 2.5, 60),
  M('smx', 'sulfamethoxazole+trimethoprim', '400 mg+80 mg', 'tablet', 'SULFONAMIDES', 'DANGEROUS', 'tablet', 100, 2, 60),
  M('cpmsyr', 'chlorpheniramine', '2 mg/5 ml', 'syrup', 'ANTIHISTAMINES', 'DANGEROUS', 'bottle', 12, 30, 12, { khy11: true }),
  M('cetirizine10', 'cetirizine', '10 mg', 'tablet', 'ANTIHISTAMINES', 'DANGEROUS', 'tablet', 100, 2, 100),
  M('loratadine10', 'loratadine', '10 mg', 'tablet', 'ANTIHISTAMINES', 'DANGEROUS', 'tablet', 100, 2.5, 100),
  M('dxm', 'dextromethorphan', '15 mg/5 ml', 'syrup', 'ANTITUSSIVES', 'DANGEROUS', 'bottle', 12, 40, 12, { khy11: true }),
  M('pred5', 'prednisolone', '5 mg', 'tablet', 'CORTICOSTEROIDS', 'SPECIAL_CONTROLLED', 'tablet', 100, 1, 100, { rx: true }),
  M('silde50', 'sildenafil', '50 mg', 'tablet', 'PDE5_INHIBITORS', 'SPECIAL_CONTROLLED', 'tablet', 4, 60, 20, { rx: true, lowStock: true }),
  M('omep20', 'omeprazole', '20 mg', 'capsule', 'PPIS', 'DANGEROUS', 'capsule', 100, 3, 100),
  M('antacid', 'aluminium hydroxide+magnesium hydroxide', '400 mg+400 mg/5 ml', 'suspension', 'ANTACIDS', 'HOUSEHOLD', 'bottle', 12, 45, 12),
  M('loperamide2', 'loperamide', '2 mg', 'capsule', 'ANTIDIARRHEALS', 'DANGEROUS', 'capsule', 100, 2, 60),
  M('ors', 'oral rehydration salts', '1 sachet', 'powder', 'ANTIDIARRHEALS', 'HOUSEHOLD', 'sachet', 50, 8, 50),
  M('vitc500', 'vitamin c', '500 mg', 'tablet', 'VITAMINS', 'PACKAGED_NON_DANGEROUS', 'tablet', 100, 1, 100),
  M('vitb', 'vitamin b complex', '1 tablet', 'tablet', 'VITAMINS', 'PACKAGED_NON_DANGEROUS', 'tablet', 100, 1.5, 100),
];

function isoDate(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

// Two normal lots per medicine, plus a few special lots so every screen has something to show.
function buildLots() {
  const lots = [];
  MEDICINES.forEach((m, i) => {
    const scale = m.lowStock ? 0.15 : 1;
    const base = Math.max(m.reorder, 20);
    const round = (n) => Math.max(1, Math.round(n));
    lots.push({
      key: m.key, no: `A${String(i + 1).padStart(3, '0')}`, supplier: i % 3,
      expiry: isoDate(60 + ((i * 13) % 100)), // near expiry (within 180 days)
      qty: round(base * 0.6 * scale), status: 'ACTIVE', received: isoDate(-(10 + (i % 15))),
    });
    lots.push({
      key: m.key, no: `B${String(i + 1).padStart(3, '0')}`, supplier: (i + 1) % 3,
      expiry: isoDate(380 + ((i * 29) % 300)), // comfortably in date
      qty: round(base * 1.4 * scale), status: 'ACTIVE', received: isoDate(-(3 + (i % 7))),
    });
  });

  // Special lots for demos.
  lots.push({ key: 'ibu400', no: 'X-EXP', supplier: 0, expiry: isoDate(-20), qty: 30, status: 'ACTIVE', received: isoDate(-400) }); // expired but still flagged ACTIVE
  lots.push({ key: 'amox500', no: 'X-OLD', supplier: 1, expiry: isoDate(-60), qty: 25, status: 'EXPIRED', received: isoDate(-500) });
  lots.push({ key: 'loratadine10', no: 'X-QRN', supplier: 2, expiry: isoDate(300), qty: 40, status: 'QUARANTINED', received: isoDate(-30) });
  lots.push({ key: 'para500', no: 'X-SOON', supplier: 0, expiry: isoDate(25), qty: 50, status: 'ACTIVE', received: isoDate(-200) }); // expires very soon: FEFO sells it first
  return lots;
}

async function main() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM staff');
  if (rows[0].n > 0) {
    console.log('The database already has data. Run `npm run db:reset` first, then `npm run db:seed`.');
    return;
  }

  await withTransaction(async (c) => {
    const staffIds = [];
    for (const a of ACCOUNTS) {
      const hash = await bcrypt.hash(a.password, 10);
      const r = await c.query(
        'INSERT INTO staff (username, password_hash, full_name, role) VALUES ($1,$2,$3,$4) RETURNING staff_id',
        [a.username, hash, a.full_name, a.role]
      );
      staffIds.push(r.rows[0].staff_id);
    }

    const supplierIds = [];
    for (const s of SUPPLIERS) {
      const r = await c.query(
        'INSERT INTO suppliers (name, phone, address) VALUES ($1,$2,$3) RETURNING supplier_id',
        [s.name, s.phone, s.address]
      );
      supplierIds.push(r.rows[0].supplier_id);
    }

    const medicineIds = {};
    const perPackByKey = {};
    for (const m of MEDICINES) {
      const r = await c.query(
        `INSERT INTO medicines
           (generic_name, strength, dosage_form, drug_class, legal_category, requires_prescription,
            requires_khy11, base_unit, units_per_pack, sell_price, reorder_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING medicine_id`,
        [m.generic, m.strength, m.form, m.cls, m.legal, m.rx, m.khy11, m.unit, m.perPack, m.price, m.reorder]
      );
      medicineIds[m.key] = r.rows[0].medicine_id;
      perPackByKey[m.key] = m;
    }

    const lots = buildLots();
    for (const l of lots) {
      const m = perPackByKey[l.key];
      const expiry = new Date(l.expiry);
      const mfg = new Date(expiry);
      mfg.setFullYear(mfg.getFullYear() - 2);
      await c.query(
        `INSERT INTO stock_lots
           (medicine_id, supplier_id, lot_number, mfg_date, expiry_date, received_date,
            qty_received, qty_on_hand, unit_cost, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9)`,
        [
          medicineIds[l.key], supplierIds[l.supplier], l.no, mfg.toISOString().slice(0, 10), l.expiry,
          l.received, l.qty, Number((m.price * 0.6).toFixed(2)), l.status,
        ]
      );
    }

    console.log(`Seeded: ${ACCOUNTS.length} staff, ${SUPPLIERS.length} suppliers, ${MEDICINES.length} medicines, ${lots.length} lots.`);
  });

  console.log('\nDemo accounts (local development only):');
  ACCOUNTS.forEach((a) => console.log(`  ${a.role.padEnd(10)} ${a.username} / ${a.password}`));
}

main()
  .catch((err) => {
    console.error('db:seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
