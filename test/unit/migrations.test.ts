import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { MigrationError, loadMigrations } from '../../src/db/migrations.ts';

test('a migration without a rollback file is refused', () => {
  const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../Temp/migration-missing-rollback');
  rmSync(root, { recursive: true, force: true });
  try {
    mkdirSync(path.join(root, 'db', 'migrations'), { recursive: true });
    mkdirSync(path.join(root, 'db', 'rollback'), { recursive: true });
    writeFileSync(path.join(root, 'db', 'migrations', '001_catalog.sql'), 'SELECT 1;\n');
    assert.throws(() => loadMigrations(root), (error: unknown) => {
      assert.equal(error instanceof MigrationError, true);
      assert.equal((error as MigrationError).code, 'MISSING_ROLLBACK');
      return true;
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
