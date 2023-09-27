'use strict';
const {quoteLiteral} = require('./utils/sql');

/**
 * @typedef {Object} SqlValue
 * @memberOf SQL
 */
class SqlValue extends Object {
  value;

  bind;
  comparison;
  quote;

  /**
   * Create a SqlValue that species how a value should be used within queries.
   *
   * @param {*} value
   * @param bind
   * @param comparison
   * @param quote
   */
  constructor(value, {bind = false, comparison = null, quote = false} = {}) {
    super();

    this.value = value;

    this.bind = bind;
    this.comparison = comparison;
    this.quote = quote;
  }

  getValue() {
    let value = this.value;
    if (this.quote) {
      value = quoteLiteral(value);
    }

    return value;
  }
}

module.exports = SqlValue;
