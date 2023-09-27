'use strict';
const SQL = require('../src');
const {createTestPool} = require('./_utils');
const test = require('ava');

class DummyRecord extends SQL.Record {}

test('requires a record type', async (t) => {
  t.throws(() => new SQL.RecordTransform(), {instanceOf: SQL.RecordTypeRequiredError});
});

test('requires a conn or pool', async (t) => {
  t.throws(() => new SQL.RecordTransform({recordType: DummyRecord}), {instanceOf: SQL.MissingRequiredArgError});
});

test('accepts a conn', async (t) => {
  const pool = createTestPool();
  const conn = await pool.connect();

  t.notThrows(() => new SQL.RecordTransform({recordType: DummyRecord, conn}));
});

test('accepts a pool', async (t) => {
  t.notThrows(() => new SQL.RecordTransform({recordType: DummyRecord, pool: createTestPool()}));
});
