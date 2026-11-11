// DEV ONLY: drops and recreates both databases' schema.
// Usage: npm run db:reset
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db/pg');
const { connectMongo, closeMongo } = require('../src/db/mongo');
const collections = require('../db/mongo/collections');

async function resetPostgres() {
  const sqlDir = path.join(__dirname, '..', 'db', 'sql');
  const files = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();

  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  for (const file of files) {
    const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
    await pool.query(sql);
    console.log(`  postgres: applied ${file}`);
  }
}

async function resetMongo() {
  const db = await connectMongo();
  for (const [name, def] of Object.entries(collections)) {
    await db.collection(name).drop().catch(() => {}); // ignore "ns not found"
    await db.createCollection(name, { validator: def.validator });
    for (const idx of def.indexes || []) {
      await db.collection(name).createIndex(idx.key, idx.options || {});
    }
    console.log(`  mongo: created ${name}`);
  }
}

(async () => {
  try {
    console.log('Resetting PostgreSQL...');
    await resetPostgres();
    console.log('Resetting MongoDB...');
    await resetMongo();
    console.log('Done.');
  } catch (err) {
    console.error('db:reset failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
    await closeMongo();
  }
})();
