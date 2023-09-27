'use strict';
/* eslint-disable no-console */
const {connective: connectiveDefs, type, valueNow} = require('./constants');
const {
  FieldNotFoundError,
  IncorrectFieldsError,
  InvalidOptionCombinationError,
  MissingRequiredArgError,
  PrimaryKeyValueMissingError,
  RecordMissingPrimaryKeyError,
} = require('./errors');
const RecordQuery = require('./RecordQuery');
const SqlValue = require('./SqlValue');
const {parseArgs} = require('./utils/args');
const {getFieldDbName} = require('./utils/misc');
const {quoteIdentifier} = require('./utils/sql');
const {getWhereSql} = require('./wheres');
const equal = require('fast-deep-equal');

/**
 * @typedef {Object} Record
 * @memberOf SQL
 */
class Record extends Object {
  static fields = {};
  static primaryKeyFields = [];
  static privateFields = []; // Require an extra hoop to extract these values.
  static table = '';

  /**
   * Find by Primary Key
   *
   * Returns null if one and only one matching row isn't found.
   *
   * @param {pg.Client|pg.Pool} [connOrPool]
   * @param {Object} [fields]
   * @param {...*} [primaryKeyValues]
   * @returns {Promise<Record.prototype.constructor|null>}
   */
  static async findByPk(...args) {
    return this.findOne(...args);
  }

  /**
   * Delete by Primary Key
   *
   * @param {pg.Client|pg.Pool} [connOrPool]
   * @param {Object} [fields]
   * @param {...*} [primaryKeyValues]
   * @returns {boolean}
   */
  static async deleteByPk(...args) {
    return this.deleteOne(...args);
  }

  /**
   * Find One
   *
   * Returns null if one and only one matching row isn't found.
   *
   * @param {pg.Client|pg.Pool} [connOrPool]
   * @param {Object} [fields]
   * @param {...*} [primaryKeyValues]
   * @returns {Promise<Record.prototype.constructor|null>}
   */
  static async findOne(...args) {
    const type = this.prototype.constructor;
    const instance = new type(...args);
    const isLoaded = await instance.load();

    return isLoaded ? instance : null;
  }

  /**
   * Delete by Primary Key
   *
   * @param {pg.Client|pg.Pool} [connOrPool]
   * @param {Object} [fields]
   * @param {...*} [primaryKeyValues]
   * @returns {boolean}
   */
  static async deleteOne(...args) {
    const type = this.prototype.constructor;
    const instance = new type(...args);

    return instance.delete();
  }

  /**
   * Create a query and run it.
   *
   * @param {pg.Client|pg.Pool} [connOrPool]
   * @param {Object|Array|ConnectedWheres} wheres
   * @param {Object} [options]
   * @param {string|Array} [options.orderBy = null]
   * @param {number} [options.limit = null]
   * @param {number} [options.offset = null]
   * @param {outputType} [options.output = null]
   * @param {string|Array|Set} [options.returns = null]
   * @param {boolean} [options.stream = false]
   * @returns {Promise<Array|{stream}>} If options.stream=false then it's a simple array, otherwise it's a stream connected to a database cursor.
   */
  static async find(...args) {
    const type = this.prototype.constructor;
    const q = await type.query(...args);
    await q.run();

    return q.stream ? q : q.rows;
  }

  /**
   * Create a select query for a set of Records.
   *
   * @param {pg.Client|pg.Pool} [connOrPool]
   * @param {Object|Array|ConnectedWheres} wheres
   * @param {Object} [options]
   * @param {string|Array} [options.orderBy = null]
   * @param {number} [options.limit = null]
   * @param {number} [options.offset = null]
   * @param {outputType} [options.output = null]
   * @param {string|Array|Set} [options.returns = null]
   * @param {boolean} [options.stream = false]
   * @returns {RecordQuery}
   */
  static query(...args) {
    const {connOrPool, args: processedArgs} = parseArgs(args);
    const type = this.prototype.constructor;

    const recordQueryArgs = [];
    if (connOrPool) {
      recordQueryArgs.push(connOrPool);
    }
    recordQueryArgs.push(type);

    const instance = new RecordQuery(...recordQueryArgs);

    if (processedArgs.length) {
      const wheres = processedArgs[0];
      if (wheres) {
        instance.where(wheres);
      }

      const optional = processedArgs[1] ?? {};
      const {limit = null, offset = null, orderBy = null, ...options} = optional;

      if (limit !== null) {
        instance.limit(limit);
      }
      if (offset !== null) {
        instance.offset(offset);
      }
      if (orderBy) {
        instance.orderBy(orderBy);
      }
      instance.options(options);
    }

    return instance;
  }

  /**
   * Create an instance from an object that uses db field names.
   * Useful in case you want to write manual queries that return records.
   *
   * @param {pg.Client|pg.Pool} [connOrPool]
   * @param {Object} dbRow
   * @returns {Promise<Record>}
   */
  static async newFromDbRow(...args) {
    const {connOrPool, args: processedArgs} = parseArgs(args);

    const row = processedArgs.shift();
    if (!row) {
      throw new MissingRequiredArgError('Row is required as an argument.');
    }

    const recordArgs = [];
    if (connOrPool) {
      recordArgs.push(connOrPool);
    }
    Array.prototype.push.apply(recordArgs, processedArgs);

    const type = this.prototype.constructor;
    const instance = new type(...recordArgs);

    instance.loadDbObject(row);

    return instance;
  }

  static getFieldDefaultValue(key) {
    const fieldConfig = this.fields[key];
    if (
      fieldConfig &&
      fieldConfig.defaultValue !== undefined &&
      fieldConfig.defaultValue !== valueNow // Handled by the db.
    ) {
      return fieldConfig.defaultValue;
    }

    return undefined;
  }

  debug = null;

  conn = null;
  pool = null;

  values = {};
  valuesClean = {};

  isFieldSet = {};

  /**
   * Was the data in this instance previously loaded from a db row.
   *
   * Can be read directly but should only be changed through setLoaded().
   * @see setLoaded()
   *
   * @type {boolean}
   */
  isLoaded = false;
  primaryKeyInternalValues = {};

  warnings = null;

  /**
   * Create a Record instance, with or without initial values.
   *
   * @param {pg.Client|pg.Pool} [connOrPool]
   * @param {Object} [fields]
   * @param {...*} [primaryKeyValues]
   * @returns {Object}
   */
  constructor(...args) {
    super();

    if (!this.constructor.primaryKeyFields.length) {
      throw new RecordMissingPrimaryKeyError(this.constructor.name);
    }

    const {conn, pool, args: processedArgs} = parseArgs(args);

    if (conn) {
      this.setConnection(conn);
    }
    if (pool) {
      this.setPool(pool);
    }

    const proxied = new Proxy(this, {
      get(record, prop, receiver) {
        if (prop === 'recordType') {
          return record[prop];
        }

        const hasField = !!record.constructor.fields[prop];
        if (hasField) {
          return record.get(prop);
        }
        const propType = typeof record[prop];
        if (propType === 'function') {
          return record[prop].bind(receiver);
        } else if (propType !== 'undefined') {
          return record[prop];
        }
        return prop === 'then';
      },
      set(record, prop, value, receiver) {
        if (prop === 'recordType') {
          record[prop] = value;
          return true;
        }

        const hasField = !!record.constructor.fields[prop];
        if (hasField) {
          record.set.call(receiver, prop, value);
          return true;
        }
        if (typeof record[prop] !== 'undefined') {
          record[prop] = value; // eslint-disable-line no-param-reassign
          return true;
        }
        return false;
      },
    });
    proxied.recordType = this.constructor;

    if (processedArgs.length) {
      const firstArg = processedArgs[0];
      const isObject = typeof firstArg === 'object' && firstArg !== null;
      let fields = firstArg;
      if (!isObject) {
        if (this.constructor.primaryKeyFields.length !== 1) {
          throw new IncorrectFieldsError(
            'Unable to get record without single primary key field by non-object value.'
          );
        }

        fields = {[this.constructor.primaryKeyFields[0]]: firstArg};
      }

      for (const [key, value] of Object.entries(fields)) {
        proxied.set(key, value);
      }
    }

    // https://github.com/bcoe/c8/issues/290
    /* c8 ignore next 2 */
    return proxied;
  }

  debugging() {
    return this.debug === null || this.debug === undefined ? require('./index').debug : this.debug;
  }

  setConnection(conn, releaseOld = true) {
    const oldConn = this.conn;

    this.conn = conn;

    if (releaseOld && oldConn) {
      oldConn.release();
    }
  }

  setPool(pool, releaseOld = true) {
    this.pool = pool;

    this.setConnection(null, releaseOld);
  }

  async getConnection() {
    let conn = this.conn;
    if (!conn) {
      const pool = this.pool || require('./index').getDefaultPool();
      conn = await pool.connect();
    }

    return conn;
  }

  isPrimaryKeySet() {
    let set = true;

    for (const key of this.recordType.primaryKeyFields) {
      if (!this.isFieldSet[key]) {
        set = false;
        break;
      }
    }

    return set;
  }

  isFieldDirty(key) {
    let current = this.values[key] ?? null;
    if (current instanceof Date) {
      current = current.toISOString();
    }

    let clean = this.valuesClean[key] ?? null;
    if (clean instanceof Date) {
      clean = typeof current === 'number' ? clean.getTime() : clean.toISOString();
    }

    return !equal(current, clean);
  }

  /**
   * Is the in memory state dirty.
   *
   * @returns {boolean}
   */
  isDirty() {
    for (const field of Object.keys(this.recordType.fields)) {
      if (this.isFieldDirty(field)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Change whether this instance considers itself previously loaded from the db.
   *
   * @see isLoaded
   *
   * @param {boolean} isLoaded
   * @param {boolean} [skipPrimaryKeyCheck=false]
   */
  setLoaded(isLoaded, skipPrimaryKeyCheck = false) {
    if (isLoaded) {
      if (!skipPrimaryKeyCheck && !this.isPrimaryKeySet()) {
        throw new PrimaryKeyValueMissingError(this.recordType.name);
      }

      for (const fieldKey of this.recordType.primaryKeyFields) {
        this.primaryKeyInternalValues[fieldKey] = this.get(fieldKey);
      }

      this.valuesClean = {...this.values};
    } else {
      this.valuesClean = {};
    }

    this.isLoaded = isLoaded;
  }

  getFieldDbName(key) {
    return getFieldDbName(this.recordType.fields, key);
  }

  getWhereSql(conn, wheres, {connective = connectiveDefs.and, bindParamsUsed = 0} = {}) {
    return getWhereSql(
      conn,
      this.recordType.name,
      this.recordType.fields,
      wheres,
      {connective, bindParamsUsed}
    );
  }

  getPrimaryKeyValues(useInternalValues = false) {
    const values = new Map();

    for (const primaryKeyField of this.recordType.primaryKeyFields) {
      values.set(
        primaryKeyField,
        (useInternalValues
          ? this.primaryKeyInternalValues[primaryKeyField]
          : this.get(primaryKeyField)) ?? null
      );
    }

    return values;
  }

  getPrimaryKeyWherePack(conn, useInternalValues = false, bindParamsUsed = 0) {
    return this.getWhereSql(conn, this.getPrimaryKeyValues(useInternalValues), {bindParamsUsed});
  }

  getFieldsSql() {
    const res = [];

    for (const [key, fieldConfig] of Object.entries(this.recordType.fields)) {
      let val = this.getFieldDbName(key);

      if (fieldConfig.type === type.interval) {
        val = quoteIdentifier(val) + '::text';
      } else {
        val = quoteIdentifier(val);
      }

      res.push(val);
    }

    return res.join(', ');
  }

  /**
   * Get the current value for a field. Outside the instance this is proxied as vanilla object property access.
   *
   * @param {string} key - As defined in fields.
   * @returns {*}
   */
  get(key) {
    if (!this.recordType.fields[key]) {
      throw new FieldNotFoundError(key, this.recordType.name);
    }

    return this.values[key];
  }

  /**
   * Set the current value for a field. Outside the instance this is proxied as vanilla object property access.
   *
   * @param {string} key - As defined in fields.
   * @param {*} value
   */
  set(key, value) {
    if (!this.recordType.fields[key]) {
      throw new FieldNotFoundError(key, this.recordType.name);
    }

    this.values[key] = value;
    this.isFieldSet[key] = true;
  }

  loadDbArray(array) {
    const indexToKey = Object.keys(this.recordType.fields);
    for (const [index, value] of array.entries()) {
      const key = indexToKey[index];
      this.set(key, value);
    }

    this.setLoaded(true);
  }

  loadDbObject(dbRow) {
    for (const key of Object.keys(this.recordType.fields)) {
      const fieldDbName = this.getFieldDbName(key);

      const value = dbRow[fieldDbName];
      if (value !== undefined) {
        this.set(key, value);
      }
    }

    this.setLoaded(true);
  }

  /**
   * Attempt to load db values into the instance.
   * If no field values are passed then the current field values are used to load from the db.
   * Field values are only modified, regardless of whether fields are passed, only if exactly 1 db row is matched.
   *
   * If 2 rows are matched a warning will be logged and populated into this.warnings.
   *
   * @param {Object} [fields]
   * @returns {Promise<boolean>}
   */
  async load(fields = null) {
    // Try to load from set fields, if we get 1 and only one result return true, otherwise return false.

    let defaultedFields = fields;
    if (!fields) {
      defaultedFields = {};
      for (const key of Object.keys(this.isFieldSet)) {
        defaultedFields[key] = this.get(key);
      }
    }

    const fieldKeys = Object.keys(defaultedFields);
    const fieldCount = fieldKeys.length;
    if (!fieldCount) {
      return false;
    }

    const selectFieldsSql = this.getFieldsSql();

    let dbResponse;
    const conn = await this.getConnection();
    try {
      const whereSql = this.getWhereSql(conn, defaultedFields);

      const loadQuery = [
        'SELECT',
        selectFieldsSql,
        'FROM',
        quoteIdentifier(this.recordType.table),
        'WHERE',
        whereSql.query,
        'LIMIT 2',
      ].join(' ');

      if (this.debugging()) {
        console.debug('LOAD', {loadQuery, loadValues: whereSql.values});
      }

      dbResponse = await conn.query({
        text: loadQuery,
        values: whereSql.values,
        rowMode: 'array',
      });
    } finally {
      if (!this.conn) {
        conn.release();
      }
    }

    const rows = dbResponse.rows;

    let result = false;
    switch (rows.length) {
      case 0:
        // Nothing found
        break;

      case 1:
        this.loadDbArray(rows[0]);

        result = true;
        break;

      case 2: {
        const warning = 'Multiple results matched load() attempt.';
        if (!this.warnings) {
          this.warnings = [];
        }
        this.warnings.push(warning);
        console.warn(warning);
        break;
      }
    }

    return result;
  }

  /**
   * Delete the db row.
   * The instance keeps its data but is no longer considered loaded.
   *
   * @returns {Promise<boolean>}
   */
  async delete() {
    for (const value of this.getPrimaryKeyValues().values()) {
      if (value === undefined || value === null) {
        throw new PrimaryKeyValueMissingError(this.recordType.name);
      }
    }

    const conn = await this.getConnection();
    let dbResponse;
    try {
      const primaryKeyWhereSql = this.getPrimaryKeyWherePack(conn);

      const deleteQuery = [
        'DELETE FROM',
        quoteIdentifier(this.recordType.table),
        'WHERE',
        primaryKeyWhereSql.query,
      ].join(' ');

      if (this.debugging()) {
        console.debug('DELETE', {deleteQuery, deleteValues: primaryKeyWhereSql.values});
      }

      dbResponse = await conn.query({
        text: deleteQuery,
        values: primaryKeyWhereSql.values,
        rowMode: 'array',
      });
    } finally {
      if (!this.conn) {
        conn.release();
      }
    }

    const wasDeleted = dbResponse.rowCount === 1;

    if (wasDeleted) {
      this.setLoaded(false);
    }

    return wasDeleted;
  }

  getSqlFields(fields) {
    const result = {};

    let bindParamNum = 0;
    for (const [key, value] of Object.entries(fields)) {
      let string;
      let bind = true;
      let bindValue;
      if (typeof value === 'symbol') {
        string = valueNow.description;
        bind = false;
      } else {
        string = '$' + ++bindParamNum;
        bindValue = value;
      }

      result[key] = {
        name: quoteIdentifier(this.getFieldDbName(key)),
        string,
        bind,
        bindValue,
      };
    }

    return result;
  }

  /**
   * Save the current in memory state to the database.
   * If isLoaded, this will be an insert, otherwise it will be an update.
   *
   * @param {boolean} [skipReload=false] - Skip reloading the new state from the db, a slight efficiency gain if you know you won't use the values or for use with ignoreConflict.
   * @param {boolean} [ignoreConflict=false] - Ignore conflicts during insert/update, requires skipReload=true.
   * @returns {Promise<boolean>}
   */
  async save(skipReload = false, ignoreConflict = false) {
    if (ignoreConflict && !skipReload) {
      throw new InvalidOptionCombinationError('The ignoreConflict option requires skipReload since it is possible no row will be changed.');
    }

    if (this.isLoaded) {
      const setStrings = [];
      const setValues = [];
      const sqlFields = this.getSqlFields(this.data({includePrivate: true, onlyDirty: true}));
      for (const sqlField of Object.values(sqlFields)) {
        setStrings.push(sqlField.name + ' = ' + sqlField.string);
        if (sqlField.bind) {
          setValues.push(sqlField.bindValue);
        }
      }
      if (!setStrings.length) {
        return false; // Nothing to update.
      }
      const setString = setStrings.join(', ');

      const conn = await this.getConnection();
      let dbResponse;
      try {
        const primaryKeyWhereSql = this.getPrimaryKeyWherePack(conn, true, setValues.length);

        let updateQuery = [
          'UPDATE',
          quoteIdentifier(this.recordType.table),
          'SET',
          setString,
          'WHERE',
          primaryKeyWhereSql.query,
        ].join(' ');
        if (!skipReload) {
          updateQuery += ' RETURNING ' + this.getFieldsSql();
        }
        const updateValues = [...setValues, ...primaryKeyWhereSql.values];

        if (this.debugging()) {
          console.debug('UPDATE', {updateQuery, updateValues});
        }

        dbResponse = await conn.query({
          text: updateQuery,
          values: updateValues,
          rowMode: 'array',
        });
      } finally {
        if (!this.conn) {
          conn.release();
        }
      }

      if (!skipReload) {
        this.loadDbArray(dbResponse.rows[0]);
      }

      // If anyone ever asks for this flag I will actually implement it.

      // enforcePrev=false - The default behavior and currently only behavior.
      // An update was issued, our local state was blasted over the server's state.
      // It would change our last seen server data.
      // It won't necessarily be a diff for the server when we issue the update.
      // It will be a real update 99.99% of the time.
      // You probably don't care about the distinction for 99.99% of that 0.01%.

      // enforcePrev=true
      // We track previous values for all fields not just primary key (primaryKeyInternalValues).
      // Where enforces all the previous values in order to update the row.
      // Only if server data actually changed (rowCount) do we return true.

      return true;
    } else {
      const insertFields = [];
      const insertValueStrings = [];
      const insertValues = [];
      const sqlFields = this.getSqlFields(
        this.data({includeDefaults: true, includePrivate: true, onlyDirty: true})
      );
      for (const sqlField of Object.values(sqlFields)) {
        insertFields.push(sqlField.name);
        insertValueStrings.push(sqlField.string);
        if (sqlField.bind) {
          insertValues.push(sqlField.bindValue);
        }
      }

      let columnsString = null;
      let valuesString = 'DEFAULT VALUES';
      if (insertValues.length) {
        columnsString = `(${insertFields.join(', ')})`;
        valuesString = `VALUES (${insertValueStrings.join(', ')})`;
      }

      let insertQuery = [
        'INSERT INTO',
        quoteIdentifier(this.recordType.table),
        columnsString,
        valuesString,
      ].filter(Boolean).join(' ');
      if (ignoreConflict) {
        insertQuery += ' ON CONFLICT DO NOTHING';
      }
      if (!skipReload) {
        insertQuery += ' RETURNING ' + this.getFieldsSql();
      }

      if (this.debugging()) {
        console.debug('INSERT', {insertQuery, insertValues});
      }
      const conn = await this.getConnection();
      const dbResponse = await conn.query({
        text: insertQuery,
        values: insertValues,
        rowMode: 'array',
      });
      if (!this.conn) {
        conn.release();
      }

      if (!skipReload) {
        this.loadDbArray(dbResponse.rows[0]);
      }

      return true;
    }
  }

  restore(fields) {
    for (const [key, value] of Object.entries(fields)) {
      this.set(key, value);
    }
    this.setLoaded(true, true);
  }

  /**
   * Get a vanilla Javascript object with the record's data.
   *
   * @param {Object} [fields]
   * @param {boolean} [includeDefaults=false]
   * @param {boolean} [includePrivate=false]
   * @param {boolean} [onlyDirty=false]
   * @param {boolean} [onlySet=false]
   * @returns {Object}
   */
  data({
    fields = null,
    includeDefaults = false,
    includePrivate = false,
    onlyDirty = false,
    onlySet = false,
  } = {}) {
    const object = {};
    for (const field of fields || Object.keys(this.recordType.fields)) {
      const defaultValue = this.recordType.getFieldDefaultValue(field);
      const hasDefault = includeDefaults && defaultValue !== undefined && defaultValue !== null;

      if (onlyDirty && !this.isFieldDirty(field) && !hasDefault) {
        continue;
      }
      if (onlySet && !this.isFieldSet[field] && !hasDefault) {
        continue;
      }

      let value = this.get(field);
      if (value === undefined && hasDefault) {
        value = defaultValue;
      }
      if (value instanceof SqlValue) {
        value = value.value;
      }
      object[field] = value;
    }

    if (!includePrivate) {
      for (const privateField of this.recordType.privateFields) {
        delete object[privateField];
      }
    }

    return object;
  }

  toJSON() {
    return this.data();
  }
}

module.exports = Record;
