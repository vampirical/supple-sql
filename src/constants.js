const codeStatementTimeout = '57014'; // Technically 57014 is all "query_canceled" but the only reason we expect to see it is a statement_timeout.

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

const connectiveAnd = Symbol('AND');
const connectiveOr = Symbol('OR');

const valueNotNull = Symbol('NOT NULL');
const valueNow = Symbol('NOW()');

module.exports = {
  codeStatementTimeout,
  connectiveAnd,
  connectiveOr,
  quoteIdentifier,
  sort,
  type,
  valueNotNull,
  valueNow,
};
