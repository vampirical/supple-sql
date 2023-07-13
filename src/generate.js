/* eslint-disable no-console */

const {parseArgs} = require('./utils/args');
const {toCamel, toSnake} = require('./utils/case');
const SQL = require('./index');

const infoQueryTable = `
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default,
  udt_name,
  CASE
    WHEN EXISTS(
      SELECT 1 FROM
        information_schema.constraint_column_usage k
        INNER JOIN information_schema.table_constraints d ON
          d.table_schema = c.table_schema AND
          d.table_name = c.table_name AND
          d.constraint_schema = k.constraint_schema AND
          d.constraint_name = k.constraint_name AND 
          d.constraint_type = 'PRIMARY KEY'
      WHERE
        k.table_schema = c.table_schema AND 
        k.table_name = c.table_name AND
        k.column_name = c.column_name 
    ) THEN true
    ELSE false
  END is_primary_key
FROM
  information_schema.columns c
WHERE
  table_schema = $1 AND
  table_name = $2
ORDER BY ordinal_position
`;

async function generateRecord(...originalArgs) {
  const {connOrPool, args} = parseArgs(originalArgs);
  const conn = connOrPool || require('./index').getDefaultPool();

  const tableName = args[0];
  if (!tableName) {
    throw new Error('Table name arg is required.');
  }
  const schemaName = args[1] || 'public';

  const tableResp = await conn.query({
    text: infoQueryTable,
    values: [schemaName, tableName],
    rowMode: 'object',
  });

  const columns = [];
  for (const [index, row] of tableResp.rows.entries()) {
    const name = row.column_name;
    const key = toCamel(name);

    let type = row.data_type;
    const hasNicerUdtName = type.indexOf('timestamp') !== -1;
    if (hasNicerUdtName) {
      type = row.udt_name;
    }

    const nullable = row.is_nullable === 'YES';

    let defaultValue = null;
    const defaultString = String(row.column_default);
    if (/^nextval\(/.test(defaultString)) {
      defaultValue = null; // Serial type handling is responsible not defaultValue.
    } else if (defaultString && defaultString !== 'null') {
      defaultValue = row.column_default;
    }

    columns.push({
      index,
      key,
      name,
      type,
      nullable,
      defaultValue,
      isPrimaryKey: row.is_primary_key,
    });
  }

  const specialSorts = {
    id: -Number.MAX_SAFE_INTEGER,
    key: -(Number.MAX_SAFE_INTEGER - 1),
    createdAt: Number.MAX_SAFE_INTEGER - 3,
    updatedAt: Number.MAX_SAFE_INTEGER - 2,
    deletedAt: Number.MAX_SAFE_INTEGER - 1,
  };
  columns.sort((a, b) => {
    const aI = specialSorts[a.key] || a.index;
    const bI = specialSorts[b.key] || b.index;
    return aI - bI;
  });

  const fields = {};
  const primaryKeyFields = [];
  for (const column of columns) {
    const {key, name, type, nullable, defaultValue, isPrimaryKey} = column;

    const field = {
      type: `SQL.type.${type}`,
    };

    if (name !== key && name !== toSnake(key)) {
      field.name = name;
    }
    if (!nullable) {
      field.nullable = false;
    }
    if (defaultValue) {
      field.defaultValue = defaultValue;
    }

    if (isPrimaryKey) {
      primaryKeyFields.push(key);
    }

    fields[key] = field;
  }

  let className = toCamel(tableName.replace(/s$/, ''));
  className = className.charAt(0).toUpperCase() + className.slice(1); // First upper.

  let fieldsString = '';
  for (const [key, field] of Object.entries(fields)) {
    if (fieldsString !== '') {
      fieldsString += ',\n';
    }
    fieldsString += `    ${key}: {type: ${field.type}`;
    if (field.name) {
      fieldsString += `, name: ${JSON.stringify(field.name)}`;
    }
    if (field.nullable !== undefined && !field.nullable) {
      fieldsString += `, nullable: ${field.nullable}`;
    }
    if (field.defaultValue) {
      fieldsString += `, defaultValue: ${
        field.defaultValue &&
        `symbol(${field.defaultValue.toLowerCase()})` === String(SQL.valueNow).toLowerCase()
          ? 'SQL.valueNow'
          : JSON.stringify(field.defaultValue)
      }`;
    }
    fieldsString += '}';
  }
  fieldsString = `{\n${fieldsString}\n  }`;

  const content = `class ${className} extends SQL.Record {
  static fields = ${fieldsString};
  static primaryKeyFields = [${primaryKeyFields.map((s) => JSON.stringify(s)).join(', ')}];
  static table = ${JSON.stringify(tableName)};
}`;

  const filename = `${className}.js`;

  return {content, filename};
}

module.exports = {
  generateRecord,
};
