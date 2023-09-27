/*
const newInvoice = new Invoice([connOrPool], {
  subtotal: 14.99,
  discounts: 0,
  taxes: 0,
  total: 14.99,

  stripeInvoiceId: 'ZZZ',
  stripeCreatedAt: '2020-01-01T00:00:00Z',
});
newInvoice.total += 1.50;
newInvoice.save();

const invoice = Invoice.findByPk([connOrPool], id);
invoice.total += 1.50;
invoice.save();

const invoices = await Invoice.find([connOrPool], {stripeInvoiceId: ['ZZZ', 'YYY']}, {orderBy: ['createdAt', SQL.sort.desc], limit: 10});

const invoice = await Invoice.findOne([connOrPool], {id: 'ZZZ');
if (!invoice) {
  // No invoice found.
}

----

const returned = await SQL.connected((conn) => {
  // If a pool is passed in then a connection is automatically created and released.
  // Throws are passed through after the connection is cleaned up.
  // The return value is passed through.

  const invoice = await Invoice.findByPk(conn, id);
  invoice.total += 1.50;
  invoice.save();

  return invoice;
}, {pool});


const returned = await SQL.transaction((conn) => {
  // Like connected() but with an added transaction.
  // If a connection is passed in it will be used directly.
  // Throws are caught and the transaction is rolled back.
  // On a successful commit the return value is passed through.

  const invoice = await Invoice.findByPk(conn, id);
  invoice.total += 1.50;
  invoice.save();

  return invoice;
}, {conn, pool});

----

Summary Example

SQL.setDefaultPool(dbPool.primary);

// Connection and pool options are optional, default pool will be used if not specified.
const invoices = await SQL.transaction((conn) => async {
  const invoice = await Invoice.findByPk(conn, 5);
  invoice.total += 1.50;
  await invoice.save();

  const invoices = await Invoice.find(conn, {total: 3.50});

  return invoices;
});

// First connOrPool arg is optional, will default to default pool.
const primaryInvoice = await Invoice.findByPk(5);
const replicaInvoice = await Invoice.findByPk(dbPool.replica, 5);
*/

'use strict';
const {codeStatementTimeout, comparison, connective, outputType, sort, type, valueNotNull, valueNow} = require('./constants');
const errors = require('./errors');
const Record = require('./Record');
const RecordTransform = require('./RecordTransform');
const RecordQuery = require('./RecordQuery');
const Value = require('./SqlValue');
const {And, Or} = require('./wheres');
const {quoteIdentifier, quoteLiteral} = require('./utils/sql');
const {DatabaseError} = require('pg-protocol');

const {
  AutoPrunedUnusablePoolConnectionError,
  FailedToFindUsablePoolConnectionError,
  ImplicitNestedTransactionError,
  MissingRequiredArgError,
  NoPoolSetError,
  StatementTimeoutError,
} = errors;

async function hasOpenTransaction(conn) {
  const txResponse = await conn.query({
    text: 'SELECT now() != statement_timestamp()',
    rowMode: 'array',
  });
  return txResponse.rows.length && txResponse.rows[0][0];
}

async function getUsablePoolConnection(pool) {
  let i = 0;
  while (i < 100) {
    ++i;

    const conn = await pool.connect();

    let error, hasTransaction;
    try {
      hasTransaction = await hasOpenTransaction(conn);
    } catch (err) {
      error = err;
    }
    if (!error && hasTransaction === false) {
      // Happy path.

      return conn;
    }

    const {_ending, _connecting, _connected, _connectionError, _queryable} = conn;
    const msg = `Auto pruned unusable pool connection with an ${
      error ? `error checking for an open transaction: ${error.message}` : 'open transaction'
    }.`;
    console.error(new AutoPrunedUnusablePoolConnectionError(msg), null, null, {
      _ending,
      _connecting,
      _connected,
      _connectionError,
      _queryable,
      connection: conn.connection,
    });

    conn.release(true); // Destroy the connection and remove it from the pool.
  }

  throw new FailedToFindUsablePoolConnectionError(`Failed to find a usable pool connection after ${i} attempts.`);
}

// TODO Refactor all generic Error()s into specific named errors. Then make sure all errors have tests and all throws check the type of the throw.

const SQL = {
  comparison,
  connective,
  outputType,
  sort,
  type,

  Value,
  valueNotNull,
  valueNow,

  Record,
  RecordQuery,

  RecordTransform,

  quoteIdentifier,
  quoteLiteral,

  ...errors,

  debug: false,

  pools: {
    ['default']: null,
  },
  getDefaultPool() {
    const pool = this.pools.default;
    if (!pool) {
      throw new NoPoolSetError(
        'getDefaultPool() called before setDefaultPool()'
      );
    }
    return pool;
  },
  setDefaultPool(pool) {
    this.pools.default = pool;
  },

  // TODO Add getDebugConn()/getDebugPool() utils for the debug flag to activate in these functions. Detect if the pool is already wrapped and avoid double wrapping.

  async connected(callback, {pool = null, autoDestroyConn = false, debug = this.debug} = {}) {
    if (!callback) {
      throw new MissingRequiredArgError('A callback is required for connected().');
    }

    const defaultedPool = pool || this.getDefaultPool();
    const conn = await getUsablePoolConnection(defaultedPool);

    try {
      return await callback(conn);
    } catch (err) {
      const isStatementTimeout = err.code === codeStatementTimeout;
      if (isStatementTimeout) {
        throw new StatementTimeoutError();
      }

      throw err;
      // https://github.com/bcoe/c8/issues/229
      /* c8 ignore next 1 */
    } finally {
      conn.release(autoDestroyConn ? true : undefined);
    }
  },

  async transaction(callback, {conn = null, pool = null, allowNested = false, autoDestroyConn = false, debug = this.debug} = {}) {
    if (!callback) {
      throw new MissingRequiredArgError('A callback is required for transaction().');
    }

    let existingTransaction = null;

    let defaultedConn = conn;
    if (!defaultedConn) {
      const defaultedPool = pool || this.getDefaultPool();
      defaultedConn = await getUsablePoolConnection(defaultedPool);
      existingTransaction = false;
    }

    let hadDbError = false;

    try {
      if (existingTransaction === null) {
        existingTransaction = await hasOpenTransaction(defaultedConn);
      }

      if (existingTransaction) {
        if (!allowNested) {
          throw new ImplicitNestedTransactionError();
        }
      } else {
        await defaultedConn.query('BEGIN');
      }

      const result = await callback(defaultedConn);

      if (!existingTransaction) {
        await defaultedConn.query('COMMIT');
      }

      return result;
    } catch (err) {
      if (err instanceof DatabaseError) {
        hadDbError = true;
      }

      const isStatementTimeout = err.code === codeStatementTimeout;
      if (isStatementTimeout) {
        throw new StatementTimeoutError();
      }

      if (!existingTransaction) {
        await defaultedConn.query('ROLLBACK');
      }

      throw err;
      // https://github.com/bcoe/c8/issues/229
      /* c8 ignore next 1 */
    } finally {
      if (!conn || autoDestroyConn) {
        // If we had a db error on a connection we created, destroy it rather than risk polluting the pool.
        defaultedConn.release(hadDbError || autoDestroyConn ? true : undefined);
      }
    }
  },

  and(...wheres) {
    return new And(wheres);
  },

  or(...wheres) {
    return new Or(wheres);
  },
};

// Provides top level comparison functions for easy use like: {name: SQL.ilike('%doug%')}
for (const [compKey, compValue] of Object.entries(comparison)) {
  SQL[compKey] = function (value, {bind = true, quote = false} = {}) {
    return new Value(value, {comparison: compValue, bind, quote});
  }
}

module.exports = SQL;
