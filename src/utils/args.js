const pg = require('pg');

function parseArgs(origArgs) {
  const result = {conn: null, pool: null, connOrPool: null, args: origArgs};

  const connOrPool = origArgs[0];
  if (connOrPool instanceof pg.Client) {
    result.conn = connOrPool;
    result.connOrPool = connOrPool;
    result.args = origArgs.slice(1);

    return result;
  } else if (connOrPool instanceof pg.Pool) {
    result.pool = connOrPool;
    result.connOrPool = connOrPool;
    result.args = origArgs.slice(1);

    return result;
  }

  return result;
}

function processArgs(connReceiver, origArgs) {
  const parsed = parseArgs(origArgs);

  if (parsed.conn) {
    connReceiver.setConnection(parsed.conn);
  } else if (parsed.pool) {
    connReceiver.setPool(parsed.pool);
  }
  if (!connReceiver.conn && !connReceiver.pool) {
    connReceiver.setPool(require('../index').getDefaultPool());
  }

  return parsed.args;
}

module.exports = {
  parseArgs,
  processArgs,
};
