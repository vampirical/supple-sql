'use strict';
const SQL = require('../src');
const {getFieldDbName} = require('../src/utils/misc');
const {dropTables, createTestPool} = require('./_utils');
const test = require('ava');

// We want coverage for debug lines but without actually having to see them.
// Disable this if you need to manually debug=true something.
const DEBUG_COVERAGE = true;

if (DEBUG_COVERAGE) {
  console.debug = function() {};
}
console.info = function () {};
console.warn = function () {};
console.error = function () {};

const pool = createTestPool();

class UserWithoutDefaults extends SQL.Record {
  static fields = {
    id: {type: SQL.type.serial, primaryKey: true},
    email: {type: SQL.type.text, nullable: false, unique: true},
    displayName: {type: SQL.type.text, nullable: false, name: 'custom_db_name_display_name'},
    password: {type: SQL.type.text},
    createdAt: {type: SQL.type.timestamptz, nullable: false},
    optionalAt: {type: SQL.type.timestamptz},
  };
  static primaryKeyFields = ['id'];
  static privateFields = ['password'];
  static table = 'supple_test_users';

  debug = DEBUG_COVERAGE;
}

class User extends SQL.Record {
  static fields = {
    ...UserWithoutDefaults.fields,
    displayName: {...UserWithoutDefaults.fields.displayName, defaultValue: 'A Test User'},
    createdAt: {type: SQL.type.timestamptz, nullable: false, defaultValue: SQL.valueNow},
  };
  static primaryKeyFields = ['id'];
  static privateFields = ['password'];
  static table = 'supple_test_users';

  debug = DEBUG_COVERAGE;
}

class Mark extends SQL.Record {
  static fields = {
    id: {type: SQL.type.serial, primaryKey: true},
    createdAt: {type: SQL.type.timestamptz, nullable: false, defaultValue: SQL.valueNow},
  };
  static primaryKeyFields = ['id'];
  static table = 'supple_test_marks';

  debug = DEBUG_COVERAGE;
}

class Keyed extends SQL.Record {
  static fields = {
    key: {type: SQL.type.text, primaryKey: true}
  };
  static primaryKeyFields = ['key'];
  static table = 'supple_test_keyed';

  debug = DEBUG_COVERAGE;
}

class AllInts extends SQL.Record {
  static fields = {
    id: {type: SQL.type.integer, primaryKey: true},
    value: {type: SQL.type.integer},
  };
  static primaryKeyFields = ['id'];
  static table = 'supple_test_all_ints';

  debug = DEBUG_COVERAGE;
}

class MultiColumnKey extends SQL.Record {
  static fields = {
    key1: {type: SQL.type.text},
    key2: {type: SQL.type.text},
  };
  static primaryKeyFields = ['key1', 'key2'];
  static table = 'supple_test_multi_column_keys';

  debug = DEBUG_COVERAGE;
}

class Interval extends SQL.Record {
  static fields = {
    key: {type: SQL.type.interval},
  };
  static primaryKeyFields = ['key'];
  static table = 'supple_test_intervals';

  debug = DEBUG_COVERAGE;
}

test.before(async () => {
  return SQL.connected(async (conn) => {
    await dropTables(conn, [
      User.table,
      Mark.table,
      Keyed.table,
      AllInts.table,
      MultiColumnKey.table,
      Interval.table,
    ]);

    await conn.query(`
      CREATE TABLE ${User.table} (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        custom_db_name_display_name TEXT NOT NULL DEFAULT 'A Test User',
        password TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        optional_at TIMESTAMPTZ,
        UNIQUE (email)
      )
    `);

    await conn.query(`
      CREATE TABLE ${Mark.table} (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await conn.query(`
      CREATE TABLE ${Keyed.table} (
        key TEXT PRIMARY KEY
      )
    `);

    await conn.query(`
      CREATE TABLE ${AllInts.table} (
        id INTEGER PRIMARY KEY,
        value INTEGER
      )
    `);

    await conn.query(`
      CREATE TABLE ${MultiColumnKey.table} (
        key1 TEXT,
        key2 TEXT,
        PRIMARY KEY (key1, key2)
      )
    `);

    await conn.query(`
      CREATE TABLE ${Interval.table} (
        key INTERVAL PRIMARY KEY
      )
    `);
  }, {pool});
});

async function createUser(data) {
  const user = new User(pool);
  for (const [key, value] of Object.entries(data)) {
    user[key] = value;
  }
  await user.save();

  return user;
}

test('inserts', async (t) => {
  const source = {
    email: 'record-insert@example.com',
    displayName: 'Record Inserts',
    password: 'a very secure password',
  };
  const user = await createUser(source);

  for (const [key, value] of Object.entries(source)) {
    t.is(user[key], value);
  }
  t.truthy(user.id);
  t.truthy(user.createdAt);

  await SQL.connected(async conn => {
    const res = await conn.query({text: `SELECT id, email, custom_db_name_display_name "displayName", password, created_at "createdAt", optional_at "optionalAt" FROM ${User.table} WHERE email = $1`, values: [source.email]});
    t.is(res.rows.length, 1);
    t.deepEqual(user.data({includePrivate: true}), res.rows[0]);
  }, {pool});
});

test('loads', async (t) => {
  const source = {
    email: 'record-loads@example.com',
    displayName: 'Record Loads',
    password: 'a very secure password',
  };
  await createUser(source);

  const loadedUser = new User(pool);
  loadedUser.email = source.email;
  t.true(await loadedUser.load());

  t.true(loadedUser.isLoaded);

  for (const [key, value] of Object.entries(source)) {
    t.is(loadedUser[key], value);
  }
  t.truthy(loadedUser.id);
  t.truthy(loadedUser.createdAt);
});

test('updates', async (t) => {
  const source = {
    email: 'record-update@example.com',
    displayName: 'Record Updates - Not Updated',
    password: 'a very secure password',
  };
  const user = await createUser(source);

  const newDisplayName = 'Record Updates - Updated';

  user.displayName = 'Record Updates - Updated';
  await user.save();

  t.is(user.displayName, newDisplayName);

  await SQL.connected(async conn => {
    const res = await conn.query({text: `SELECT id, email, custom_db_name_display_name "displayName", password, created_at "createdAt", optional_at "optionalAt" FROM ${User.table} WHERE email = $1`, values: [source.email]});
    t.is(res.rows.length, 1);
    t.deepEqual(user.data({includePrivate: true}), res.rows[0]);
  }, {pool});
});

test('deletes', async (t) => {
  const source = {
    email: 'record-delete@example.com',
    displayName: 'Record Deletes',
    password: 'a very secure password',
  };
  const user = await createUser(source);

  await user.delete();

  await SQL.connected(async conn => {
    const res = await conn.query({text: `SELECT 1 FROM ${User.table} WHERE email = $1`, values: [source.email]});
    t.is(0, res.rows.length);
  }, {pool});
});

test('load handles no rows', async (t) => {
  const source = {
    email: 'record-load-handles-no-rows@example.com',
    displayName: 'Record Load Handles No Rows',
    password: 'a very secure password',
  };
  await createUser(source);

  const missingEmail = 'something which does not match';

  const loadedUser = new User(pool);
  loadedUser.email = missingEmail;
  await loadedUser.load();

  t.false(loadedUser.isLoaded);
  t.is(loadedUser.email, missingEmail);
  t.falsy(loadedUser.id);
});

test('load fails on multiple matches', async (t) => {
  const source1 = {
    email: 'record-load-fails-on-multiple-matches1@example.com',
    displayName: 'Record Load Fails On Multiple Matches',
    password: 'a very secure password',
  };
  await createUser(source1);
  const source2 = {
    email: 'record-load-fails-on-multiple-matches2@example.com',
    displayName: 'Record Load Fails On Multiple Matches',
    password: 'a very secure password',
  };
  await createUser(source2);

  const loadedUser = new User(pool);
  loadedUser.displayName = source1.displayName;

  await loadedUser.load();

  t.false(loadedUser.isLoaded);
  t.is(loadedUser.warnings?.length, 1);
});

test('insert can handle a defaults only insert', async (t) => {
  const mark = new Mark(pool);
  const saveResult = await mark.save();

  t.true(saveResult);
  t.truthy(mark.id);
  t.truthy(mark.createdAt);
});

test('update is lazy', async (t) => {
  const source = {
    email: 'record-update-is-lazy@example.com',
    displayName: 'Record Update Is Lazy',
    password: 'a very secure password',
  };
  const user = await createUser(source);

  t.false(await user.save());

  user.email = source.email;
  t.false(await user.save());
});

test('save can ignore conflicts', async (t) => {
  const source = {
    email: 'record-save-can-ignore-conflicts@example.com',
    displayName: 'Record Save Can Ignore Conflicts',
    password: 'a very secure password',
  };

  await createUser(source);

  const dupInsert = new User(pool);
  for (const [key, value] of Object.entries(source)) {
    dupInsert[key] = value;
  }
  await t.throwsAsync(dupInsert.save(false, true), {instanceOf: SQL.InvalidOptionCombinationError});
  t.true(await dupInsert.save(true, true));
});

test('delete fails if no primary key', async (t) => {
  const keyed = new Keyed(pool);
  await t.throwsAsync(keyed.delete(), {instanceOf: SQL.PrimaryKeyValueMissingError});
});

test('handles bound SqlValue', async (t) => {
  const email = 'record-handles-bound-sql-value@example.com';
  const displayName = 'Record Handles Bound SqlValue';
  const source = {
    email: new SQL.Value(email, {bind: true}),
    displayName: new SQL.Value(displayName, {bind: true})
  };

  const user = await createUser(source);

  t.like(user.data(), {email, displayName});

  const loaded = new User(pool);
  loaded.email = source.email;
  t.true(await loaded.load());

  t.like(loaded.data(), user.data());
});

test('handles quoted SqlValue', async (t) => {
  const email = 'record-handles-quoted-sql-value@example.com';
  const displayName = 'Record Handles Quoted SqlValue';
  const source = {
    email: new SQL.Value(email, {quote: true}),
    displayName: new SQL.Value(displayName, {quote: true})
  };

  const user = await createUser(source);

  t.like(user.data(), {email, displayName});

  const loaded = new User(pool);
  loaded.email = source.email;
  t.true(await loaded.load());

  t.like(loaded.data(), user.data());
});

test('handles unquoted SqlValue', async (t) => {
  const id = 123;
  const value = 456;
  const source = {
    id: new SQL.Value(id),
    value: new SQL.Value(value)
  };

  const allInts = new AllInts(pool);
  for (const [key, value] of Object.entries(source)) {
    allInts[key] = value;
  }
  await allInts.save();

  t.like(allInts.data(), {id, value});

  const loaded = new AllInts(pool);
  loaded.id = source.id;
  t.true(await loaded.load());

  t.like(loaded.data(), allInts.data());
});

test('load and saves handles bound SqlValue', async (t) => {
  const boundDate = new SQL.Value(new Date(), {bind: true});

  const notYet = await User.findOne(pool, {optionalAt: boundDate});
  t.is(notYet, null);

  const source = {
    email: 'user-with-bound-date-optional-at@example.com',
    displayName: 'User with Bound Date Optional At',
    optionalAt: boundDate,
  };
  await createUser(source);

  const nowItExists = await User.findOne(pool, {optionalAt: boundDate});
  t.truthy(nowItExists);
  t.is(nowItExists.email, source.email);
  t.is(nowItExists.displayName, source.displayName);
});

test('load and saves handles unquoted SqlValue with raw SQL', async (t) => {
  const fancyTimestamp = new SQL.Value(`${SQL.quoteLiteral(new Date().toISOString())}::timestamptz + '1 month'::interval`);

  const notYet = await User.findOne(pool, {optionalAt: fancyTimestamp});
  t.is(notYet, null);

  const source = {
    email: 'user-with-fancy-optional-at@example.com',
    displayName: 'User with Fancy Optional At',
    optionalAt: fancyTimestamp,
  };
  await createUser(source);

  const nowItExists = await User.findOne(pool, {optionalAt: fancyTimestamp});
  t.truthy(nowItExists);
  t.is(nowItExists.email, source.email);
  t.is(nowItExists.displayName, source.displayName);
});

test('data() defaults and options', async (t) => {
  const source = {
    email: 'record-data-hides-private@example.com',
    displayName: 'Record Data Hides Private',
    password: 'a very secure password',
  };
  const user = await createUser(source);

  // Defaults

  const data = {...user.data()};
  delete data.id;
  delete data.createdAt;

  const visible = {...source};
  delete visible.password;

  t.like(data, visible);

  const flagCheckUser = new User(pool);

  // includeDefaults = true
  const defaultedData = flagCheckUser.data({includeDefaults: true});
  t.is(defaultedData.displayName, 'A Test User');

  // onlyDirty = true
  t.deepEqual(flagCheckUser.data({onlyDirty: true}), {});
  user.email = 'a-dirty-changed-email@example.com';
  t.deepEqual(user.data({onlyDirty: true}), {email: user.email});
  flagCheckUser.email = 'a-dirty-email@example.com';
  t.deepEqual(flagCheckUser.data({onlyDirty: true}), {email: flagCheckUser.email});

  // onlySet = true
  t.deepEqual(flagCheckUser.data({onlySet: true}), {email: flagCheckUser.email});
});

test('handles now()', async (t) => {
  const source = {
    email: 'record-handles-now@example.com',
    displayName: 'Record Handles Now',
    password: 'a very secure password',
    createdAt: SQL.valueNow,
    optionalAt: SQL.valueNow,
  };
  const beforeCreate = new Date();
  const user = await createUser(source);
  const afterCreate = new Date();

  t.truthy(user.createdAt);
  t.true(user.createdAt >= beforeCreate);
  t.true(user.createdAt <= afterCreate);

  t.truthy(user.optionalAt);
  t.true(user.optionalAt >= beforeCreate);
  t.true(user.optionalAt <= afterCreate);
});

// Static

test('findByPk', async (t) => {
  const source = {
    email: 'record-find-by-pk@example.com',
    displayName: 'Record Find By PK',
  };
  const user = await createUser(source);

  const loadedUser = await User.findByPk(pool, user.id);
  t.true(loadedUser?.isLoaded);

  for (const [key, value] of Object.entries(source)) {
    t.is(loadedUser[key], value);
  }
  t.truthy(loadedUser.id);
  t.truthy(loadedUser.createdAt);

  const nullResponse = await User.findByPk(pool, 999999998);
  t.true(nullResponse === null);
});

test('findByPk, multi-column', async (t) => {
  const source = {
    key1: 'a',
    key2: 'b',
  };
  const record = new MultiColumnKey(pool, source);
  await record.save();

  const loaded = await MultiColumnKey.findByPk(pool, source);
  t.true(loaded?.isLoaded);

  await t.throwsAsync(MultiColumnKey.findByPk(pool, 'a'), {instanceOf: SQL.IncorrectFieldsError});
});

test('deleteByPk', async (t) => {
  const source = {
    email: 'record-delete-by-pk@example.com',
    displayName: 'Record Delete By PK',
  };
  const user = await createUser(source);

  t.true(await User.deleteByPk(pool, user.id));
  t.false(await User.deleteByPk(pool, user.id));
});

test('deleteByPk, multi-column', async (t) => {
  const source = {
    key1: 'c',
    key2: 'd',
  };
  const record = new MultiColumnKey(pool, source);
  await record.save();

  await t.throwsAsync(MultiColumnKey.deleteByPk(pool, 'a'), {instanceOf: SQL.IncorrectFieldsError});
  t.true(await MultiColumnKey.deleteByPk(pool, source));
  t.false(await MultiColumnKey.deleteByPk(pool, source));
});

test('setLoaded() with missing primary key throws PrimaryKeyValueMissingError', async(t) => {
  const record = new MultiColumnKey(pool);
  record.key1 = 'e';
  t.throws(() => record.setLoaded(true), {instanceOf: SQL.PrimaryKeyValueMissingError});
});

test('delete() with missing primary key throws PrimaryKeyValueMissingError', async(t) => {
  const record = new MultiColumnKey(pool);
  record.key1 = 'e';
  await t.throwsAsync(record.delete(), {instanceOf: SQL.PrimaryKeyValueMissingError});
});

test('constructing a record without primary keys throws RecordMissingPrimaryKeyError', async(t) => {
  class NoPrimaryKey extends SQL.Record {
    static fields = {
      whatever: {type: SQL.type.text},
    };
    static primaryKeyFields = [];
    static table = 'supple_test_no_primary_key';

    debug = DEBUG_COVERAGE;
  }

  t.throws(() => new NoPrimaryKey(pool), {instanceOf: SQL.RecordMissingPrimaryKeyError});
});

test('isDirty()', async (t) => {
  const source = {
    email: 'record-is-dirty@example.com',
    displayName: 'Record Is Dirty',
  };

  const user = new User(pool);
  for (const [key, value] of Object.entries(source)) {
    user[key] = value;
  }
  t.true(user.isDirty());
  await user.save();
  t.false(user.isDirty());

  user.password = 'a new password';
  t.true(user.isDirty());
});

test('invalid field get() throws FieldNotFoundError', async (t) => {
  const user = new User(pool);
  t.throws(() => user.get('invalid_field'), {instanceOf: SQL.FieldNotFoundError});
});

test('invalid field set() throws FieldNotFoundError', async (t) => {
  const user = new User(pool);
  t.throws(() => user.set('invalid_field', true), {instanceOf: SQL.FieldNotFoundError});
});

test('intervals are handled and returned as strings', async (t) => {
  const stringInterval = '5 days';

  const r = new Interval(pool);
  r.key = stringInterval;
  await r.save();

  const loaded = await Interval.findByPk(pool, stringInterval);
  t.true(loaded?.isLoaded);
  t.is(loaded.key, stringInterval);
});

test('loading with no fields set returns false', async (t) => {
  const user = new User(pool);
  t.is(await user.load(), false);
});

test('save() skip reload', async (t) => {
  const source = {
    email: 'record-save-skip-reload@example.com',
  };

  const user = new User(pool, source);
  await user.save(true);
  t.is(user.displayName, undefined);
});

test('restore()', async (t) => {
  const source = {
    email: 'record-restore@example.com',
    displayName: 'Record Restore',
  };
  const user = await createUser(source);

  const loadedUser = await User.findByPk(pool, user.id);

  const restoredUser = new User(pool);
  restoredUser.restore(loadedUser.data());
  t.true(restoredUser?.isLoaded);
  t.deepEqual(restoredUser.data(), loadedUser.data());
});

test('automatic json serialization', async (t) => {
  const source = {
    email: 'record-auto-json@example.com',
    displayName: 'Record Auto JSON',
  };
  const user = await createUser(source);

  t.deepEqual(JSON.stringify(user), JSON.stringify(user.data()));
});

test('dirty checking of Dates handles numbers and strings', async (t) => {
  const dateMs = 1672531200000;
  const dateString = '2023-01-01T00:00:00.000Z';
  const date = new Date(dateMs);

  const source = {
    email: 'record-date-dirty-checking@example.com',
    displayName: 'Record Date Dirty Checking',
    optionalAt: date,
  };
  const user = await createUser(source);

  t.false(user.isFieldDirty('optionalAt'));

  user.optionalAt = dateMs;
  t.false(user.isFieldDirty('optionalAt'));
  user.optionalAt = dateString;
  t.false(user.isFieldDirty('optionalAt'));

  user.optionalAt = '2023-01-01T00:00:00.001Z';
  t.true(user.isFieldDirty('optionalAt'));
});

test('query', async (t) => {
  const emailLike = 'record-query-%@example.com';

  const users = [];
  for (const letter of ['a', 'b', 'c', 'd']) {
    users.push(await createUser({
      email: emailLike.replace('%', letter),
      displayName: `Record Query: ${letter}`,
    }));
  }

  // Top Level

  const singleRows = (await User.query(pool, {email: users[0].email}).run()).rows;
  t.is(singleRows.length, 1);
  t.deepEqual(singleRows[0].data({includePrivate: true}), users[0].data({includePrivate: true}));

  const allRows = (await User.query(pool, {email: SQL.like(emailLike)}).run()).rows;
  t.is(users.length, allRows.length);
  t.deepEqual(allRows.map(r => r.data({includePrivate: true})), users.map(u => u.data({includePrivate: true})));

  const andRows = (await User.query(pool, [{email: SQL.like(emailLike)}, {email: users[1].email}]).run()).rows;
  t.is(andRows.length, 1);
  t.deepEqual(andRows[0].data({includePrivate: true}), users[1].data({includePrivate: true}));

  const orRows = (await User.query(pool, SQL.or({email: users[1].email}, {email: users[3].email})).run()).rows;
  t.is(orRows.length, 2);
  t.deepEqual(orRows.map(r => r.email).sort(), [users[1].email, users[3].email]);

  // Order, Limit, and Offset

  const orderByMinimal = (await User.query(pool, SQL.or({email: users[1].email}, {email: users[3].email}), {orderBy: 'email'}).run()).rows;
  t.is(orderByMinimal.length, 2);
  t.deepEqual(orderByMinimal[0].data({includePrivate: true}), users[1].data({includePrivate: true}));
  t.deepEqual(orderByMinimal[1].data({includePrivate: true}), users[3].data({includePrivate: true}));

  const orderByExplicitDir = (await User.query(pool, SQL.or({email: users[1].email}, {email: users[3].email}), {orderBy: ['email', SQL.sort.asc]}).run()).rows;
  t.is(orderByExplicitDir.length, 2);
  t.deepEqual(orderByExplicitDir[0].data({includePrivate: true}), users[1].data({includePrivate: true}));
  t.deepEqual(orderByExplicitDir[1].data({includePrivate: true}), users[3].data({includePrivate: true}));

  // Multiple order bys are tested within tests/RecordQuery.js

  const orderByLimit = (await User.query(pool, {email: SQL.like(emailLike)}, {orderBy: 'email', limit: 1}).run()).rows;
  t.is(orderByLimit.length, 1);
  t.deepEqual(orderByLimit[0].data({includePrivate: true}), users[0].data({includePrivate: true}));

  const orderByDescLimit = (await User.query(pool, {email: SQL.like(emailLike)}, {orderBy: ['email', SQL.sort.desc], limit: 1}).run()).rows;
  t.is(orderByDescLimit.length, 1);
  t.deepEqual(orderByDescLimit[0].data({includePrivate: true}), users[users.length - 1].data({includePrivate: true}));

  const orderByOffsetLimit = (await User.query(pool, {email: SQL.like(emailLike)}, {orderBy: 'email', offset: 1, limit: 1}).run()).rows;
  t.is(orderByOffsetLimit.length, 1);
  t.deepEqual(orderByOffsetLimit[0].data({includePrivate: true}), users[1].data({includePrivate: true}));

  // Output and Returns

  const singleObject = (await User.query(pool, {email: users[0].email}, {output: SQL.outputType.object}).run()).rows;
  t.is(singleObject.length, 1);
  t.deepEqual(singleObject[0], users[0].data({includePrivate: true}));

  const singleValue = (await User.query(pool, {email: users[0].email}, {returns: 'email'}).run()).rows;
  t.is(singleValue.length, 1);
  t.deepEqual(singleValue[0], users[0].email);

  const multipleValues = (await User.query(pool, {email: users[0].email}, {returns: ['id', 'email']}).run()).rows;
  t.is(multipleValues.length, 1);
  t.deepEqual(multipleValues[0], {id: users[0].id, email: users[0].email});

  // Stream

  const stream = User.query(pool, {email: SQL.like(emailLike)}, {orderBy: 'email', stream: true});
  let i = 0;
  for await (const record of stream) {
    const expected = users[i];
    t.deepEqual(record.data({includePrivate: true}), expected.data({includePrivate: true}));
    ++i;
  }
  t.is(i, users.length);

  // We've only really tested the local interface mapping stuff for query here, RecordQuery.js is responsible for the full exercise of the underlying class.
});

test('find', async (t) => {
  const emailLike = 'record-find-non-stream-%@example.com';

  const users = [];
  for (const letter of ['a', 'b', 'c', 'd']) {
    users.push(await createUser({
      email: emailLike.replace('%', letter),
      displayName: `Record Find Non Stream: ${letter}`,
    }));
  }

  const rows = await User.find(pool, {email: SQL.like(emailLike)}, {orderBy: 'email'});
  t.is(rows.length, users.length);
  for (const [i, record] of rows.entries()) {
    const expected = users[i];
    t.deepEqual(record.data({includePrivate: true}), expected.data({includePrivate: true}));
  }
});

test('find stream', async (t) => {
  const emailLike = 'record-find-stream-%@example.com';

  const users = [];
  for (const letter of ['a', 'b', 'c', 'd']) {
    users.push(await createUser({
      email: emailLike.replace('%', letter),
      displayName: `Record Find Stream: ${letter}`,
    }));
  }

  const stream = await User.find(pool, {email: SQL.like(emailLike)}, {orderBy: 'email', stream: true});
  let i = 0;
  for await (const record of stream) {
    const expected = users[i];
    t.deepEqual(record.data({includePrivate: true}), expected.data({includePrivate: true}));
    ++i;
  }
  t.is(i, users.length);
});

test('newFromDbRow()', async(t) => {
  const source = {
    email: 'record-new-from-db-row@example.com',
    displayName: 'Record New From DB Row',
  };
  await createUser(source);
  const rows = await User.find(pool, {email: source.email}, {output: SQL.outputType.object});

  const dbRow = {};
  for (const [key, value] of Object.entries(rows[0])) {
    const dbFieldName = getFieldDbName(User.fields, key);
    dbRow[dbFieldName] = value;
  }

  const user = await User.newFromDbRow(pool, dbRow);
  for (const key of Object.keys(source)) {
    t.is(user[key], source[key]);
  }

  const withoutId = {...rows[0]};
  delete withoutId.id;
  await t.throwsAsync(User.newFromDbRow(pool, withoutId), {instanceOf: SQL.PrimaryKeyValueMissingError});

  await t.throwsAsync(User.newFromDbRow(pool), {instanceOf: SQL.MissingRequiredArgError});
});

test('setConnection() release the old connection by default', async (t) => {
  const pool = createTestPool(2);

  const conn1 = await pool.connect();
  const conn2 = await pool.connect();

  const r = new User(conn1);
  r.setConnection(conn2);

  const conn3 = await pool.connect();

  t.is(conn3, conn1);
});

test('setConnection() can skip releasing the old connection', async (t) => {
  const pool = createTestPool(2, {connectionTimeoutMillis: 500});

  const conn1 = await pool.connect();
  const conn2 = await pool.connect();

  const r = new User(conn1);
  r.setConnection(conn2, false);

  await t.throwsAsync(pool.connect());
});

test('record can get and set defined non-field properties', async (t) => {
  class HasCustomProperty extends SQL.Record {
    static fields = {
      whatever: {type: SQL.type.text},
    };
    static primaryKeyFields = ['whatever'];
    static table = 'supple_test_has_custom_property';

    debug = DEBUG_COVERAGE;

    aCustomProperty = 'before';
  }

  const r = new HasCustomProperty(pool);
  t.is(r.aCustomProperty, 'before');
  r.aCustomProperty = 'after';
  t.is(r.aCustomProperty, 'after');
});

test('record does not allow set of unknown properties', async (t) => {
  const r = new User(pool);
  t.throws(() => r.bullshit = true, {instanceOf: TypeError});
});

test('load properly binds values into subqueries', async (t) => {
  const source = {
    email: 'record-load-binds@example.com',
    displayName: 'Record Load Binds',
    password: 'I will be checked',
  };
  await createUser(source);

  const r = new User(pool);
  r.email = source.email;
  r.displayName = User.query({displayName: source.displayName}, {returns: 'displayName'});
  await r.load();
  t.true(r.isLoaded);
  t.is(r.displayName, source.displayName); // Round tripping has converted this from a query into a scalar.
  t.is(r.password, source.password);
});
