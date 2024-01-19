'use strict';
const SQL = require('../src');
const {createTestPool, dropTables} = require('./_utils');
const test = require('ava');
const path = require('path');

const pool = createTestPool();

test.before(async () => {
  return SQL.connected(async (conn) => {
    await dropTables(conn, ['supple_migrations', 'supple_migration_a']);
  }, {pool});
});

let migrationCount = null;

test.serial('they run', async (t) => {
  await SQL.runMigrations(pool, path.join(__dirname, 'migrations'), {quiet: true});

  const mResp = await pool.query('SELECT count(*) m_count FROM supple_migrations');
  migrationCount = mResp.rows[0].m_count.length;
  t.true(migrationCount > 0);

  const resp = await pool.query('SELECT count(*) a_count FROM supple_migration_a');
  t.is(resp.rows[0].a_count, '3');
});

test.serial('they don\'t overrun', async (t) => {
  await SQL.runMigrations(pool, path.join(__dirname, 'migrations'), {quiet: true});

  const mResp = await pool.query('SELECT count(*) m_count FROM supple_migrations');
  t.is(mResp.rows[0].m_count.length, migrationCount);
});
