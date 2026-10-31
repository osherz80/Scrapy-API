import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATION_NAME = /^(\d{3,})_[a-z0-9_]+\.sql$/;

export class MigrationError extends Error {
  readonly code: string;

  constructor(code: string, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'MigrationError';
    this.code = code;
  }
}

export interface Migration {
  version: string;
  name: string;
  forward: string;
  rollback: string;
  checksum: string;
  rollbackChecksum: string;
}

export function findRepoRoot(start = fileURLToPath(new URL('.', import.meta.url))): string {
  let dir = start;
  for (let hop = 0; hop < 8; hop += 1) {
    if (existsSync(path.join(dir, 'db', 'migrations'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new MigrationError('MIGRATION_ROOT_NOT_FOUND');
}

export function loadMigrations(repoRoot: string): Migration[] {
  const root = path.resolve(repoRoot);
  const directory = path.join(root, 'db', 'migrations');
  const rollbackDirectory = path.join(root, 'db', 'rollback');
  if (!isInside(root, directory) || !isInside(root, rollbackDirectory)) {
    throw new MigrationError('MIGRATION_OUTSIDE_PROJECT');
  }
  const names = readdirSync(directory).filter((name) => name.endsWith('.sql'));
  if (names.length === 0) throw new MigrationError('MISSING_MIGRATIONS');
  const versions = new Set<number>();
  const migrations: Migration[] = [];
  for (const name of names) {
    const match = MIGRATION_NAME.exec(name);
    if (!match?.[1]) throw new MigrationError('INVALID_MIGRATION_NAME');
    const version = Number(match[1]);
    if (versions.has(version)) throw new MigrationError('DUPLICATE_VERSION');
    versions.add(version);
    const rollbackPath = path.join(rollbackDirectory, name);
    if (!existsSync(rollbackPath)) throw new MigrationError('MISSING_ROLLBACK');
    const forward = readSql(path.join(directory, name), root);
    const rollback = readSql(rollbackPath, root);
    migrations.push({
      version: match[1],
      name,
      forward,
      rollback,
      checksum: sha256(forward),
      rollbackChecksum: sha256(rollback),
    });
  }
  return migrations.sort((left, right) => Number(left.version) - Number(right.version));
}

function readSql(file: string, root: string): string {
  const resolved = path.resolve(file);
  if (!isInside(root, resolved)) throw new MigrationError('MIGRATION_OUTSIDE_PROJECT');
  return readFileSync(resolved, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
