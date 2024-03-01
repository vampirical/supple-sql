'use strict';
const pg = require('pg');

function parseArgs(origArgs) {
  const result = {conn: null, pool: null, connOrPool: null, args: origArgs};

  const connOrPool = origArgs[0];
  if (connOrPool) {
    const connOrPoolTypeName = connOrPool.constructor?.name;
    if (connOrPool instanceof pg.Client || connOrPoolTypeName === 'Client' || typeof connOrPool._connected !== 'undefined') {
      result.conn = connOrPool;
      result.connOrPool = connOrPool;
      result.args = origArgs.slice(1);

      return result;
    } else if (connOrPool instanceof pg.Pool || connOrPoolTypeName === 'BoundPool' || typeof connOrPool.Client !== 'undefined') {
      result.pool = connOrPool;
      result.connOrPool = connOrPool;
      result.args = origArgs.slice(1);

      return result;
    }
  }

  return result;
}

module.exports = {
  parseArgs,
};
