// Stock alerts and notifications live in MongoDB; the facts they describe come from PostgreSQL.
const { pool } = require('../connections/pg');
const { getDb } = require('../connections/mongo');
const config = require('../config');

const ACTIVE_STATES = ['OPEN', 'ACKNOWLEDGED'];

async function notify({ role, staffId, message, ref }) {
  const doc = { message, is_read: false, created_at: new Date() };
  if (staffId) doc.recipient_staff_id = Number(staffId);
  else doc.recipient_role = role || 'PHARMACIST';
  if (ref) doc.ref = ref;
  await getDb().collection('notifications').insertOne(doc);
}

// Insert an alert unless the same problem already has an open one. Returns true if created.
async function raise(alert) {
  const col = getDb().collection('stock_alerts');
  const same = await col.findOne({
    type: alert.type, medicine_id: alert.medicine_id, lot_id: alert.lot_id, status: { $in: ACTIVE_STATES },
  });
  if (same) return false;
  await col.insertOne({ ...alert, status: 'OPEN', created_at: new Date(), resolved_by: null, resolved_at: null });
  return true;
}

const LOW_STOCK_SQL = `
  SELECT m.medicine_id, m.generic_name, m.strength, m.reorder_level,
         COALESCE(SUM(l.qty_on_hand) FILTER (
           WHERE l.status = 'ACTIVE' AND l.expiry_date > CURRENT_DATE), 0)::int AS sellable_qty
    FROM medicines m LEFT JOIN stock_lots l ON l.medicine_id = m.medicine_id
   WHERE m.is_active AND m.reorder_level > 0`;

async function raiseLowStock(rows) {
  let created = 0;
  for (const m of rows) {
    const made = await raise({
      type: 'LOW_STOCK', medicine_id: m.medicine_id, lot_id: null,
      current_qty: m.sellable_qty, threshold: m.reorder_level, expiry_date: null,
    });
    if (made) created += 1;
  }
  return created;
}

// Full scan, run from the Alerts page.
async function scanStock() {
  const low = await pool.query(`${LOW_STOCK_SQL} GROUP BY m.medicine_id HAVING
    COALESCE(SUM(l.qty_on_hand) FILTER (WHERE l.status = 'ACTIVE' AND l.expiry_date > CURRENT_DATE), 0) <= m.reorder_level`);
  const lots = await pool.query(
    `SELECT lot_id, medicine_id, qty_on_hand, expiry_date, (expiry_date <= CURRENT_DATE) AS expired
       FROM stock_lots
      WHERE status = 'ACTIVE' AND qty_on_hand > 0 AND expiry_date <= CURRENT_DATE + $1::int`,
    [config.nearExpiryDays]
  );

  let created = await raiseLowStock(low.rows);
  for (const l of lots.rows) {
    const made = await raise({
      type: l.expired ? 'EXPIRED' : 'NEAR_EXPIRY', medicine_id: l.medicine_id, lot_id: l.lot_id,
      current_qty: l.qty_on_hand, threshold: config.nearExpiryDays, expiry_date: new Date(`${l.expiry_date}T00:00:00Z`),
    });
    if (made) created += 1;
  }
  return created;
}

// After a committed sale: did any sold medicine fall to its reorder level?
async function checkLowStockAfterSale(medicineIds, t) {
  const { rows } = await pool.query(
    `${LOW_STOCK_SQL} AND m.medicine_id = ANY($1::int[]) GROUP BY m.medicine_id HAVING
      COALESCE(SUM(l.qty_on_hand) FILTER (WHERE l.status = 'ACTIVE' AND l.expiry_date > CURRENT_DATE), 0) <= m.reorder_level`,
    [medicineIds]
  );
  const created = await raiseLowStock(rows);
  if (created) {
    const names = rows.map((m) => `${m.generic_name} ${m.strength}`).join(', ');
    await notify({ role: 'PHARMACIST', message: t('Low stock after a sale: {0}', names), ref: { type: 'stock_alerts', id: 'LOW_STOCK' } });
  }
  return created;
}

module.exports = { notify, scanStock, checkLowStockAfterSale, ACTIVE_STATES };
