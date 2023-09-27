'use strict';

function toCamel(s) {
  return s.replace(/[-_ ]([a-zA-Z])/g, (match, $1) => {
    return $1.toUpperCase();
  });
}

function toSnake(s) {
  let result = String(s);
  result = result.slice(0, 1).toLowerCase() + result.slice(1);
  return result.replace(/([A-Z])/g, (c) => {
    return '_' + c.toLowerCase();
  });
}

module.exports = {
  toCamel,
  toSnake,
};
