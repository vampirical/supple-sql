'use strict';
const {quoteLiteral} = require('./utils/sql');

class SqlValue extends Object {
  value;

  bind;
  comparison;
  quote;

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
