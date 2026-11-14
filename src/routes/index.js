const express = require('express');
const { pool } = require('../db/pg');
const { getDb } = require('../db/mongo');
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

router.get('/', requireLogin, async (req, res, next) => {
  try {
    const status = await checkDatabases();
    const summary = status.postgres.ok && status.postgres.tables.includes('medicines')
      ? await stockSummary()
      : null;
    res.render('index', { title: 'Dashboard', status, summary });
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
