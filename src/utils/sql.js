const {quoteIdentifier: Q} = require('../constants');
const pgFormat = require('pg-format');

function quoteIdentifier(identifier) {
  return Q + identifier + Q;
}

function quoteLiteral(literal) {
  return pgFormat.literal(literal);
}

module.exports = {
  quoteIdentifier,
  quoteLiteral,
};
