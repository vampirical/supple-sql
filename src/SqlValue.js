'use strict';
const {quoteLiteral} = require('./utils/sql');

class SqlValue extends Object {
  value;

  bind;
  quote;

  constructor(value, {bind = false, quote = false} = {}) {
    super();

    this.value = value;

    this.bind = bind;
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
