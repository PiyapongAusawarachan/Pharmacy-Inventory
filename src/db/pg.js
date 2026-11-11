const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(config.pg);

// Run a function inside one SQL transaction.
// Commits if fn resolves, rolls back if it throws, always releases the client.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
