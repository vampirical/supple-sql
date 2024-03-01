'use strict';
const {quoteIdentifier} = require('./utils/sql');
const path = require('path');
const pFs = require('fs').promises;

/**
 * Run plain sql migration files from a directory.
 * @memberof SQL
 *
 * @param {pg.Pool} pool
 * @param {string} pathToSqlFiles
 */
async function runMigrations(pool, pathToSqlFiles, {migrationTable = 'supple_migrations', quiet = false} = {}) {
  const migrationFiles = (await pFs.readdir(pathToSqlFiles)).filter(p => p.endsWith('.sql')).sort();
  if (!migrationFiles.length) {
    if (!quiet) {
      console.info('Migrations to run: 0');
    }

    return;
  }

  const completedResp = await this.connected(async (conn) => {
    const schemaCheck = await conn.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1", [migrationTable]);
    if (!schemaCheck.rows.length) {
      await conn.query(`CREATE TABLE ${quoteIdentifier(migrationTable)} (key TEXT PRIMARY KEY, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW())`);
    }

    return conn.query(`SELECT key FROM ${quoteIdentifier(migrationTable)}`);
  }, {pool});
  const completedMigrationNames = new Set(completedResp.rows.map(r => r.key));

  const toRunMigrationNames = [];
  for (const migrationFile of migrationFiles) {
    const migrationName = migrationFile.substring(0, migrationFile.length - 4);

    if (!completedMigrationNames.has(migrationName)) {
      toRunMigrationNames.push(migrationName);
    }
  }
  if (!quiet) {
    console.info(`Migrations to run: ${toRunMigrationNames.length}`);
  }

  for (const [toRunIndex, migrationName] of toRunMigrationNames.entries()) {
    const migrationContent = await pFs.readFile(path.join(pathToSqlFiles, migrationName + '.sql'), {encoding: 'utf-8'});

    if (!quiet) {
      const current = String(toRunIndex + 1);
      const max = String(toRunMigrationNames.length);
      console.info(`Running migration ${current.padStart(max.length - current.length, '0')}/${max}: ${migrationName}`);
    }

    await this.transaction(async (conn) => {
      await conn.query(migrationContent);
      await conn.query(`INSERT INTO ${quoteIdentifier(migrationTable)} VALUES ($1)`, [migrationName]);
    }, {pool});
  }
}

module.exports = {
  runMigrations,
};
