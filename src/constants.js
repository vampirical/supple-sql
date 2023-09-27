'use strict';

const codeStatementTimeout = '57014'; // Technically 57014 is all "query_canceled" but the only reason we expect to see it is a statement_timeout.

/**
 * @typedef {Object} comparison
 * @memberOf SQL
 *
 * @property {string} all
 * @property {string} any
 * @property {string} distinctFrom
 * @property {string} equal
 * @property {string} exists
 * @property {string} greater
 * @property {string} greaterEqual
 * @property {string} ilike
 * @property {string} in
 * @property {string} iregex
 * @property {string} less
 * @property {string} lessEqual
 * @property {string} like
 * @property {string} notAll
 * @property {string} notAny
 * @property {string} notDistinctFrom
 * @property {string} notEqual
 * @property {string} notExists
 * @property {string} notIlike
 * @property {string} notIn
 * @property {string} notIregex
 * @property {string} notLike
 * @property {string} notRegex
 * @property {string} notSimilarTo
 * @property {string} notUnknown
 * @property {string} regex
 * @property {string} similarTo
 * @property {string} unknown
 */
const comparison = {
  all: '= ALL',
  any: '= ANY',
  distinctFrom: 'IS DISTINCT FROM',
  equal: '=',
  exists: 'EXISTS',
  greater: '>',
  greaterEqual: '>=',
  ilike: 'ILIKE',
  in: 'IN',
  iregex: '~*',
  less: '<',
  lessEqual: '<=',
  like: 'LIKE',
  notAll: '!= ALL',
  notAny: '!= ANY',
  notDistinctFrom: 'IS NOT DISTINCT FROM',
  notEqual: '!=',
  notExists: 'NOT EXISTS',
  notIlike: 'NOT ILIKE',
  notIn: 'NOT IN',
  notIregex: '!~*',
  notLike: 'NOT LIKE',
  notRegex: '!~',
  notSimilarTo: 'NOT SIMILAR TO',
  notUnknown: 'IS NOT UNKNOWN',
  regex: '~',
  similarTo: 'SIMILAR TO',
  unknown: 'IS UNKNOWN',
};

/**
 * @typedef {Object} connective
 * @memberOf SQL
 *
 * @property {string} and
 * @property {string} or
 */
const connective = {
  and: 'and',
  or: 'or',
};

/**
 * @typedef {Object} outputType
 * @memberOf SQL
 *
 * @property {string} object - Plain Javascript object.
 * @property {string} record - SQL.Record
 * @property {string} value - Scalar value.
 */
const outputType = {
  object: 'object',
  record: 'record',
  value: 'value',
};

const quoteIdentifier = '"';

/**
 * @typedef {Object} sort
 * @memberOf SQL
 *
 * @property {string} asc - Ascending (default).
 * @property {string} desc - Descending.
 */
const sort = {
  asc: 'asc',
  desc: 'desc',
};

/**
 * @typedef {Object} type
 * @memberOf SQL
 *
 * @property {string} bigint
 * @property {string} bigserial
 * @property {string} boolean
 * @property {string} bytea
 * @property {string} date
 * @property {string} double
 * @property {string} integer
 * @property {string} interval
 * @property {string} json
 * @property {string} jsonb
 * @property {string} real
 * @property {string} smallint
 * @property {string} smallserial
 * @property {string} serial
 * @property {string} text
 * @property {string} time
 * @property {string} timetz
 * @property {string} timestamp
 * @property {string} timestamptz
 * @property {string} tsquery
 * @property {string} tsvector
 * @property {string} uuid
 */
const type = {
  bigint: 'bigint',
  bigserial: 'bigserial',
  boolean: 'boolean',
  bytea: 'bytea',
  date: 'date',
  double: 'double',
  integer: 'integer',
  interval: 'interval',
  json: 'json',
  jsonb: 'jsonb',
  real: 'real',
  smallint: 'smallint',
  smallserial: 'smallserial',
  serial: 'serial',
  text: 'text',
  time: 'time',
  timetz: 'timetz',
  timestamp: 'timestamp',
  timestamptz: 'timestamptz',
  tsquery: 'tsquery',
  tsvector: 'tsvector',
  uuid: 'uuid',
};

/**
 * Value NOT NULL
 * @memberOf SQL
 * @type {symbol}
 */
const valueNotNull = Symbol('NOT NULL');

/**
 * Value NOW()
 * @memberOf SQL
 * @type {symbol}
 */
const valueNow = Symbol('NOW()');

module.exports = {
  codeStatementTimeout,
  comparison,
  connective,
  outputType,
  quoteIdentifier,
  sort,
  type,
  valueNotNull,
  valueNow,
};
