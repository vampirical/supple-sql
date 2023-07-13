/* eslint-disable no-console */
const {connectiveAnd, type, valueNotNull, valueNow} = require('./constants');
const {
  FieldNotFoundError,
  IncorrectFieldsError,
  PrimaryKeyValueMissingError,
  RecordMissingPrimaryKeyError,
} = require('./errors');
const SqlValue = require('./SqlValue');
const {ConnectedWheres, Or} = require('./wheres');
const {processArgs} = require('./utils/args');
const {toSnake} = require('./utils/case');
const {quoteIdentifier} = require('./utils/sql');
const equal = require('fast-deep-equal');

function formatOrderBy(instance, orderBy) {
  return instance.getFieldDbName(orderBy[0]) + ' ' + orderBy[1].toUpperCase();
}

class Record extends Object {
  static fields = {};
  static primaryKeyFields = [];
  static privateFields = []; // Require an extra hoop to extract these values.
  static table = '';

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

  static async getByPrimaryKey(...args) {
    return this.findOne(...args);
  }

  static async deleteByPrimaryKey(...args) {
    return this.deleteOne(...args);
  }

  static async find(...args) {
    const type = this.prototype.constructor;
    const instance = new type();
    const processedArgs = processArgs(instance, args);
    const wheres = processedArgs[0];
    if (!wheres) {
      throw new Error(
        'Where conditions are required as an argument, empty object or array is allowed.'
      );
    }
    const optional = processedArgs[1] ?? {};
    const {limit = null, offset = null, orderBy = null} = optional;

    const wherePack = instance.getWherePack(wheres);

    const orderByParts = [];
    if (orderBy && orderBy.length) {
      const hasMultiple = Array.isArray(orderBy[0]);
      if (hasMultiple) {
        for (const element of orderBy) {
          orderByParts.push(formatOrderBy(instance, element));
        }
      } else {
        orderByParts.push(formatOrderBy(instance, orderBy));
      }
    }
    const orderByString = orderByParts.length ? 'ORDER BY ' + orderByParts.join(', ') : null;

    let limitString = null;
    const hasLimit = limit !== null;
    const hasOffset = offset !== null;
    if (hasLimit || hasOffset) {
      const limitParts = [];
      if (hasLimit) {
        limitParts.push(`LIMIT ${limit}`);
      }
      if (hasOffset) {
        limitParts.push(`OFFSET ${offset}`);
      }
      limitString = limitParts.join(' ');
    }

    const query = [
      'SELECT * FROM',
      quoteIdentifier(type.table),
      wherePack.sqlString ? 'WHERE' : null,
      wherePack.sqlString,
      orderByString,
      limitString,
    ]
      .filter(Boolean)
      .join(' ');

    if (type.debug) {
      console.debug('FIND', {query, values: wherePack.values});
    }

    const conn = await instance.getConnection();
    const dbResponse = await conn.query({
      text: query,
      values: wherePack.values,
      rowMode: 'object',
    });
    const rows = dbResponse.rows;
    if (!instance.conn) {
      conn.release();
    }

    return rows.map((row) => {
      const rowInstance = new type();
      processArgs(rowInstance, args);
      rowInstance.loadDbObject(row);

      return rowInstance;
    });
  }

  static async getFromDbRow(...args) {
    // Assumes external callers are generally going to be using the default object row mode.

    const type = this.prototype.constructor;
    const instance = new type();

    const processedArgs = processArgs(instance, args);
    const row = processedArgs[0];
    if (!row) {
      throw new Error('Row is required as an argument.');
    }

    instance.loadDbObject(row);

    return instance;
  }

  debug = false;

  conn = null;
  pool = null;

  data = {};
  dataClean = {};

  isFieldSet = {};

  isLoaded = false;
  primaryKeyInternalValues = {};

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

    return new Proxy(this, {
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
      try {
        conn = await this.pool.connect();
      } catch (err) {
        console.error(err);

        if (conn) {
          conn.release();
        }

        throw err;
      }
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
    let current = this.data[key] ?? null;
    if (current instanceof Date) {
      current = current.toISOString();
    }

    let clean = this.dataClean[key] ?? null;
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

      this.dataClean = {...this.data};
    } else {
      this.dataClean = {};
    }

    this.isLoaded = isLoaded;
  }

  getFieldDbName(key) {
    const fieldConfig = this.constructor.fields[key];
    if (fieldConfig && fieldConfig.name) {
      // Explicitly specified.

      return fieldConfig.name;
    }

    return toSnake(key);
  }

  getFieldDefaultValue(key) {
    const fieldConfig = this.constructor.fields[key];
    if (
      fieldConfig &&
      fieldConfig.defaultValue !== undefined &&
      fieldConfig.defaultValue !== valueNow // Handled by the db.
    ) {
      return fieldConfig.defaultValue;
    }

    return undefined;
  }

  getWherePack(wheres, connective = connectiveAnd, bindParamsUsed = 0) {
    // Grouped handling
    const isConnectedWheres = wheres instanceof ConnectedWheres;
    const isWhereGroup = isConnectedWheres || Array.isArray(wheres);
    if (isWhereGroup) {
      let connectedWheres = wheres;
      let groupConnective = connective;
      if (isConnectedWheres) {
        const child = wheres.wheres;
        const isChildWhereGroup = child instanceof ConnectedWheres || Array.isArray(child);
        connectedWheres = isChildWhereGroup ? child : [child];
        groupConnective = wheres.connective;
      }

      const groupConnectiveSql = [' ', groupConnective.description, ' '].join('');

      let sqlString = '';
      const values = [];
      for (const where of connectedWheres) {
        const currentPack = this.getWherePack(where, undefined, bindParamsUsed + values.length);

        if (sqlString !== '') {
          sqlString += groupConnectiveSql;
        }
        sqlString += currentPack.sqlString;

        Array.prototype.push.apply(values, currentPack.values);
      }

      return {sqlString, values};
    }

    // We now know that these represent simple fields.
    const fields = typeof wheres.entries === 'function' ? wheres.entries() : Object.entries(wheres);

    let sqlString = '';
    const values = [];

    const connectiveSql = [' ', connective.description, ' '].join('');

    for (const [key, value] of fields) {
      if (!this.constructor.fields[key]) {
        throw new FieldNotFoundError(key, this.constructor.name);
      }

      let sqlLhs = quoteIdentifier(this.getFieldDbName(key));

      let sqlComparison;
      if (value === true) {
        sqlComparison = '= TRUE';
      } else if (value === false) {
        sqlComparison = '= FALSE';
      } else if (value === null) {
        sqlComparison = 'IS NULL';
      } else if (value === valueNotNull) {
        sqlComparison = 'IS NOT NULL';
      } else if (value === valueNow) {
        sqlComparison = '= ' + valueNow.description;
      } else if (value instanceof SqlValue) {
        const actualValue = value.getValue();
        if (value.bind) {
          sqlComparison = '= $' + bindParamsUsed + values.length + 1;
          values.push(actualValue);
        } else {
          sqlComparison = '= ' + actualValue;
        }
      } else if (value instanceof Or) {
        const orPack = this.getWherePack(value, undefined, bindParamsUsed + values.length);

        if (sqlString !== '') {
          sqlString += connectiveSql;
        }
        sqlString += orPack.sqlString;

        Array.prototype.push.apply(values, orPack.values);

        continue;
      } else if (Array.isArray(value) || value instanceof Set) {
        const array = value instanceof Set ? Array.from(value) : value;

        if (array.length) {
          sqlComparison =
            'IN (' +
            Array.from(Array(array.length))
              .map((_, i) => '$' + (bindParamsUsed + values.length + 1 + i))
              .join(', ') +
            ')';
          Array.prototype.push.apply(values, array);
        } else {
          // Explicitly don't match any rows when dealing with an empty array instead of erroring on the empty IN.
          sqlLhs = 'true';
          sqlComparison = '= false';
        }
      } else {
        sqlComparison = '= $' + (bindParamsUsed + values.length + 1);
        values.push(value);
      }

      if (sqlString !== '') {
        sqlString += connectiveSql;
      }
      sqlString += sqlLhs + ' ' + sqlComparison;
    }

    return {sqlString, values};
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
    return this.getWherePack(
      this.getPrimaryKeyValues(useInternalValues),
      connectiveAnd,
      bindParamsUsed
    );
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

    return this.data[key];
  }

  set(key, value) {
    if (!this.constructor.fields[key]) {
      throw new FieldNotFoundError(key, this.constructor.name);
    }

    this.data[key] = value;
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
    const wherePack = this.getWherePack(defaultedFields);

    const loadQuery = [
      'SELECT',
      selectFieldsSql,
      'FROM',
      quoteIdentifier(this.constructor.table),
      'WHERE',
      wherePack.sqlString,
      'LIMIT 2',
    ].join(' ');

    const conn = await this.getConnection();
    if (this.debug) {
      console.debug('LOAD', {loadQuery, loadValues: wherePack.values});
    }
    const dbResponse = await conn.query({
      text: loadQuery,
      values: wherePack.values,
      rowMode: 'array',
    });
    const rows = dbResponse.rows;
    if (!this.conn) {
      conn.release();
    }

    let result = false;
    switch (rows.length) {
      default:
      case 0:
        // Nothing found
        break;

      case 2:
        console.warn('Multiple results matched load() attempt.');
        break;

      case 1:
        this.loadDbArray(rows[0]);

        result = true;
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

    const primaryKeyWherePack = this.getPrimaryKeyWherePack();

    const deleteQuery = [
      'DELETE FROM',
      quoteIdentifier(this.constructor.table),
      'WHERE',
      primaryKeyWherePack.sqlString,
    ].join(' ');

    if (this.debug) {
      console.debug('DELETE', {deleteQuery, deleteValues: primaryKeyWherePack.values});
    }
    const conn = await this.getConnection();
    const dbResponse = await conn.query({
      text: deleteQuery,
      values: primaryKeyWherePack.values,
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
      if (value === valueNow) {
        string = valueNow.description;
        bind = false;
      } else if (value instanceof SqlValue) {
        string = value.getValue();
        bind = value.bind;
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
    if (this.isLoaded) {
      const setStrings = [];
      const setValues = [];
      const sqlFields = this.getSqlFields(this.getObject({includePrivate: true, onlyDirty: true}));
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

      const primaryKeyWherePack = this.getPrimaryKeyWherePack(true, setValues.length);

      let updateQuery = [
        'UPDATE',
        quoteIdentifier(this.constructor.table),
        'SET',
        setString,
        'WHERE',
        primaryKeyWherePack.sqlString,
      ].join(' ');
      if (!skipReload) {
        updateQuery += ' RETURNING ' + this.getFieldsSql();
      }
      const updateValues = [...setValues, ...primaryKeyWherePack.values];

      if (this.debug) {
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
        this.getObject({includeDefaults: true, includePrivate: true, onlyDirty: true})
      );
      for (const sqlField of Object.values(sqlFields)) {
        insertFields.push(sqlField.name);
        insertValueStrings.push(sqlField.string);
        if (sqlField.bind) {
          insertValues.push(sqlField.bindValue);
        }
      }
      if (!insertFields) {
        return false; // Nothing to insert.
      }

      const valuesString = insertValues.length
        ? 'VALUES (' + insertValueStrings.join(', ') + ')'
        : 'DEFAULT VALUES';

      let insertQuery = [
        'INSERT INTO',
        quoteIdentifier(this.constructor.table),
        '(',
        insertFields.join(', '),
        ')',
        valuesString,
      ].join(' ');
      if (ignoreConflict) {
        insertQuery += ' ON CONFLICT DO NOTHING';
      }
      if (!skipReload) {
        insertQuery += ' RETURNING ' + this.getFieldsSql();
      }

      if (this.debug) {
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
    Object.assign(this, fields);
    this.setLoaded(true, true);
  }

  getObject({
    fields = null,
    includeDefaults = false,
    includePrivate = false,
    onlyDirty = false,
    onlySet = false,
  } = {}) {
    const object = {};
    for (const field of fields || Object.keys(this.constructor.fields)) {
      const defaultValue = this.getFieldDefaultValue(field);
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
    return this.getObject();
  }
}

module.exports = Record;
