'use strict';
const {toSnake} = require('./case');
const {sort} = require('../constants');

function formatOrderBy(fieldDefinitions, orderBy) {
  let key = orderBy;
  let sortOrder = sort.asc;
  if (Array.isArray(key)) {
    key = orderBy[0];
    if (orderBy.length > 1) {
      sortOrder = String(orderBy[1]).toUpperCase();
    }
  }
  return getFieldDbName(fieldDefinitions, key) + ' ' + sortOrder;
}

function getFieldDbName(fieldDefinitions, key) {
  const fieldConfig = fieldDefinitions[key];
  if (fieldConfig && fieldConfig.name) {
    // Explicitly specified.

    return fieldConfig.name;
  }

  return toSnake(key);
}

module.exports = {
  formatOrderBy,
  getFieldDbName,
};
