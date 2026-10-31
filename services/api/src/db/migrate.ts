import pg from 'pg';

import { requireDatabaseUrl } from '../config.ts';
import { MigrationError, findRepoRoot, loadMigrations, type Migration } from './migrations.ts';
import { createPool } from './pool.ts';

const { Client } = pg;

export async function applyMigrations(connectionString: string, migrations = loadMigrations(findRepoRoot())): Promise<string[]> {
  const client = new Client({
    connectionString,
    ssl: new URL(connectionString).hostname === '127.0.0.1' || new URL(connectionString).hostname === 'localhost'
      ? undefined
      : { rejectUnauthorized: true },
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query('SELECT pg_advisory_xact_lock(1397900112, 1)');
    await client.query(`CREATE SCHEMA IF NOT EXISTS supermarket;
      REVOKE ALL ON SCHEMA supermarket FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS supermarket.schema_migrations(
        version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
        rollback_checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      );
      REVOKE ALL ON supermarket.schema_migrations FROM PUBLIC;`);
    const applied = await appliedVersions(client, migrations);
    const pending = migrations.slice(applied.length);
    for (const migration of pending) {
      await client.query(migration.forward);
      await client.query(
        `INSERT INTO supermarket.schema_migrations(version, name, checksum, rollback_checksum)
         VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.name, migration.checksum, migration.rollbackChecksum],
      );
    }
    await client.query('COMMIT');
    return pending.map((migration) => migration.version);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof MigrationError) throw error;
    throw new MigrationError('MIGRATION_FAILED', { cause: error });
  } finally {
    await client.end();
  }
}

async function appliedVersions(client: pg.Client, migrations: Migration[]): Promise<string[]> {
  const rows = await client.query<{
    version: string;
    name: string;
    checksum: string;
    rollback_checksum: string;
  }>('SELECT version, name, checksum, rollback_checksum FROM supermarket.schema_migrations');
  const expected = new Map(migrations.map((migration) => [migration.version, migration]));
  const recorded = [...rows.rows].sort((left, right) => Number(left.version) - Number(right.version));
  for (const row of recorded) {
    const migration = expected.get(row.version);
    if (!migration) throw new MigrationError('MIGRATION_HISTORY_DIVERGED');
    if (
      row.name !== migration.name ||
      row.checksum !== migration.checksum ||
      row.rollback_checksum !== migration.rollbackChecksum
    ) {
      throw new MigrationError('MIGRATION_DRIFT');
    }
  }
  const versions = recorded.map((row) => row.version);
  const prefix = migrations.slice(0, versions.length).map((migration) => migration.version);
  if (versions.join(',') !== prefix.join(',')) throw new MigrationError('MIGRATION_HISTORY_DIVERGED');
  return versions;
}

export async function migrateFromEnv(env: NodeJS.ProcessEnv): Promise<string[]> {
  return applyMigrations(requireDatabaseUrl(env));
}

export { createPool };
