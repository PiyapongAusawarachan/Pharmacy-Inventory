const { Pool, types } = require('pg');
const config = require('../config');

// Return DATE columns as plain 'YYYY-MM-DD' strings. By default pg converts them
// to JS Date objects at local midnight, which can shift the day by timezone.
types.setTypeParser(1082, (value) => value);

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
