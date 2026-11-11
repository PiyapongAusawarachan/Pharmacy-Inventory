const express = require('express');
const { pool } = require('../db/pg');
const { getDb } = require('../db/mongo');

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

router.get('/', async (req, res, next) => {
  try {
    res.render('index', { title: 'Pharmacy Inventory', status: await checkDatabases() });
  } catch (err) {
    next(err);
  }
});

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
