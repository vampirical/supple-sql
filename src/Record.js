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
const {parseArgs, processArgs} = require('./utils/args');
const {getFieldDbName} = require('./utils/misc');
const {quoteIdentifier} = require('./utils/sql');
const {getWhereSql} = require('./wheres');
const equal = require('fast-deep-equal');

class Record extends Object {
  static fields = {};
  static primaryKeyFields = [];
  static privateFields = []; // Require an extra hoop to extract these values.
  static table = '';

  static async findByPk(...args) {
    return this.findOne(...args);
  }

  static async deleteByPk(...args) {
    return this.deleteOne(...args);
  }

  static async findOne(...args) {
    const type = this.prototype.constructor;
    const instance = new type(...args);
    const isLoaded = await instance.load();

    return isLoaded ? instance : null;
  }

  static async deleteOne(...args) {
    const type = this.prototype.constructor;
    const instance = new type(...args);

    return instance.delete();
  }

  static async find(...args) {
    const type = this.prototype.constructor;
    const q = await type.query(...args);
    await q.run();
    if (q.stream) {
      return q;
    }
    return q.rows;
  }

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

  static async newFromDbRow(...args) {
    // Assumes external callers are generally going to be using the default object row mode.

    const {connOrPool, args: processedArgs} = parseArgs(args);

    const row = processedArgs[0];
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

  isLoaded = false;
  primaryKeyInternalValues = {};

  warnings = null;

  constructor(...args) {
    super();

    if (!this.constructor.primaryKeyFields.length) {
      throw new RecordMissingPrimaryKeyError(this.constructor.name);
    }

    const processedArgs = processArgs(this, args);
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
        this.set(key, value);
      }
    }

    const proxied = new Proxy(this, {
      get(record, prop) {
        const hasField = !!record.constructor.fields[prop];
        if (hasField) {
          return record.get(prop);
        }
        const propType = typeof record[prop];
        if (propType === 'function') {
          return record[prop].bind(record);
        } else if (propType !== 'undefined') {
          return record[prop];
        }
        return prop === 'then';
      },
      set(record, prop, value) {
        const hasField = !!record.constructor.fields[prop];
        if (hasField) {
          record.set(prop, value);
          return true;
        }
        if (typeof record[prop] !== 'undefined') {
          record[prop] = value; // eslint-disable-line no-param-reassign
          return true;
        }
        return false;
      },
    });

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
      conn = await this.pool.connect();
    }

    return conn;
  }

  isPrimaryKeySet() {
    let set = true;

    for (const key of this.constructor.primaryKeyFields) {
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

  isDirty() {
    for (const field of Object.keys(this.constructor.fields)) {
      if (this.isFieldDirty(field)) {
        return true;
      }
    }

    return false;
  }

  setLoaded(isLoaded, skipPrimaryKeyCheck = false) {
    if (isLoaded) {
      if (!skipPrimaryKeyCheck && !this.isPrimaryKeySet()) {
        throw new PrimaryKeyValueMissingError(this.constructor.name);
      }

      for (const fieldKey of this.constructor.primaryKeyFields) {
        this.primaryKeyInternalValues[fieldKey] = this.get(fieldKey);
      }

      this.valuesClean = {...this.values};
    } else {
      this.valuesClean = {};
    }

    this.isLoaded = isLoaded;
  }

  getFieldDbName(key) {
    return getFieldDbName(this.constructor.fields, key);
  }

  getWhereSql(wheres, {connective = connectiveDefs.and, bindParamsUsed = 0} = {}) {
    return getWhereSql(
      this.constructor.name,
      this.constructor.fields,
      wheres,
      {connective, bindParamsUsed}
    );
  }

  getPrimaryKeyValues(useInternalValues = false) {
    const values = new Map();

    for (const primaryKeyField of this.constructor.primaryKeyFields) {
      values.set(
        primaryKeyField,
        (useInternalValues
          ? this.primaryKeyInternalValues[primaryKeyField]
          : this.get(primaryKeyField)) ?? null
      );
    }

    return values;
  }

  getPrimaryKeyWherePack(useInternalValues = false, bindParamsUsed = 0) {
    return this.getWhereSql(this.getPrimaryKeyValues(useInternalValues), {bindParamsUsed});
  }

  getFieldsSql() {
    const res = [];

    for (const [key, fieldConfig] of Object.entries(this.constructor.fields)) {
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

  get(key) {
    if (!this.constructor.fields[key]) {
      throw new FieldNotFoundError(key, this.constructor.name);
    }

    return this.values[key];
  }

  set(key, value) {
    if (!this.constructor.fields[key]) {
      throw new FieldNotFoundError(key, this.constructor.name);
    }

    this.values[key] = value;
    this.isFieldSet[key] = true;
  }

  loadDbArray(array) {
    const indexToKey = Object.keys(this.constructor.fields);
    for (const [index, value] of array.entries()) {
      const key = indexToKey[index];
      this.set(key, value);
    }

    this.setLoaded(true);
  }

  loadDbObject(dbRow) {
    for (const key of Object.keys(this.constructor.fields)) {
      const fieldDbName = this.getFieldDbName(key);

      const value = dbRow[fieldDbName];
      if (value !== undefined) {
        this.set(key, value);
      }
    }

    this.setLoaded(true);
  }

  async load(fields = null) {
    // Try to load from set fields, if we don't get 1 and only one result return true, otherwise return false.

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
    const whereSql = this.getWhereSql(defaultedFields);

    const loadQuery = [
      'SELECT',
      selectFieldsSql,
      'FROM',
      quoteIdentifier(this.constructor.table),
      'WHERE',
      whereSql.query,
      'LIMIT 2',
    ].join(' ');

    const conn = await this.getConnection();
    if (this.debugging()) {
      console.debug('LOAD', {loadQuery, loadValues: whereSql.values});
    }
    const dbResponse = await conn.query({
      text: loadQuery,
      values: whereSql.values,
      rowMode: 'array',
    });
    const rows = dbResponse.rows;
    if (!this.conn) {
      conn.release();
    }

    let result = false;
    switch (rows.length) {
      case 0:
        // Nothing found
        break;

      case 1:
        this.loadDbArray(rows[0]);

        result = true;
        break;

      case 2:
        const warning = 'Multiple results matched load() attempt.';
        if (!this.warnings) {
          this.warnings = [];
        }
        this.warnings.push(warning);
        console.warn(warning);
        break;
    }

    return result;
  }

  async delete() {
    for (const value of this.getPrimaryKeyValues().values()) {
      if (value === undefined || value === null) {
        throw new PrimaryKeyValueMissingError(this.constructor.name);
      }
    }

    const primaryKeyWhereSql = this.getPrimaryKeyWherePack();

    const deleteQuery = [
      'DELETE FROM',
      quoteIdentifier(this.constructor.table),
      'WHERE',
      primaryKeyWhereSql.query,
    ].join(' ');

    if (this.debugging()) {
      console.debug('DELETE', {deleteQuery, deleteValues: primaryKeyWhereSql.values});
    }
    const conn = await this.getConnection();
    const dbResponse = await conn.query({
      text: deleteQuery,
      values: primaryKeyWhereSql.values,
      rowMode: 'array',
    });
    const wasDeleted = dbResponse.rowCount === 1;
    if (!this.conn) {
      conn.release();
    }

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

      const primaryKeyWhereSql = this.getPrimaryKeyWherePack(true, setValues.length);

      let updateQuery = [
        'UPDATE',
        quoteIdentifier(this.constructor.table),
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
      const conn = await this.getConnection();
      const dbResponse = await conn.query({
        text: updateQuery,
        values: updateValues,
        rowMode: 'array',
      });
      if (!this.conn) {
        conn.release();
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
        quoteIdentifier(this.constructor.table),
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

  data({
    fields = null,
    includeDefaults = false,
    includePrivate = false,
    onlyDirty = false,
    onlySet = false,
  } = {}) {
    const object = {};
    for (const field of fields || Object.keys(this.constructor.fields)) {
      const defaultValue = this.constructor.getFieldDefaultValue(field);
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
      for (const privateField of this.constructor.privateFields) {
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
