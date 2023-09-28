'use strict';
const {comparison: comparisonDefs, connective: connectiveDefs, type: typeDefs, valueNotNull, valueNow} = require('./constants');
const {FieldNotFoundError} = require('./errors');
const {getFieldDbName} = require('./utils/misc');
const {quoteIdentifier} = require('./utils/sql');
const SqlValue = require('./SqlValue');

const PARENS_COMPARISONS = new Set([
  comparisonDefs.all,
  comparisonDefs.any,
  comparisonDefs.exists,
  comparisonDefs.in,
  comparisonDefs.notAll,
  comparisonDefs.notAny,
  comparisonDefs.notExists,
  comparisonDefs.notIn,
]);

const TEXT_COMPARISONS = new Set([
  comparisonDefs.ilike,
  comparisonDefs.iregex,
  comparisonDefs.like,
  comparisonDefs.notIlike,
  comparisonDefs.notIregex,
  comparisonDefs.notLike,
  comparisonDefs.notRegex,
  comparisonDefs.notSimilarTo,
  comparisonDefs.regex,
  comparisonDefs.similarTo,
]);

class ConnectedWheres extends Object {
  comparison;
  connective;
  wheres;
}

class And extends ConnectedWheres {
  constructor(wheres, comparison = comparisonDefs.equal) {
    super();

    this.comparison = comparison;
    this.connective = connectiveDefs.and;
    this.wheres = wheres;
  }
}

class Or extends ConnectedWheres {
  constructor(wheres, comparison = comparisonDefs.equal) {
    super();

    this.comparison = comparison;
    this.connective = connectiveDefs.or;
    this.wheres = wheres;
  }
}

function getWhereSql(
  conn,
  recordName,
  fieldDefinitions,
  wheres,
  {comparison = null, connective = connectiveDefs.and, bindParamsUsed = 0} = {}
) {
  // Grouped handling
  const isConnectedWheres = wheres instanceof ConnectedWheres;
  const isWhereGroup = isConnectedWheres || Array.isArray(wheres); // Top level arrays are treated as an And() as a special case, arrays are not generally And()s.
  if (isWhereGroup) {
    // Array
    let connectedWheres = wheres;
    let groupConnective = connective;

    if (isConnectedWheres) {
      connectedWheres = wheres.wheres;
      groupConnective = wheres.connective;
    }

    const queryParts = [];
    const values = [];
    for (const where of connectedWheres) {
      const currentPack = getWhereSql(
        conn,
        recordName,
        fieldDefinitions,
        where,
        {
          comparison: where.comparison || comparison,
          bindParamsUsed: bindParamsUsed + values.length
        }
      );

      let queryPart = currentPack.query;
      if (where instanceof ConnectedWheres || Array.isArray(where) || Object.keys(where).length > 1) {
        // The Object.keys() check might result in false positives here but they're harmless.
        queryPart = `(${queryPart})`;
      }
      queryParts.push(queryPart);

      Array.prototype.push.apply(values, currentPack.values);
    }
    const query = queryParts.join(` ${groupConnective.toUpperCase()} `);

    return {query, values};
  }
  // Ungrouped handling

  // We now know that these represent simple fields.
  const fields = typeof wheres.entries === 'function' ? wheres.entries() : Object.entries(wheres);

  const sqlConnective = ` ${connective.toUpperCase()} `;

  let queryParts = [];
  const values = [];
  for (const [key, value] of fields) {
    const fieldDefinition = fieldDefinitions[key];
    if (!fieldDefinition) {
      throw new FieldNotFoundError(key, recordName);
    }

    if (value === undefined) {
      console.warn(`Skipped undefined value for ${key} while processing wheres for ${recordName}`);

      continue;
    }

    let valuesToProcess;
    let currentSqlConnective = sqlConnective;
    if (value instanceof ConnectedWheres) {
      // Connective used as a value.
      // TODO NEXT HERE We need to make this block basically look the same as the grouped handled block above in order to supported nested connectives. Do it as copy pasta first and then see if it is worth util-ing.
      valuesToProcess = value.wheres;
      currentSqlConnective = ` ${value.connective.toUpperCase()} `;
    } else {
      valuesToProcess = [value];
    }

    const currentQueryParts = [];
    for (const valueToProcess of valuesToProcess) {
      const columnSql = getColumnWhereSql(
        conn,
        recordName,
        fieldDefinitions,
        key,
        valueToProcess,
        {comparison}
      );

      let sqlLhs = columnSql.lhs;
      const sqlComparison = columnSql.comparison || comparisonDefs.equal;

      if (TEXT_COMPARISONS.has(sqlComparison) && fieldDefinition.type !== typeDefs.text) {
        sqlLhs += '::text';
      }

      let sqlRhs = columnSql.rhs;
      if (sqlRhs === null) {
        const bindCount = columnSql.values.length;
        const useParens = bindCount > 1 || PARENS_COMPARISONS.has(sqlComparison);
        if (useParens) {
          sqlRhs = `(${Array.from(Array(bindCount)).map((_, i) => '$' + (bindParamsUsed + values.length + 1 + i)).join(', ')})`;
        } else {
          sqlRhs = `$${bindParamsUsed + values.length + 1}`;
        }
      }

      const queryPart = `${sqlLhs} ${sqlComparison} ${sqlRhs}`;

      // console.log({key, value, columnSql, queryPart});

      currentQueryParts.push(queryPart);
      Array.prototype.push.apply(values, columnSql.values);
    }

    let currentQuery = currentQueryParts.join(currentSqlConnective);
    if (valuesToProcess.length > 1) {
      currentQuery = `(${currentQuery})`;
    }

    queryParts.push(currentQuery);
  }

  const outputQueryParts = queryParts.filter(Boolean);
  const query = outputQueryParts.length ? outputQueryParts.join(sqlConnective) : 'true'; // Fallback for all undefined and similar NOP where.

  return {query, values};
}

function getColumnWhereSql(conn, recordName, fieldDefinitions, key, value, {comparison = null} = {}) {
  let lhs = quoteIdentifier(getFieldDbName(fieldDefinitions, key));
  let rhs = null;
  let values = [];

  let outputComparison = comparison;
  if (!outputComparison || outputComparison === comparisonDefs.equal) {
    // Splitting between comparison and rhs just makes the spacing in the final query nice.
    if (value === null) {
      return {lhs, comparison: 'IS', rhs: 'NULL', values};
    } else if (value === valueNotNull) {
      return {lhs, comparison: 'IS NOT', rhs: 'NULL', values};
    }
  }

  const isSet = value instanceof Set;

  if (typeof value === 'symbol') {
    rhs = value.description;
  } else if (Array.isArray(value) || isSet) {
    const array = isSet ? Array.from(value) : value;
    if (array.length) {
      outputComparison = comparisonDefs.in;
      values = array;
    } else {
      // Explicitly don't match any rows when dealing with an empty array instead of erroring on the empty IN.
      lhs = 'true';
      outputComparison = comparisonDefs.equal;
      rhs = 'false';
    }
  } else if (value instanceof SqlValue) {
    outputComparison = value.comparison || comparisonDefs.equal;

    const actualValue = value.getValue();
    if (value.bind) {
      if (PARENS_COMPARISONS.has(outputComparison) && (Array.isArray(actualValue) || actualValue instanceof Set)) {
        if (actualValue instanceof Set) {
          for (const subValue of actualValue) {
            values.push(subValue);
          }
        } else {
          Array.prototype.push.apply(values, actualValue);
        }
      } else if (actualValue && typeof actualValue.getSql === 'function') {
        const sqlPack = actualValue.getSql(conn, {isSubquery: true});

        outputComparison = sqlPack.comparison || outputComparison;
        rhs = `(${sqlPack.query})`;
        values = sqlPack.values;
      } else {
        values.push(actualValue);
      }
    } else {
      rhs = actualValue;
    }
  } else if (value && typeof value.getSql === 'function') { // RecordQuery or custom implementor.
    const sqlPack = value.getSql(conn, {isSubquery: true});

    outputComparison = sqlPack.comparison || comparisonDefs.in;
    rhs = `(${sqlPack.query})`;
    values = sqlPack.values;
  } else {
    outputComparison = comparison || comparisonDefs.equal;
    values.push(value);
  }

  return {lhs, comparison: outputComparison, rhs, values};
}

module.exports = {ConnectedWheres, And, Or, getWhereSql};
