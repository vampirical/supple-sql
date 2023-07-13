function toCamel(s) {
  return s.replace(/[ -_]([a-zA-Z])/g, (match, $1) => {
    return $1.toUpperCase();
  });
}

function toSnake(s) {
  const result = s;
  result[0] = result[0].toLowerCase();
  return result.replace(/([A-Z])/g, (c) => {
    return '_' + c.toLowerCase();
  });
}

function camelifyObject(obj) {
  const newObj = {};
  for (const key of Object.keys(obj)) {
    newObj[toCamel(key)] = obj[key];
  }
  return newObj;
}

module.exports = {
  toCamel,
  toSnake,

  camelifyObject,
};
