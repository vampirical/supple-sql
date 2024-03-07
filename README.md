# Supple SQL

[![validate](https://github.com/vampirical/supple-sql/actions/workflows/validate.yml/badge.svg)](https://github.com/vampirical/supple-sql/actions/workflows/validate.yml)
[![codecov](https://codecov.io/gh/vampirical/supple-sql/graph/badge.svg?token=R6DEXGFIB5)](https://codecov.io/gh/vampirical/supple-sql)

*Minimal viable PostgreSQL only ORM, does as little as it can get away with.*

# Import

Everything is access through a single top level default export. We call it `SQL` internally and in examples, you can call it whatever you like.
```javascript
const SQL = require('supple-sql');
```
or
```javascript
import SQL from 'supple-sql';
```

## Connection Management

Connection management defaults to sourcing from a single pool that you provide. If you explicitly pass connections or pools to everything you don't need to specify a default pool.
```javascript
const pool = new PG.Pool({connectionString, ...});

SQL.setDefaultPool(pool);
```
If you'd like to run multiple queries on a single connection there's a helper for that.
```javascript
const result = await SQL.connected(async function (conn) {
  // Pass conn explicitly as the first argument to all your Supple object constructors.
  // Whatever you return will be passed through as the return of connected().
  // If an error occurs either in your code or within your database the connection will be released
  // and either returned to the pool or destroyed if it isn't recoverable.
});
```
Transactions are managed similarly.
```javascript
const result = await SQL.transaction(async function (conn) {
  // Same as connected() except the transaction BEGIN/COMMIT/ROLLBACK is also managed.
}, {});
```

## Records

The types that define objects based on tables are called Records. There's a generator to create them from existing tables but they're also pretty easy to write by hand.
```javascript
class User extends SQL.Record {
  static fields = {
    id: {type: SQL.type.serial, primaryKey: true},
    email: {type: SQL.type.text, nullable: false, unique: true},
    displayName: {type: SQL.type.text, nullable: false, name: 'custom_db_name_display_name'},
    password: {type: SQL.type.text},
    createdAt: {type: SQL.type.timestamptz, nullable: false, defaultValue: SQL.valueNow},
  };
  static primaryKeyFields = ['id'];
  static privateFields = ['password']; // Optional helper for avoiding accidentally serializing sensitive values.
  static table = 'users';
}
```

Insert a row. These are equivalent.
```javascript
const user = new User({email: 'test@example.com', displayName: 'Test'});
await user.save();

const user = new User();
user.email = 'test@example.com';
user.displayName = 'Test';
await user.save();
```

Find a row.
```javascript
const user = await User.findByPk(1);
// If not found, user is null.

const user = await User.findOne({email: 'test@example.com'});
// If not found, user is null.

const user = new User();
user.email = 'test@example.com';
await user.load();
// If not found, load returns false and user.isLoaded = false.

const user = new User({email: 'test@example.com'});
await user.load();
// If not found, load returns false and user.isLoaded = false.

const user = new User();
await user.load({email: 'test@example.com'});
// If not found, load returns false, user.isLoaded = false, and email isn't set on user.
```

Update as needed.
```javascript
const user = await User.findOne({email: 'test@example.com'});
user.displayName = 'Max Power';
await user.save(); // Returns true since there was an update made. Only updates the displayName field, does not push unchanged values back to the db.
await user.save(); // Returns false since there was nothing to do.
```

There are various ways to get data out of records.
```javascript
// Property access.
console.debug(user.id);
// 1

// Default JSON serialization.
console.debug(JSON.stringify(user));
// {"id": 1, "email": "test@example.com", ...}

// Extract a vanilla object with options.
console.debug(user.data({includeDefaults = false, includePrivate = false, onlyDirty = false, onlySet = false} = {}));
// {id: 1, email: 'test@example.com', ...}
```

## Find and Queries

```javascript
const rows = await User.find({email: SQL.like('%@example.com')}, {orderBy: 'email'});
for (const record of rows) {
  // Find returns a vanilla array of loaded record instances.
}

const stream = await User.find({email: SQL.like('%@example.com')}, {orderBy: 'email', stream: true});
for await (const record of stream) {
  // You can also async iterate through a database cursor for large sets you don't want to keep in memory.  
}

// Find is just a small wrapper on top of creating a query and running it.
const userQuery = User.query({email: SQL.like('%@example.com')}, {orderBy: 'email'});
await userQuery.run();
// userQuery:
//   Is directly iterable for the same rows you'd get out of a non-stream find, and implements all array prototype methods.
//   Has a vanilla javascript array .rows property. 
//   Is async iteratable if stream=true.
```

Where conditions can be quite complex and deeply nested.
```javascript
// These are all the same.
await User.find({id: 1, displayName: 'Max Power'}); // An object of values is an implicit AND.
await User.find([{id: 1}, {displayName: 'Max Power'}]); // A top level array is an implicit AND.
await User.find(SQL.and({id: 1}, {displayName: 'Max Power'})); // SQL.and() is an explicit AND.

// Complex comparisons are available.
await User.find({displayName: SQL.ilike('% power')});
await User.find({id: SQL.lessEqual(5)});

// ANDs and ORs can appear as both top level wheres and as values under field keys, nested as deeply as you'd like.
await User.find(SQL.or({id: 1}, {id: 2}));
await User.find({id: SQL.or(1, 2)});

// You can use sub-queries.
await User.find({
  id: SQL.and(
    User.query({displayName: SQL.notEqual('Max Power')}, {returns: 'id'}),
    SQL.greaterThan(10)
  )
});
```

There are a few things you can't do.
```javascript
// You can't nest sub-queries inside of value arrays.
// It isn't worth the performance hit necessary to check for them
// and you can just wrap the query and the values using an AND.
SQL.any([User.query({id: 1}, {returns: 'id'}), 100])

// You can't nest field keys under another field key.
// Even in this best case, it is silly, in the worst case it is nonsense.
await User.find({
  id: SQL.and(
    {id: 1},
    {id: 2}
  )
});
```

# Escape Hatches

If you need a bit of raw SQL somewhere, there's `new SQL.Value()`.
```javascript
const user = User.find({createdAt: SQL.greaterThan(new SQL.Value("now() - '1 day'::interval"))});
```

If you need to load records manually.
```javascript
await SQL.connected(async function (conn) {
  const dbResp = await conn.query(COMPLICATED_QUERY);
  const users = dbResp.rows.map(r => User.newFromDbRow(r));
});
```

## TL;DR

```javascript
const pool = new PG.Pool({connectionString});
SQL.setDefaultPool(pool);

const userInvoices = await SQL.connected(async function (conn) {
  const invoice = await Invoice.findOne(conn, {id: 5});
  if (!invoice) {
    throw new Error('Invoice not found!');
  }
  invoice.total += 1.50;
  await invoice.save();

  return Invoice.find(conn, {userId: invoice.userId}, {orderBy: ['updatedAt', SQL.sort.desc]});
});
```

Generated JSDoc are included in published packages and the tests serve as additional examples. 
