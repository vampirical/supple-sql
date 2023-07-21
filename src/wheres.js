'use strict';
const {connectiveAnd, connectiveOr} = require('./constants');

class ConnectedWheres extends Object {}

class And extends ConnectedWheres {
  constructor(wheres, connective = connectiveAnd) {
    super();

    this.wheres = wheres;
    this.connective = connective;
  }
}

class Or extends ConnectedWheres {
  constructor(wheres, connective = connectiveOr) {
    super();

    this.wheres = wheres;
    this.connective = connective;
  }
}

module.exports = {ConnectedWheres, And, Or};
