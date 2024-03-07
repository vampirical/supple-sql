'use strict';
const {outputType, sort} = require('./constants');
const {
  AsyncIterationUnavailableError,
  FieldNotFoundError,
  IncompatibleOutputSpecifiedError,
  InvalidOptionCombinationError,
  InvalidOutputTypeError,
  QueryNotLoadedIterationError,
  RecordTypeRequiredError,
  UnavailableInStreamModeError,
} = require('./errors');
const RecordTransform = require('./RecordTransform');
const {parseArgs} = require('./utils/args');
const {formatOrderBy, getFieldDbName} = require('./utils/misc');
const {quoteIdentifier} = require('./utils/sql');
const {getWhereSql} = require('./wheres');
const QueryStream = require('pg-query-stream');

const firstArgRequiredMsg = 'A record class or instance is required to create a RecordQuery';

function getImpliedOutput(returns) {
  return Array.isArray(returns) ? outputType.object : outputType.value;
}

/**
 * @typedef {Object} RecordQuery
 * @memberOf SQL
 *
 * @implements Array
 * @implements Iterable
 * @implements AsyncIterable
 */
class RecordQuery extends Object {
  debug = false;

  conn = null;
  pool = null;

  recordType = null;
  recordName = null;

  _options = {
    output: outputType.record, // 'record' for instances of recordType, object for plan objects, or value for a single value (useful for subqueries).
    returns: null, // String for single key (implies output=value), array for multiple keys (implies output=object).
    stream: false, // If true, async iteration is the only way to retrieve results.
  };

  defaultOrderBys = [];

  wheres = [];
  orderBys = [];
  _limit = null;
  _offset = null;

  rows = [];
  isLoaded = false;

  stream = null;

  /**
   * Create a select query for a set of Records.
   *
   * @param {pg.Client|pg.Pool} [connOrPool]
   * @param {Record} recordType
   * @param {Object} [options]
   * @param {outputType} [options.output = null]
   * @param {string|Array|Set} [options.returns = null]
   * @param {boolean} [options.stream = false]
   * @returns {RecordQuery}
   */
  constructor(...args) {
    super();

    const {conn, pool, args: processedArgs} = parseArgs(args);
    const firstArg = processedArgs[0];
    if (!firstArg) {
      throw new RecordTypeRequiredError(firstArgRequiredMsg);
    }

    if (conn) {
      this.setConnection(conn);
    }
    if (pool) {
      this.setPool(pool);
    }

    const recordType = firstArg;
    const recordName = firstArg.prototype.constructor?.name;
    const {table, fields, primaryKeyFields} = recordType;
    if (!(recordName && table && fields && primaryKeyFields)) {
      throw new RecordTypeRequiredError(firstArgRequiredMsg);
    }

    this.recordType = recordType;
    this.recordName = recordName;

    for (const pkField of this.recordType.primaryKeyFields) {
      this.defaultOrderBys.push([pkField, sort.asc]);
    }

    this.wheres = [];
    this.orderBys = [];

    const options = processedArgs[1];
    if (options) {
      this.options(options);
    }

    if (this.recordType.debug) {
      this.debug = this.recordType.debug;
    }
  }

  async getConnection() {
    let conn = this.conn;
    if (!conn) {
      const pool = this.pool || require('./index').getDefaultPool();
      conn = await pool.connect();
    }

    return conn;
  }

  validateReturns(returns = this._options.returns, output = this._options.output, impliedOutput = null) {
    if (!returns || !output) {
      return;
    }

    const defaultedImpliedOutput = impliedOutput || getImpliedOutput(returns);

    if (output && output !== defaultedImpliedOutput) {
      throw new IncompatibleOutputSpecifiedError(`Your 'returns' value only supports an output type of ${defaultedImpliedOutput}, you cannot have a different output type even if explicitly requested.`);
    }
  }

  /* Chainable */

  setConnection(conn, releaseOld = true) {
    const oldConn = this.conn;

    this.conn = conn;

    if (releaseOld && oldConn) {
      oldConn.release();
    }

    return this;
  }

  setPool(pool, releaseOld = true) {
    this.pool = pool;

    this.setConnection(null, releaseOld);

    return this;
  }

  setLoaded(isLoaded) {
    this.isLoaded = isLoaded;

    return this;
  }

  /**
   * Set output type, chainable.
   *
   * @param {outputType} type
   * @returns {RecordQuery}
   */
  output(type) {
    if (!outputType[type]) {
      throw new InvalidOutputTypeError(type);
    }
    if (this._options.returns) {
      this.validateReturns(this._options.returns, type);
    }

    const oldOutput = this._options.output;
    this._options.output = type;

    if (this._options.output !== oldOutput) {
      this.setLoaded(false);
    }

    return this;
  }

  /**
   * Set returns, chainable.
   *
   * @param {string|Array|Set} keyOrKeys
   * @returns {RecordQuery}
   */
  returns(keyOrKeys) {
    const oldReturns = this._options.returns;
    this._options.returns = keyOrKeys instanceof Set ? Array.from(keyOrKeys) : keyOrKeys;

    if (this._options.returns !== oldReturns) {
      this.setLoaded(false);
    }

    this.output(getImpliedOutput(this._options.returns));

    return this;
  }

  /**
   * Add where conditions to query, chainable.
   *
   * @param {Object|Array|ConnectedWheres} wheres
   * @returns {RecordQuery}
   */
  where(wheres) {
    this.wheres.push(wheres);

    this.setLoaded(false);

    return this;
  }

  /**
   * Add order by to query, chainable.
   *
   * @param {...*} orderBys - An order by can either be a bare string field key or an array of field key then sort direction.
   * @returns {RecordQuery}
   */
  orderBy(...orderBys) {
    for (const orderBy of orderBys) {
      const expanded = !Array.isArray(orderBy) ? [orderBy] : orderBy;
      this.orderBys.push(expanded);
    }

    this.setLoaded(false);

    return this;
  }

  /**
   * Set the limit for the query, chainable.
   *
   * @param {number} limit
   * @returns {RecordQuery}
   */
  limit(limit) {
    const isChanged = (limit ?? null) !== (this._limit ?? null);

    this._limit = limit;

    if (isChanged) {
      this.setLoaded(false);
    }

    return this;
  }

  /**
   * Set the offset for the query, chainable.
   *
   * @param {number} offset
   * @returns {RecordQuery}
   */
  offset(offset) {
    const isChanged = (offset ?? 0) !== (this._offset ?? 0);

    this._offset = offset;

    if (isChanged) {
      this.setLoaded(false);
    }

    return this;
  }

  /**
   * Set options for the query, chainable.
   *
   * @param {Object} options
   * @param {boolean} [options.debug] - Like debug=.
   * @param {outputType} [options.output] - Like output().
   * @param {string|Array|Set} [options.returns] - Like returns().
   * @param {boolean} options [options.stream]
   * @returns {RecordQuery}
   */
  options(options) {
    if (options.debug !== undefined) {
      this.debug = options.debug;
    }
    if (options.stream) {
      const oldStream = this._options.stream;
      this._options.stream = options.stream;
      if (this._options.stream !== oldStream) {
        this.setLoaded(false);
      }
    }
    if (options.returns) {
      this.returns(options.returns);
    }
    if (options.output) {
      this.output(options.output);
    }

    return this;
  }

  /**
   * Run the query, chainable.
   *
   * @param {pg.Client|pg.Pool} [connOrPool]
   * @returns {Promise<RecordQuery>}
   */
  async run(...args) {
    this.validateReturns();

    const conn = await this.getConnection();
    let isReleased = false;
    const release = () => {
      if (isReleased) {
        return;
      }
      if (!this.conn) {
        conn.release();
      }
      isReleased = true;
    };
    try {
      const {query, values} = this.getSql(conn);

      if (this.debug) {
        console.debug('QUERY', {query, values});
      }

      if (this._options.stream) {
        if (this._options.returns) {
          throw new UnavailableInStreamModeError('Option returns is not supported when in stream mode.');
        }
        if (this._options.output !== outputType.record) {
          throw new UnavailableInStreamModeError('Output other than record is not supported when in stream mode.');
        }

        const stream = conn.query(new QueryStream(query, values));
        stream.on('end', release);
        this.stream = new RecordTransform({recordType: this.recordType, conn: this.conn, pool: this.pool});
        this.setLoaded(true);
        stream.pipe(this.stream);

        return this;
      }

      const dbResponse = await conn.query({
        text: query,
        values,
        rowMode: 'object',
      });

      let rows = dbResponse.rows;
      switch (this._options.output) {
        case outputType.record: {
          const {connOrPool} = parseArgs(args);
          const recordArgs = [];
          const cascadedConnOrPool = connOrPool || this.conn || this.pool;
          if (cascadedConnOrPool) {
            recordArgs.push(cascadedConnOrPool);
          }

          rows = rows.map((row) => {
            const rowInstance = new this.recordType(...recordArgs);
            rowInstance.loadDbObject(row);

            return rowInstance;
          });
          break;
        }

        case outputType.value:
          rows = rows.map((row) => row[this._options.returns]);
          break;
      }
      this.rows = rows;

      this.setLoaded(true);

      return this;
    } finally {
      release();
    }
  }

  /* End Chainable */

  /**
   * Run a count version of the query.
   *
   * @returns {Promise<number>}
   */
  async count() {
    const conn = await this.getConnection();
    try {
      const {query, values} = this.getSql(conn, {count: true});

      if (this.debug) {
        console.debug('QUERY COUNT', {query, values});
      }

      const dbResponse = await conn.query({
        text: query,
        values,
        rowMode: 'array',
      });

      return dbResponse.rows[0][0];
    } finally {
      if (!this.conn) {
        conn.release();
      }
    }
  }

  /**
   * Get a vanilla Javascript array with the queries results.
   * Respects output() and any provided flags.
   *
   * @param {Object} [fields]
   * @param {boolean} [includeDefaults=false]
   * @param {boolean} [includePrivate=false]
   * @param {boolean} [onlyDirty=false]
   * @param {boolean} [onlySet=false]
   * @returns {Array}
   */
  data({
     fields = null,
     includeDefaults = false,
     includePrivate = false,
     onlyDirty = false,
     onlySet = false,
   } = {}) {
    if (this._options.stream) {
      throw new UnavailableInStreamModeError('Cannot call data() with stream=true.');
    }
    if (this._options.output === outputType.value && fields) {
      throw new InvalidOptionCombinationError('output=value does not support fields.');
    }
    if (this._options.output !== outputType.record && (onlyDirty || onlySet)) {
      throw new InvalidOptionCombinationError('onlyDirty and onlySet are only supported with record output.');
    }

    const results = [];
    for (const row of this.rows) {
      if (this._options.output === outputType.record) {
        results.push(row.data({fields, includeDefaults, includePrivate, onlyDirty, onlySet}));
      } else {
        let outputRow = row;

        if (fields || !includePrivate) {
          const allowedKeys = new Set(fields || Object.keys(this.recordType.fields));
          if (!includePrivate) {
            for (const privateField of this.recordType.privateFields) {
              allowedKeys.delete(privateField);
            }
          }

          if (this._options.output === outputType.value) {
            if (!allowedKeys.has(this._options.returns)) {
              outputRow = null;
            }
          } else {
            outputRow = {};
            for (const [key, value] of Object.entries(row)) {
              if (allowedKeys.has(key)) {
                outputRow[key] = value;
              }
            }
          }
        }

        if (includeDefaults) {
          if (this._options.output === outputType.object) {
            for (const [key, value] of Object.entries(outputRow)) {
              if (value === null) {
                const defaultValue = this.recordType.getFieldDefaultValue(key);
                const hasDefault = defaultValue !== undefined && defaultValue !== null;
                if (hasDefault) {
                  outputRow[key] = defaultValue;
                }
              }
            }
          } else if (this._options.output === outputType.value && !outputRow) {
            const defaultValue = this.recordType.getFieldDefaultValue(this._options.returns);
            const hasDefault = defaultValue !== undefined && defaultValue !== null;
            if (hasDefault) {
              outputRow = defaultValue;
            }
          }
        }

        results.push(outputRow);
      }
    }

    return results;
  }

  getSql(conn, {count = false, isSubquery = false, bindParamsUsed = 0} = {}) {
    const wherePack = getWhereSql(conn, this.recordName, this.recordType.fields, this.wheres, {bindParamsUsed});

    let limitString = null;
    const hasLimit = this._limit !== null;
    const hasOffset = this._offset !== null;
    if (hasLimit || hasOffset) {
      const limitParts = [];
      if (hasLimit) {
        limitParts.push(`LIMIT ${this._limit}`);
      }
      if (hasOffset) {
        limitParts.push(`OFFSET ${this._offset}`);
      }
      limitString = limitParts.join(' ');
    }

    let orderByString = null;
    const canSkipOrderBy = isSubquery && !hasLimit && !hasOffset;
    if (!canSkipOrderBy) {
      const orderByParts = [];
      const orderBys = this.orderBys.length ? this.orderBys : this.defaultOrderBys;
      for (const orderBy of orderBys) {
        const key = orderBy[0];
        if (!this.recordType.fields[key]) {
          throw new FieldNotFoundError(key, this.recordName);
        }
        orderByParts.push(formatOrderBy(this.recordType.fields, orderBy));
      }

      orderByString = 'ORDER BY ' + orderByParts.join(', ');
    }

    let selectSql;
    if (this._options.output === outputType.record) {
      selectSql = '*';
    } else {
      let fieldKeys;
      if (Array.isArray(this._options.returns)) {
        fieldKeys = this._options.returns;
      } else if (this._options.returns) {
        fieldKeys = [this._options.returns];
      } else {
        fieldKeys = Object.keys(this.recordType.fields);
      }
      selectSql = fieldKeys
        .map(k => {
          const fieldDbName = getFieldDbName(this.recordType.fields, k);
          let fieldSelect = quoteIdentifier(fieldDbName);
          if (fieldDbName !== k) {
            fieldSelect += ' as ' + quoteIdentifier(k);
          }
          return fieldSelect;
        })
        .join(', ');
    }

    let query = [
      `SELECT ${selectSql} FROM`,
      quoteIdentifier(this.recordType.table),
      wherePack.query ? 'WHERE' : null,
      wherePack.query,
      orderByString,
      limitString,
    ].filter(Boolean).join(' ');

    if (count) {
      // In case order/offset/limit are significant, count using a wrapping query.
      query = `SELECT count(*)::int FROM (${query}) a`;
    }

    return {query, values: wherePack.values};
  }

  [Symbol.iterator] = () => {
    if (this._options.stream) {
      throw new UnavailableInStreamModeError('RecordQuery with stream=true cannot be synchronously iterated, used "for await".');
    }
    if (!this.isLoaded) {
      throw new QueryNotLoadedIterationError();
    }

    return this.rows.values();
  };

  [Symbol.asyncIterator]() {
    if (!this._options.stream) {
      throw new AsyncIterationUnavailableError();
    }

    let streamIter = null;
    if (this.isLoaded) {
      streamIter = this.stream.iterator({destroyOnReturn: true});
    }

    const next = async () => {
      if (!this.isLoaded) {
        await this.run();
        streamIter = this.stream.iterator({destroyOnReturn: true});
      }

      return streamIter.next();
    };

    return {
      next,
    };
  }
}

for (const key of Object.getOwnPropertyNames(Array.prototype)) {
  if (key === 'constructor' || typeof Array.prototype[key] !== 'function') {
    continue;
  }
  RecordQuery.prototype[key] = function (...args) {
    if (this._options.stream) {
      throw new UnavailableInStreamModeError(`Array function ${key} is not available in stream mode.`);
    }

    return Array.prototype[key].apply(this.rows, args);
  };
}

module.exports = RecordQuery;
