'use strict';

const codeStatementTimeout = '57014'; // Technically 57014 is all "query_canceled" but the only reason we expect to see it is a statement_timeout.

const comparison = {
  all: 'ALL',
  any: 'ANY',
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

const connective = {
  and: 'and',
  or: 'or',
};

const outputType = {
  object: 'object',
  record: 'record',
  value: 'value',
};

const quoteIdentifier = '"';

const sort = {
  asc: 'asc',
  desc: 'desc',
};

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

const valueNotNull = Symbol('NOT NULL');
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
