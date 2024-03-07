'use strict';
const {codeStatementTimeout, comparison, connective, outputType, sort, type, valueNotNull, valueNow} = require('./constants');
const errors = require('./errors');
const {generateRecord} = require('./generate');
const {runMigrations} = require('./migrations');
const Record = require('./Record');
const RecordTransform = require('./RecordTransform');
const RecordQuery = require('./RecordQuery');
const Value = require('./SqlValue');
const {ConnectedWheres, And, Or} = require('./wheres');
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

/**
 * SQL
 * @namespace SQL
 */
const SQL = {
  comparison,
  connective,
  outputType,
  sort,
  type,

  Value,
  valueNotNull,
  valueNow,

  ConnectedWheres,
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
  /**
   * Get default pool.
   *
   * @throws NoPoolSetError
   * @returns {pg.Pool}
   */
  getDefaultPool() {
    const pool = this.pools.default;
    if (!pool) {
      throw new NoPoolSetError(
        'getDefaultPool() called before setDefaultPool()'
      );
    }
    return pool;
  },
  /**
   * Set default pool.
   *
   * @param {pg.Pool} pool
   */
  setDefaultPool(pool) {
    this.pools.default = pool;
  },

  generateRecord,
  runMigrations,

  /**
   * Creates and manages a connection around a callback.
   *
   * @param {function} callback
   * @param {Object} [options]
   * @param {pg.Pool} [options.pool]
   * @param {boolean} [options.autoDestroyConn=false]
   * @returns {Promise<*>}
   */
  async connected(callback, {pool = null, autoDestroyConn = false} = {}) {
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

  /**
   * Creates and manages a transaction around a callback.
   *
   * @param {function} callback
   * @param {Object} [options]
   * @param {pg.Client} [options.conn]
   * @param {pg.Pool} [options.pool]
   * @param {boolean} [options.allowNested=false]
   * @param {boolean} [options.autoDestroyConn=false]
   * @returns {Promise<*>}
   */
  async transaction(callback, {conn = null, pool = null, allowNested = false, autoDestroyConn = false} = {}) {
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

  /**
   * Shorthand for one-off query.
   *
   * @param {string} test - SQL query.
   * @param {Array} [values]
   * @param {Object} [options]
   * @param {pg.Pool} [options.pool]
   * @param {boolean} [options.autoDestroyConn=false]
   * @param {string} [options.name] - node-pg passthrough
   * @param {string} [options.rowMode] - node-pg passthrough
   * @param {*} [options.types] - node-pg passthrough
   * @returns {Promise<pg.Result>}
   */
  async query(text, values = null, {pool = null, autoDestroyConn = false, name = undefined, rowMode = undefined, types = undefined} = {}) {
    return this.connected(async function(conn) {
      return conn.query({text, values, name, rowMode, types});
    }, {pool, autoDestroyConn});
  },

  /**
   * Where AND.
   *
   * @param {...*} wheres
   * @returns {And}
   */
  and(...wheres) {
    return new And(wheres);
  },

  /**
   * Where OR.
   *
   * @param {...*} wheres
   * @returns {Or}
   */
  or(...wheres) {
    return new Or(wheres);
  },
};

// Provides top level comparison functions for easy use like: {name: SQL.ilike('%doug%')}
for (const [compKey, compValue] of Object.entries(comparison)) {
  SQL[compKey] = function (value, {bind = true, quote = false} = {}) {
    return new Value(value, {comparison: compValue, bind, quote});
  };
}

module.exports = SQL;
