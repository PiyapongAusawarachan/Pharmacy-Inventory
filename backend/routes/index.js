const express = require('express');
const { pool } = require('../connections/pg');
const { getDb } = require('../connections/mongo');
const config = require('../config');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

async function checkDatabases() {
  const status = { postgres: { ok: false }, mongo: { ok: false } };

  try {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`
    );
    status.postgres = { ok: true, tables: rows.map((r) => r.table_name) };
  } catch (err) {
    status.postgres = { ok: false, error: err.message };
  }

  try {
    const cols = await getDb().listCollections({}, { nameOnly: true }).toArray();
    status.mongo = { ok: true, collections: cols.map((c) => c.name).sort() };
  } catch (err) {
    status.mongo = { ok: false, error: err.message };
  }

  return status;
}

// Stock summary for the dashboard. A lot is "sellable" if it is ACTIVE, has stock
// and has not expired (same rule the FEFO sale will use).
async function stockSummary() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM medicines WHERE is_active)::int AS medicines,
       (SELECT COUNT(*) FROM stock_lots
          WHERE status = 'ACTIVE' AND qty_on_hand > 0 AND expiry_date > CURRENT_DATE)::int AS sellable_lots,
       (SELECT COUNT(*) FROM stock_lots
          WHERE status = 'ACTIVE' AND qty_on_hand > 0 AND expiry_date > CURRENT_DATE
            AND expiry_date <= CURRENT_DATE + $1::int)::int AS near_expiry,
       (SELECT COUNT(*) FROM stock_lots
          WHERE status = 'ACTIVE' AND qty_on_hand > 0 AND expiry_date <= CURRENT_DATE)::int AS expired_on_shelf`,
    [config.nearExpiryDays]
  );
  return rows[0];
}

// Extra dashboard blocks: what to deal with first, and today's sales.
async function dashboardData(user) {
  const { rows: lots } = await pool.query(
    `SELECT l.lot_id, l.lot_number, l.expiry_date, l.qty_on_hand, (l.expiry_date - CURRENT_DATE) AS days_left,
            m.generic_name, m.strength, m.base_unit
       FROM stock_lots l JOIN medicines m ON m.medicine_id = l.medicine_id
      WHERE l.status = 'ACTIVE' AND l.qty_on_hand > 0 AND l.expiry_date <= CURRENT_DATE + $1::int
      ORDER BY l.expiry_date, l.lot_id LIMIT 8`,
    [config.nearExpiryDays]
  );
  const { rows: extra } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM (
          SELECT m.medicine_id FROM medicines m LEFT JOIN stock_lots l ON l.medicine_id = m.medicine_id
           WHERE m.is_active GROUP BY m.medicine_id
          HAVING COALESCE(SUM(l.qty_on_hand) FILTER (
                   WHERE l.status = 'ACTIVE' AND l.expiry_date > CURRENT_DATE), 0) <= m.reorder_level) x)::int AS low_stock,
       (SELECT COUNT(*) FROM sales WHERE status = 'COMPLETED' AND sale_datetime::date = CURRENT_DATE)::int AS sales_today,
       (SELECT COALESCE(SUM(total_amount), 0) FROM sales
         WHERE status = 'COMPLETED' AND sale_datetime::date = CURRENT_DATE) AS revenue_today,
       (SELECT COUNT(*) FROM sales WHERE status = 'CANCELLED' AND cancelled_at::date = CURRENT_DATE)::int AS cancelled_today`
  );
  let notifications = [];
  let logs = [];
  try {
    const db = getDb();
    notifications = await db.collection('notifications')
      .find({ is_read: false, $or: [{ recipient_role: user.role }, { recipient_staff_id: user.staff_id }] })
      .sort({ created_at: -1 }).limit(5).toArray();
    logs = await db.collection('audit_logs').find({}).sort({ ts: -1 }).limit(6).toArray();
  } catch (err) {
    // MongoDB down: the SQL part of the dashboard still renders.
  }
  return { lots, extra: extra[0], notifications, logs };
}

// Public front page for customers; signed-in staff get the dashboard instead.
router.get('/', (req, res, next) => {
  if (req.session.user) return next();
  res.render('landing', { title: 'Your neighbourhood pharmacy', landing: true });
});

router.get('/', requireLogin, async (req, res, next) => {
  try {
    const status = await checkDatabases();
    const ready = status.postgres.ok && status.postgres.tables.includes('medicines');
    const summary = ready ? await stockSummary() : null;
    const dash = ready ? await dashboardData(req.session.user) : null;
    res.render('index', { title: 'Dashboard', status, summary, dash });
  } catch (err) {
    next(err);
  }
});

// Public: used to check that both databases are reachable.
router.get('/health', async (req, res, next) => {
  try {
    const status = await checkDatabases();
    const ok = status.postgres.ok && status.mongo.ok;
    res.status(ok ? 200 : 503).json(status);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
