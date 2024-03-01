'use strict';
const {MissingRequiredArgError, RecordTypeRequiredError} = require('./errors');
const {Transform} = require('stream');

class RecordTransform extends Transform {
  recordType = null;

  conn = null;
  pool = null;

  constructor(options = {}) {
    if (!options.recordType) {
      throw new RecordTypeRequiredError();
    }

    const mergedOptions = {
      autoDestroy: false,
      highWaterMark: 3,
      objectMode: true,
      ...options,
    };

    super(mergedOptions);

    this.recordType = mergedOptions.recordType;

    if (mergedOptions.conn) {
      this.conn = mergedOptions.conn;
    }
    if (mergedOptions.pool) {
      this.pool = mergedOptions.pool;
    }

    if (!(this.conn || this.pool)) {
      throw new MissingRequiredArgError('A conn or pool is required.');
    }
  }

  _transform(data, encoding, callback) {
    const connOrPool = this.conn || this.pool;

    const recordInstance = new this.recordType(connOrPool);
    recordInstance.loadDbObject(data);

    callback(null, recordInstance);
  }
}

module.exports = RecordTransform;
