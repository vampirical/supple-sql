'use strict';
const SQL = require('../src');
const {dropTables, createTestPool} = require('./_utils');
const test = require('ava');

// We want coverage for debug lines but without actually having to see them.
// Disable this if you need to manually debug=true something.
const DEBUG_COVERAGE = true;

if (DEBUG_COVERAGE) {
  console.debug = function() {};
}
console.warn = function() {};
console.error = function() {};

class QueryTestRecord extends SQL.Record {
  static fields = {
    id: {type: SQL.type.serial, primaryKey: true},
    email: {type: SQL.type.text, nullable: false},
    displayName: {type: SQL.type.text, nullable: false},
    aNumber: {type: SQL.type.integer},
    aFlag: {type: SQL.type.boolean},
    createdAt: {type: SQL.type.timestamptz, nullable: false, defaultValue: SQL.valueNow},
    optionalAt: {type: SQL.type.timestamptz},
  };
  static primaryKeyFields = ['id'];
  static table = 'supple_test_query_test_records';

  static debug = DEBUG_COVERAGE;
  debug = DEBUG_COVERAGE;
}

class QueryTestRecordWithDefaultsAndPrivates extends SQL.Record {
  static fields = {
    id: {type: SQL.type.serial, primaryKey: true},
    email: {type: SQL.type.text, nullable: false},
    displayName: {type: SQL.type.text, nullable: false},
    aNumber: {type: SQL.type.integer},
    aFlag: {type: SQL.type.boolean, defaultValue: true},
    createdAt: {type: SQL.type.timestamptz, nullable: false, defaultValue: SQL.valueNow},
    optionalAt: {type: SQL.type.timestamptz, defaultValue: new Date('2023-01-01T00:00:00')},
  };
  static primaryKeyFields = ['id'];
  static privateFields = ['aFlag'];
  static table = 'supple_test_query_test_records';

  static debug = DEBUG_COVERAGE;
  debug = DEBUG_COVERAGE;
}

const pool = createTestPool();

test.before(async () => {
  return SQL.connected(async (conn) => {
    await dropTables(conn, [QueryTestRecord.table]);

    await conn.query(`
      CREATE TABLE ${QueryTestRecord.table} (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        display_name TEXT NOT NULL,
        a_number INTEGER,
        a_flag BOOL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        optional_at TIMESTAMPTZ
      )
    `);

    const testRecords = [];
    const testData = [];
    for (let i = 0; i < 200; ++i) {
      testData.push({
        aNumber: [i],
        aFlag: [null, true, false],
        optionalAt: [null, SQL.valueNow],
      });
    }
    for (const [bI, c] of testData.entries()) {
      const flat = [];

      let maxI = 0;
      for (const v of Object.values(c)) {
        maxI = Math.max(maxI, v.length);
      }

      for (let i = 0; i < maxI; ++i) {
        const recordData = {};
        for (const [k, v] of Object.entries(c)) {
          const vI = Math.min(i, v.length - 1);
          recordData[k] = v[vI];
        }
        recordData.email = `query-test-${bI}-${i}@example.com`;
        recordData.displayName = `Display Name ${bI}, Variation ${i}`;
        flat.push(recordData);
      }

      Array.prototype.push.apply(testRecords, flat);
    }
    for (const recordData of testRecords) {
      const r = new QueryTestRecord(conn, recordData);
      await r.save();
    }
  }, {pool});
});

test('a record type is required', async (t) => {
  SQL.setDefaultPool(createTestPool());

  t.throws(() => new SQL.RecordQuery(), {instanceOf: SQL.RecordTypeRequiredError});

  SQL.setDefaultPool(null);
});

/*
top level all comparison types
top level subquery
nested subquery
*/

test('is null', async (t) => {
  const bQ = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aFlag: null})
    .run();
  const bResults = Array.from(bQ);
  t.is(bResults.length, 200);

  const tsQ = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({optionalAt: null})
    .run();
  const tsResults = Array.from(tsQ);
  t.is(tsResults.length, 200);

  const nQ = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: null})
    .run();
  const nResults = Array.from(nQ);
  t.is(nResults.length, 0);
});

test('is not null', async (t) => {
  const bQ = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aFlag: SQL.valueNotNull})
    .run();
  const bResults = Array.from(bQ);
  t.is(bResults.length, 400);

  const tsQ = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({optionalAt: SQL.valueNotNull})
    .run();
  const results = Array.from(tsQ);
  t.is(results.length, 400);

  const nQ = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: SQL.valueNotNull})
    .run();
  const nResults = Array.from(nQ);
  t.is(nResults.length, 600);
});

test('is true', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aFlag: true})
    .run();

  const results = Array.from(q);
  t.is(results.length, 200);
});

test('is false', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aFlag: false})
    .run();

  const results = Array.from(q);
  t.is(results.length, 200);
});

test('number equals', async (t) => {
  const q = new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: 0});
  await q.run();

  const results = Array.from(q);
  t.is(results.length, 3);
  t.like(results, [
    {
      email: 'query-test-0-0@example.com',
      displayName: 'Display Name 0, Variation 0',
      aNumber: 0,
      optionalAt: null
    }
  ]);
});

test('number in, implied', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: [0, 1]})
    .run();

  const results = Array.from(q);
  t.is(results.length, 6);
  t.like(results, [
    {
      email: 'query-test-0-0@example.com',
      displayName: 'Display Name 0, Variation 0',
      aNumber: 0,
      optionalAt: null
    },
    {
      email: 'query-test-0-1@example.com',
      displayName: 'Display Name 0, Variation 1',
      aNumber: 0,
    },
  ]);
});

test('number in, explicit', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: SQL.in([0, 1])})
    .run();

  const results = Array.from(q);
  t.is(results.length, 6);
  t.like(results, [
    {
      email: 'query-test-0-0@example.com',
      displayName: 'Display Name 0, Variation 0',
      aNumber: 0,
      optionalAt: null
    },
    {
      email: 'query-test-0-1@example.com',
      displayName: 'Display Name 0, Variation 1',
      aNumber: 0,
    },
  ]);
});

test('connectives work as base where and as values', async (t) => {
  const orAsValue = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({
      id: SQL.or(
        SQL.all(QueryTestRecord.query({id: 1}, {returns: 'id'})),
        SQL.like('%5'),
      )
    });
  // orAsValue.debug = true;
  await orAsValue.run();
  const orAsValueResults = orAsValue.data();
  t.is(orAsValueResults.length, 61);
  for (const result of orAsValueResults) {
    t.true(result.id === 1 || result.id % 5 === 0);
  }

  const orTopLevel = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where(SQL.or(
      {id: SQL.all(QueryTestRecord.query({id: 1}, {returns: 'id'}))},
      {id: SQL.like('%5')},
    ));
  // orTopLevel.debug = true;
  await orTopLevel.run();
  t.deepEqual(orTopLevel.data(), orAsValueResults);
});

test('connectives support nested connectives', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where(SQL.or(
      SQL.and({id: SQL.all(QueryTestRecord.query({id: 1}, {returns: 'id'})), aNumber: 0}, {id: 1}),
      {id: SQL.like('%5')},
    ));
  // q.debug = true;
  await q.run();
  const results = q.data();
  t.is(results.length, 61);
  for (const result of results) {
    t.true(result.id === 1 || result.id % 5 === 0);
  }
});

test('connectives as values support nested connectives', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({
      id: SQL.or(
        SQL.and(SQL.all(QueryTestRecord.query({id: 1}, {returns: 'id'})), SQL.equal(1)),
        SQL.like('%5'),
      )
    });
  // q.debug = true;
  await q.run();
  const results = q.data();
  t.is(results.length, 61);
  for (const result of results) {
    t.true(result.id === 1 || result.id % 5 === 0);
  }
});

// test('TODO NICE TO HAVE connective values throw a workable error if you try to nest a field object', async (t) => {});

// TODO TEST Remaining comparisons to do like the test above
// SQL.any(),
// SQL.distinctFrom(),
// SQL.equal(),
// SQL.exists(),
// SQL.greater(),
// SQL.greaterEqual(),
// SQL.ilike(),
// SQL.in(),
// SQL.iregex(),
// SQL.less(),
// SQL.lessEqual(),
// SQL.notAll(),
// SQL.notAny(),
// SQL.notDistinctFrom(),
// SQL.notEqual(),
// SQL.notExists(),
// SQL.notIlike(),
// SQL.notIn(),
// SQL.notIregex(),
// SQL.notLike(),
// SQL.notRegex(),
// SQL.notSimilarTo(),
// SQL.notUnknown(),
// SQL.regex(),
// SQL.similarTo(),
// SQL.unknown()

// TODO TEST Think of input and output values which are able to distinguish between whether =/IN/ANY/ALL/EXISTS was used
//  versus the others for as many of these rhs scenarios as are applicable: single value, multiple values, subquery.

test('object and', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aFlag: null, optionalAt: null})
    .run();

  const results = Array.from(q);
  t.is(results.length, 200);
});

test('and explicit', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where(SQL.and({aFlag: true}, {optionalAt: SQL.valueNotNull}))
    .run();

  const results = Array.from(q);
  t.is(results.length, 200);
});

test('and array', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where([{aFlag: true}, {optionalAt: SQL.valueNotNull}])
    .run();

  const results = Array.from(q);
  t.is(results.length, 200);
});

test('nested connectives', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where(SQL.or(SQL.and({aNumber: 100}, {aFlag: true}), SQL.or({aNumber: 101, aFlag: false}, {aNumber: 102})))
    .run();

  const results = Array.from(q);
  t.is(results.length, 5);
});

test('nested array and', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where(SQL.or([{aNumber: 100}, {aFlag: true}], SQL.or({aNumber: 101, aFlag: false}, {aNumber: 102})))
    .run();

  const results = Array.from(q);
  t.is(results.length, 5);
});

test('invalid field', async (t) => {
  await t.throwsAsync(new SQL.RecordQuery(pool, QueryTestRecord).where({invalidFieldKey: null}).run(), {instanceOf: SQL.FieldNotFoundError});
});

test('undefined is skipped', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where(SQL.and({aFlag: true}, {aFlag: undefined}))
    .run();

  const results = Array.from(q);
  t.is(results.length, 200);
});

test('getSql() implementor', async (t) => {
  const aNumber = 100;

  class CustomGetSql extends Object {
    getSql() {
      return {
        query: `SELECT id FROM ${QueryTestRecord.table} WHERE a_number = ${aNumber}`,
        values: []
      };
    }
  }
  const customGetSqlInstance = new CustomGetSql();

  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({id: customGetSqlInstance})
    .run();

  const results = Array.from(q);
  t.is(results.length, 3);
  t.is(results[0].aNumber, aNumber);
  t.is(results[1].aNumber, aNumber);
});

test('valueNow is handled', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({optionalAt: SQL.valueNow})
    .run();

  const results = Array.from(q);
  t.is(results.length, 0);
});

test('empty in is handled', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: []})
    .run();

  const results = Array.from(q);
  t.is(results.length, 0);
});

test('Set as value', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: new Set([100, 101])})
    .run();

  const results = Array.from(q);
  t.is(results.length, 6);
});

test('Set as SqlValue', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: SQL.in(new Set([100, 101]))})
    .run();

  const results = Array.from(q);
  t.is(results.length, 6);
});

test('output type object', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object})
    .where({aNumber: [100, 101]})
    .run();

  const results = Array.from(q);
  t.is(results.length, 6);
  t.true(!(results[0] instanceof SQL.Record));
});

test('returns single value', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {returns: 'aNumber'})
    .where({aNumber: 100})
    .run();

  const results = Array.from(q);
  t.is(results.length, 3);
  for (const result of results) {
    t.is(result, 100);
  }
});

test('returns single value accepts compatible output option', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {returns: 'aNumber', output: SQL.outputType.value})
    .where({aNumber: 100})
    .run();

  const results = Array.from(q);
  t.is(results.length, 3);
  for (const result of results) {
    t.is(result, 100);
  }
});

test('returns single value rejects incompatible output option', async (t) => {
  t.throws(() => new SQL.RecordQuery(pool, QueryTestRecord, {returns: 'aNumber', output: SQL.outputType.object}), {instanceOf: SQL.IncompatibleOutputSpecifiedError});
});

test('returns multiple values', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {returns: ['id', 'aNumber']})
    .where({aNumber: 100})
    .run();

  const results = Array.from(q);
  t.is(results.length, 3);
  t.truthy(results[0].id);
  t.is(results[0].aNumber, 100);
});

test('returns multiple values supports Sets', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {returns: new Set(['id', 'aNumber'])})
    .where({aNumber: 100})
    .run();

  const results = Array.from(q);
  t.is(results.length, 3);
  t.truthy(results[0].id);
  t.is(results[0].aNumber, 100);
});

test('returns multiple value accepts compatible output option', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {returns: ['id', 'aNumber'], output: SQL.outputType.object})
    .where({aNumber: 100})
    .run();

  const results = Array.from(q);
  t.is(results.length, 3);
  t.truthy(results[0].id);
  t.is(results[0].aNumber, 100);
});

test('returns multiple values rejects incompatible output option', async (t) => {
  t.throws(() => new SQL.RecordQuery(pool, QueryTestRecord, {returns: ['id', 'aNumber'], output: SQL.outputType.record}), {instanceOf: SQL.IncompatibleOutputSpecifiedError});
});

test('output handles invalid', async (t) => {
  t.throws(() => new SQL.RecordQuery(pool, QueryTestRecord, {output: 'invalid'}), {instanceOf: SQL.InvalidOutputTypeError});
});

test('count', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aFlag: false});

  const results = Array.from(await q.run());
  t.is(results.length, 200);

  const count = await q.count();

  t.is(count, 200);
});

test('setConnection() release the old connection by default', async (t) => {
  const pool = createTestPool(2);

  const conn1 = await pool.connect();
  const conn2 = await pool.connect();

  const q = await new SQL.RecordQuery(conn1, QueryTestRecord);
  q.setConnection(conn2);

  const conn3 = await pool.connect();

  t.is(conn3, conn1);
});

test('setConnection() can skip releasing the old connection', async (t) => {
  const pool = createTestPool(2, {connectionTimeoutMillis: 500});

  const conn1 = await pool.connect();
  const conn2 = await pool.connect();

  const q = await new SQL.RecordQuery(conn1, QueryTestRecord);
  q.setConnection(conn2, false);

  await t.throwsAsync(pool.connect());
});

test('invalid orderBy throws', async (t) => {
  const q = new SQL.RecordQuery(pool, QueryTestRecord);
  q.orderBy('invalidField');
  await t.throwsAsync(q.run(), {instanceOf: SQL.FieldNotFoundError});
});

test('returns is not supported with stream', async (t) => {
  const q = new SQL.RecordQuery(pool, QueryTestRecord, {returns: 'id', stream: true});
  await t.throwsAsync(q.run(), {instanceOf: SQL.UnavailableInStreamModeError});
});

test('output other than record is not supported with stream', async (t) => {
  const q = new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object, stream: true});
  await t.throwsAsync(q.run(), {instanceOf: SQL.UnavailableInStreamModeError});
});

test('non-async iteration of stream throws UnavailableInStreamModeError', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {stream: true})
    .where({aNumber: 100});

  await t.throwsAsync(async () => {
    // eslint-disable-next-line no-unused-vars
    for (const row of q) {
      // Nothing to do.
    }
  }, {instanceOf: SQL.UnavailableInStreamModeError});
});

test('iterating before run throws QueryNotLoadedIterationError', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: 100});

  t.throws(() => {
    // eslint-disable-next-line no-unused-vars
    for (const row of q) {
      // Nothing to do.
    }
  }, {instanceOf: SQL.QueryNotLoadedIterationError});
});

test('iterating before run throws AsyncIterationUnavailableError', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: 100});

  await t.throwsAsync(async () => {
    // eslint-disable-next-line no-unused-vars
    for await (const row of q) {
      // Nothing to do.
    }
  }, {instanceOf: SQL.AsyncIterationUnavailableError});
});

test('array functions are available', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: 100})
    .run();

  const entries = Array.from(q.entries());
  t.is(entries.length, 3);
  t.is(entries[0][0], 0);
  t.is(entries[0][1].aNumber, 100);
});

test('array functions in stream mode throw UnavailableInStreamModeError', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {stream: true})
    .where({aNumber: 100})
    .run();

  t.throws(() => q.entries(), {instanceOf: SQL.UnavailableInStreamModeError});
});

test('data() defaults', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord)
    .where({aNumber: 100})
    .run();

  const results = Array.from(q);
  t.is(results.length, 3);
  const data = q.data();
  t.deepEqual(results.map(r => r.data()), data);
});

test('data() output object', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object})
    .where({aNumber: 100})
    .run();

  const results = Array.from(q);
  t.is(results.length, 3);
  t.false(results[0] instanceof SQL.Record);
  const data = q.data();
  t.deepEqual(results, data);
});

test('data() output object with filtering', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object})
    .where({aNumber: 100})
    .run();

  const results = Array.from(q);
  t.is(results.length, 3);
  t.false(results[0] instanceof SQL.Record);
  const data = q.data({fields: ['aNumber']});
  t.is(data[0].aNumber, 100);
  t.is(data[0].id, undefined);
  t.is(Array.from(Object.keys(data[0])).length, 1);
});

test('data() output object including defaults', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecordWithDefaultsAndPrivates, {output: SQL.outputType.object})
    .where({optionalAt: null})
    .limit(1)
    .run();

  const data = q.data({includeDefaults: true});
  t.is(data[0].optionalAt, QueryTestRecordWithDefaultsAndPrivates.fields.optionalAt.defaultValue);
});

test('data() output object including private', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecordWithDefaultsAndPrivates, {output: SQL.outputType.object})
    .where({aNumber: 100, aFlag: true})
    .run();

  const data = q.data();
  t.is(data[0].aFlag, undefined);

  const pData = q.data({includePrivate: true});
  t.is(pData[0].aFlag, true);
});

test('data() output value defaulted', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecordWithDefaultsAndPrivates, {returns: 'optionalAt'})
    .where({optionalAt: null})
    .limit(1)
    .run();

  const data = q.data();
  t.is(data.length, 1);
  t.is(data[0], null);

  const dData = q.data({includeDefaults: true});
  t.is(dData.length, 1);
  t.is(dData[0], QueryTestRecordWithDefaultsAndPrivates.fields.optionalAt.defaultValue);
});

test('data() output value handles private', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecordWithDefaultsAndPrivates, {returns: 'aFlag'})
    .where({aNumber: 100, aFlag: true})
    .run();

  const data = q.data();
  t.is(data.length, 1);
  t.is(data[0], null);

  const dData = q.data({includePrivate: true});
  t.is(dData.length, 1);
  t.is(dData[0], true);
});

test('data() is not allowed with stream=true', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {stream: true})
    .where({aNumber: 100})
    .run();

  t.throws(() => q.data(), {instanceOf: SQL.UnavailableInStreamModeError});
});

test('data() fields not allowed for outputType.value', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.value})
    .where({aNumber: 100})
    .run();

  t.throws(() => q.data({fields: ['id']}), {instanceOf: SQL.InvalidOptionCombinationError});
});

test('data() onlyDirty and onlySet are only supported for outputType.record', async (t) => {
  const vdQ = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.value})
    .where({aNumber: 100})
    .run();
  t.throws(() => vdQ.data({onlyDirty: true}), {instanceOf: SQL.InvalidOptionCombinationError});

  const odQ = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object})
    .where({aNumber: 100})
    .run();
  t.throws(() => odQ.data({onlyDirty: true}), {instanceOf: SQL.InvalidOptionCombinationError});

  const vsQ = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.value})
    .where({aNumber: 100})
    .run();
  t.throws(() => vsQ.data({onlySet: true}), {instanceOf: SQL.InvalidOptionCombinationError});

  const osQ = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object})
    .where({aNumber: 100})
    .run();
  t.throws(() => osQ.data({onlySet: true}), {instanceOf: SQL.InvalidOptionCombinationError});
});

test('record type is required', async (t) => {
  t.throws(() => new SQL.RecordQuery(pool), {instanceOf: SQL.RecordTypeRequiredError});

  class DoesQuackCorrectly extends Object {
    static table = 'supple_test_record_like_but_not_enough';
  }

  t.throws(() => new SQL.RecordQuery(pool, DoesQuackCorrectly), {instanceOf: SQL.RecordTypeRequiredError});
});

test('order by with default direction', async(t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object})
    .where({aNumber: 100, aFlag: SQL.valueNotNull})
    .orderBy('aFlag')
    .run();

  t.is(q.rows[0].aFlag, false);
  t.is(q.rows[1].aFlag, true);
});

test('order by with explicit direction', async(t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object})
    .where({aNumber: 100, aFlag: SQL.valueNotNull})
    .orderBy(['aFlag', SQL.sort.desc])
    .run();

  t.is(q.rows[0].aFlag, true);
  t.is(q.rows[1].aFlag, false);
});

test('order by multiple flat', async(t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object})
    .where({aNumber: [100, 101], aFlag: SQL.valueNotNull})
    .orderBy(['aNumber', SQL.sort.desc], ['aFlag', SQL.sort.desc])
    .run();

  t.is(q.rows[0].aNumber, 101);
  t.is(q.rows[1].aNumber, 101);
  t.is(q.rows[2].aNumber, 100);
  t.is(q.rows[3].aNumber, 100);
  t.is(q.rows[0].aFlag, true);
  t.is(q.rows[1].aFlag, false);
});

test('changing criteria marks as unloaded', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object})
    .where({aNumber: 100})
    .run();
  t.is(q.isLoaded, true);

  q.limit(null);
  t.is(q.isLoaded, true);
  q.limit(1);
  t.is(q.isLoaded, false);
  await q.run();
  q.limit(1);
  t.is(q.isLoaded, true);
  q.limit(null);
  t.is(q.isLoaded, false);
  await q.run();

  q.offset(null);
  t.is(q.isLoaded, true);
  q.offset(1);
  t.is(q.isLoaded, false);
  await q.run();
  q.offset(1);
  t.is(q.isLoaded, true);
  q.offset(null);
  t.is(q.isLoaded, false);
  await q.run();

  q.orderBy(['aFlag', SQL.sort.desc]);
  t.is(q.isLoaded, false);
  await q.run();
  t.is(q.isLoaded, true);

  q.where({aFlag: true});
  t.is(q.isLoaded, false);
  await q.run();
  t.is(q.isLoaded, true);
});

test('subquery without limit or offset skips order by', async (t) => {
  const q = await new SQL.RecordQuery(pool, QueryTestRecord, {output: SQL.outputType.object})
    .where({aNumber: 100})
    .orderBy(['aFlag', SQL.sort.desc])
    .limit(1)
    .run();

  const conn = await pool.connect();

  const {query: queryWithOrderBy} = q.getSql(conn, {isSubquery: true});
  t.true(queryWithOrderBy.includes('ORDER BY'));

  q.limit(null);
  const {query: queryWithoutOrderBy} = q.getSql(conn, {isSubquery: true});
  t.false(queryWithoutOrderBy.includes('ORDER BY'));
});
