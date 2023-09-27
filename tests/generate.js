'use strict';
const SQL = require('../src');
const {createTestPool, dropTables} = require('./_utils');
const test = require('ava');

class GenerateTest extends SQL.Record {
  static fields = {
    id: {type: SQL.type.serial},
    key: {type: SQL.type.text, nullable: false},
    value: {type: SQL.type.text, name: 'VaLuE'},
    defaultedInt: {type: SQL.type.integer, nullable: false, defaultValue: 42},
    defaultedText: {type: SQL.type.text, nullable: false, defaultValue: 'forty-two'},
    createdAt: {type: SQL.type.timestamptz, nullable: false, defaultValue: SQL.valueNow},
    updatedAt: {type: SQL.type.timestamptz, nullable: false, defaultValue: SQL.valueNow},
    deletedAt: {type: SQL.type.timestamptz},
  };
  static primaryKeyFields = ['id', 'key'];
  static table = 'supple_test_generate_test';
}

const expectedGenerated = {
  content:
    'class SuppleTestGenerateTest extends SQL.Record {\n' +
    '  static fields = {\n' +
    '    id: {type: SQL.type.integer, nullable: false},\n' +
    '    key: {type: SQL.type.text, nullable: false},\n' +
    '    defaultedInt: {type: SQL.type.integer, nullable: false, defaultValue: 42},\n' +
    '    value: {type: SQL.type.text},\n' +
    '    defaultedText: {type: SQL.type.text, nullable: false, defaultValue: \'forty-two\'},\n' +
    '    createdAt: {type: SQL.type.timestamptz, name: \'createdAt\', nullable: false, defaultValue: SQL.valueNow},\n' +
    '    updatedAt: {type: SQL.type.timestamptz, nullable: false, defaultValue: SQL.valueNow},\n' +
    '    deletedAt: {type: SQL.type.timestamptz}\n' +
    '  };\n' +
    '  static primaryKeyFields = [\'id\', \'key\'];\n' +
    '  static table = \'supple_test_generate_test\';\n' +
    '}',
  filename: 'SuppleTestGenerateTest.js'
};

const pool = createTestPool();

test.before(async () => {
  return SQL.connected(async (conn) => {
    await dropTables(conn, [GenerateTest.table]);

    await conn.query(`
      CREATE TABLE ${GenerateTest.table} (
        defaulted_int INTEGER NOT NULL DEFAULT 42,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        key TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        value TEXT,
        deleted_at TIMESTAMPTZ,
        id SERIAL,
        defaulted_text TEXT NOT NULL DEFAULT 'forty-two',
        PRIMARY KEY (id, key)
      )
    `);
  }, {pool});
});

test('table name is required', async (t) => {
  await t.throwsAsync(SQL.generateRecord(pool), {instanceOf: SQL.MissingRequiredArgError});
});

test('the black box looks good', async (t) => {
  const explicitPool = await SQL.generateRecord(pool, GenerateTest.table);
  t.deepEqual(explicitPool, expectedGenerated);

  SQL.setDefaultPool(pool);
  const defaultPool = await SQL.generateRecord(GenerateTest.table);
  t.deepEqual(defaultPool, expectedGenerated);
  SQL.setDefaultPool(null);
});
