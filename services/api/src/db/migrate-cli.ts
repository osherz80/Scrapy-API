import { pathToFileURL } from 'node:url';

import { MigrationError } from './migrations.ts';
import { migrateFromEnv } from './migrate.ts';

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const applied = await migrateFromEnv(env);
  process.stdout.write(`${applied.length === 0 ? 'up to date' : `applied ${applied.join(',')}`}\n`);
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
  main().catch((error: unknown) => {
    const message = error instanceof MigrationError || error instanceof Error ? error.message : 'MIGRATION_FAILED';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
