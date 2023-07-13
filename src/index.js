// Desired API
/*
Organize the db pools
  dbPool.primary
  dbPool.replica
  dbPool.analytics

const newInvoice = new Invoice([connOrPool, ]{
  subtotal: 14.99,
  discounts: 0,
  taxes: 0,
  total: 14.99,

  stripeInvoiceId: 'ZZZ',
  stripeCreatedAt: '2020-01-01T00:00:00Z',
});
newInvoice.total += 1.50;
newInvoice.save();

const invoice = Invoice.getByPrimaryKey([connOrPool], id);
invoice.total += 1.50;
invoice.save();

const invoices = await Invoice.find([connOrPool], {id: ['ZZZ', 'YYY']}, {orderBy: ['createdAt', SQL.sort.desc], limit: 10});

----

SQL.transaction((conn) => {
  // If a pool is passed in then a connection is automatically created and released.
  // If a connection is passed in it will be used directly.
  // Throws are caught and the transaction is rolled back.

  const invoice = await Invoice.getByPrimaryKey(conn, id);
  invoice.total += 1.50;
  invoice.save();
}, {connection, pool});

----

Summary Example

SQL.setDefaultPool(dbPool.primary);

// Connection and pool options are optional, default pool will be used if not specified.
const invoices = await SQL.transaction((conn) => async {
  const invoice = await Invoice.getByPrimaryKey(conn, 5);
  invoice.total += 1.50;
  await invoice.save();

  const invoices = await Invoice.find(conn, {total: 3.50});

  return invoices;
});

// First connOrPool arg is optional, will default to default pool.
const primaryInvoice = await Invoice.getByPrimaryKey(5);
const replicaInvoice = await Invoice.getByPrimaryKey(dbPool.replica, 5);
*/

const {codeStatementTimeout, sort, type, valueNotNull, valueNow} = require('./constants');
const errors = require('./errors');
const Record = require('./Record');
const Value = require('./SqlValue');
const {Or} = require('./wheres');
const {quoteIdentifier, quoteLiteral} = require('./utils/sql');
const logger = require('../../utils/logger');
const {DatabaseError} = require('pg-protocol');

const {
  CallbackRequiredError,
  ImplicitNestedTransactionError,
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
  while (i < 1000) {
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
    const msg = `Auto pruned pool connection with an ${
      error ? `error checking for an open transaction: ${error.message}` : 'open transaction'
    }.`;
    logger.error(new Error(msg), null, null, {
      _ending,
      _connecting,
      _connected,
      _connectionError,
      _queryable,
      connection: conn.connection,
    });

    conn.release(true); // Destroy the connection and remove it from the pool.
  }

  throw new Error(`Failed to find a usable pool connection after ${i} attempts.`);
}

const SQL = {
  sort,
  type,
  Value,
  valueNotNull,
  valueNow,

  ...errors,

  quoteIdentifier,
  quoteLiteral,

  defaultPool: null,
  getDefaultPool() {
    const pool = this.defaultPool;
    if (!pool) {
      throw new NoPoolSetError(
        'getDefaultPool() called before setDefaultPool() has provided a valid pool.'
      );
    }
    return pool;
  },
  setDefaultPool(pool) {
    this.defaultPool = pool;
  },

  async connected(callback, {pool = null} = {}) {
    if (!callback) {
      throw new CallbackRequiredError();
    }

    const defaultedPool = pool || this.getDefaultPool();
    const conn = await getUsablePoolConnection(defaultedPool);

    try {
      const result = await callback(conn);

      return result;
    } catch (err) {
      const isStatementTimeout = err.code === codeStatementTimeout;
      if (isStatementTimeout) {
        throw new StatementTimeoutError();
      }

      throw err;
    } finally {
      conn.release();
    }
  },

  async transaction(callback, {connection = null, pool = null, allowNested = false} = {}) {
    if (!callback) {
      throw new CallbackRequiredError();
    }

    let existingTransaction = null;

    let conn = connection;
    if (!conn) {
      const defaultedPool = pool || this.getDefaultPool();
      conn = await getUsablePoolConnection(defaultedPool);
      existingTransaction = false;
    }

    let hadDbError = false;

    try {
      if (existingTransaction === null) {
        existingTransaction = await hasOpenTransaction(conn);
      }

      if (existingTransaction) {
        if (!allowNested) {
          throw new ImplicitNestedTransactionError();
        }
      } else {
        await conn.query('BEGIN');
      }

      const result = await callback(conn);

      if (!existingTransaction) {
        await conn.query('COMMIT');
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
        await conn.query('ROLLBACK');
      }

      throw err;
    } finally {
      if (!connection) {
        // If we had a db error on a connection we created, destroy it rather than risk polluting the pool.
        conn.release(hadDbError ? true : undefined);
      }
    }
  },

  or(...wheres) {
    return new Or(wheres);
  },

  Record,
};

module.exports = SQL;
