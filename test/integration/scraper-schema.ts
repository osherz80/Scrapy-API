import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type pg from 'pg';

const DIRECTORY = fileURLToPath(new URL('../fixtures/scraper-schema/', import.meta.url));

/**
 * Applies the scraper-owned schema (migrations 001-005) to a disposable test
 * database. This is a read-only copy for tests, not API migration ownership.
 */
export async function applyScraperSchema(pool: pg.Pool): Promise<void> {
  const files = readdirSync(DIRECTORY).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  for (const file of files) {
    await pool.query(readFileSync(path.join(DIRECTORY, file), 'utf8'));
  }
}
