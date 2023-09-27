const PG = require('pg');

function createTestPool(max = 50, options = {}) {
  return new PG.Pool({
    connectionString: process.env.SUP_SQL_TEST_DSN || 'postgresql://localhost/test',
    idleTimeoutMillis: 10000,
    max,
    ssl: false,

    // Pass through to pg client
    idle_in_transaction_session_timeout: 10000,
    statement_timeout: 10000,

    ...options
  });
}

async function dropTables(conn, tableNames) {
  for (const tableName of tableNames) {
    await conn.query(`DROP TABLE IF EXISTS ${tableName}`);
  }
}

module.exports = {
  createTestPool,
  dropTables,
};
