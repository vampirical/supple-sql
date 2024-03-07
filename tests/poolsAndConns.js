'use strict';
const SQL = require('../src');
const {createTestPool, dropTables} = require('./_utils');
const test = require('ava');
const PG = require('pg');

console.debug = function () {};
console.info = function () {};
console.warn = function () {};
console.error = function () {};

async function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(function() {
      resolve();
    }, ms);
  });
}

class GenericRecord extends SQL.Record {
  static fields = {
    id: {type: SQL.type.serial, primaryKey: true},
    value: {type: SQL.type.text},
  };
  static primaryKeyFields = ['id'];
  static table = 'supple_test_generic_record';
}

const pool = createTestPool();

test.before(async () => {
  return SQL.connected(async (conn) => {
    await dropTables(conn, [GenericRecord.table]);

    await conn.query(`
      CREATE TABLE ${GenericRecord.table} (
        id SERIAL PRIMARY KEY,
        value TEXT
      )
    `);
  }, {pool});
});

test.serial('getDefaultPool() can\'t be called before setDefaultPool()', async (t) => {
  t.throws(() => SQL.getDefaultPool(), {instanceOf: SQL.NoPoolSetError});
});

test.serial('getDefaultPool() throws if there is not a default pool', async (t) => {
  SQL.setDefaultPool(null);
  t.throws(() => SQL.getDefaultPool(), {instanceOf: SQL.NoPoolSetError});
});

test.serial('setDefaultPool()', async (t) => {
  const testPool = createTestPool();

  SQL.setDefaultPool(testPool);
  t.is(SQL.getDefaultPool(), testPool);

  SQL.setDefaultPool(null);
});

test.serial('passing a conn', async (t) => {
  const conn = await pool.connect();

  const aRecord = new GenericRecord(conn);
  aRecord.value = 'Conn';
  await t.notThrowsAsync(aRecord.save());

  const findPromise = GenericRecord.findOne(conn, {value: 'Conn'});
  await t.notThrowsAsync(findPromise);
  const findResult = await findPromise;
  t.deepEqual(findResult.data(), aRecord.data());

  await SQL.transaction(async (tConn) => {
    t.is(tConn, conn);
  }, {conn});
});

test.serial('passing a pool', async (t) => {
  const testPool = createTestPool(1);

  const value = 'Pool';

  const aRecord = new GenericRecord(testPool);
  aRecord.value = value;
  await t.notThrowsAsync(aRecord.save());
  const aData = aRecord.data();

  const findOnePromise = GenericRecord.findOne(testPool, {value});
  await t.notThrowsAsync(findOnePromise);
  const findOneResult = await findOnePromise;
  t.deepEqual(findOneResult.data(), aData);

  const findPromise = GenericRecord.find(testPool, {value});
  await t.notThrowsAsync(findPromise);
  const findResult = await findPromise;
  t.deepEqual(findResult.map(r => r.data()), [aData]);

  const expectedConn = await testPool.connect();
  expectedConn.release();

  await SQL.connected(async (conn) => {
    t.is(conn, expectedConn);
  }, {pool: testPool});

  await SQL.transaction(async (conn) => {
    t.is(conn, expectedConn);
  }, {pool: testPool});
});

test.serial('default pool works', async (t) => {
  const testPool = createTestPool(1);
  SQL.setDefaultPool(testPool);

  const value = 'Default Pool';

  const aRecord = new GenericRecord();
  aRecord.value = value;
  await t.notThrowsAsync(aRecord.save());
  const aData = aRecord.data();

  const findOnePromise = GenericRecord.findOne({value});
  await t.notThrowsAsync(findOnePromise);
  const findOneResult = await findOnePromise;
  t.deepEqual(findOneResult.data(), aData);

  const findPromise = GenericRecord.find({value});
  await t.notThrowsAsync(findPromise);
  const findResult = await findPromise;
  t.deepEqual(findResult.map(r => r.data()), [aData]);

  const expectedConn = await testPool.connect();
  expectedConn.release();

  await SQL.connected(async (conn) => {
    t.is(conn, expectedConn);
  });

  await SQL.transaction(async (conn) => {
    t.is(conn, expectedConn);
  });

  SQL.setDefaultPool(null);
});

test.serial('no default pool fails as expected', async (t) => {
  const r = new GenericRecord();
  r.id = 1;
  await t.throwsAsync(r.load(), {instanceOf: SQL.NoPoolSetError});

  await t.throwsAsync(GenericRecord.findOne({value: 'No Pool'}), {instanceOf: SQL.NoPoolSetError});

  await t.throwsAsync(SQL.connected(() => {}), {instanceOf: SQL.NoPoolSetError});

  await t.throwsAsync(SQL.transaction(() => {}), {instanceOf: SQL.NoPoolSetError});
});

test.serial('connections with a transaction left open are automatically pruned', async (t) => {
  const pool = createTestPool(1);

  const bustedConn = await pool.connect();
  bustedConn.query('BEGIN;');
  bustedConn.release();

  await SQL.connected(async (conn) => {
    t.not(conn, bustedConn);
  }, {pool});
});

test.serial('broken connections are automatically pruned', async (t) => {
  const pool = createTestPool(1);

  const bustedConn = await pool.connect();
  bustedConn.query = function() {
    throw new Error('Artificially broken connection');
  };
  bustedConn.release();

  await SQL.connected(async (conn) => {
    t.not(conn, bustedConn);
  }, {pool});
});

test.serial('pool unable to produce a working connection', async (t) => {
  const bustedPool = createTestPool(1);

  const realConnect = bustedPool.connect;
  bustedPool.connect = async function () {
    const bustedConn = await realConnect.call(bustedPool);
    bustedConn.query = function() {
      throw new Error('Artificially broken connection');
    };
    return bustedConn;
  };

  await t.throwsAsync(SQL.connected(async () => {}, {pool: bustedPool}), {instanceOf: SQL.FailedToFindUsablePoolConnectionError});
});

test('connected requires a callback', async (t) => {
  await t.throwsAsync(SQL.connected(null, {pool}), {instanceOf: SQL.MissingRequiredArgError});
});

test('connected statement timeout', async (t) => {
  const shortTimeoutPool = createTestPool(1, {statement_timeout: 10});

  await t.throwsAsync(SQL.connected(async (conn) => {
    return conn.query('SELECT pg_sleep(20)');
  }, {pool: shortTimeoutPool}), {instanceOf: SQL.StatementTimeoutError});
});

test('connected query errors bubble', async (t) => {
  await t.throwsAsync(SQL.connected(async (conn) => {
    return conn.query('SELECT * FROM this_does_not_exist');
  }, {pool}), {instanceOf: PG.DatabaseError});
});

test('transaction requires a callback', async (t) => {
  await t.throwsAsync(SQL.transaction(null, {pool}), {instanceOf: SQL.MissingRequiredArgError});
});

test('transaction statement timeout', async (t) => {
  const shortTimeoutPool = createTestPool(1, {statement_timeout: 10});

  await t.throwsAsync(SQL.transaction(async (conn) => {
    return conn.query('SELECT pg_sleep(20)');
  }, {pool: shortTimeoutPool}), {instanceOf: SQL.StatementTimeoutError});
});

test('transaction query errors bubble', async (t) => {
  await t.throwsAsync(SQL.transaction(async (conn) => {
    return conn.query('SELECT * FROM this_does_not_exist');
  }, {pool}), {instanceOf: PG.DatabaseError});
});

test('nested transaction not allowed by default', async (t) => {
  await SQL.transaction(async conn => {
    await t.throwsAsync(SQL.transaction(async () => {}, {conn}), {instanceOf: SQL.ImplicitNestedTransactionError});
  }, {pool});
});

test('nested transaction allowed with flag', async (t) => {
  await SQL.transaction(async conn => {
    t.is(await SQL.transaction(async () => {
      return true;
    }, {conn, allowNested: true}), true);
  }, {pool});
});

test('connected autoDestroyConn', async (t) => {
  const pool = createTestPool(1);

  await SQL.connected(async (conn) => {
    conn._the_one = true;
  }, {pool, autoDestroyConn: true});

  await sleep(1);
  await SQL.connected(async (conn) => {
    t.true(conn._the_one === undefined);
  }, {pool});
});

test('transaction autoDestroyConn', async (t) => {
  const pool = createTestPool(1);

  await SQL.transaction(async (conn) => {
    conn._the_one = true;
  }, {pool, autoDestroyConn: true});

  await sleep(1);
  await SQL.connected(async (conn) => {
    t.true(conn._the_one === undefined);
  }, {pool});
});

test('query one-off', async (t) => {
  const pool = createTestPool(1);

  const result = await SQL.query('SELECT 5 foo', null, {pool});
  t.is(result.rows.length, 1);
  t.is(result.rows[0].foo, 5);
});
