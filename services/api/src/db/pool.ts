import pg from 'pg';

const { Pool } = pg;

export function isLocalDatabase(connectionString: string): boolean {
  const url = new URL(connectionString);
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
}

export function assertLocalTestDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const name = url.pathname.replace(/^\//, '');
  if (!isLocalDatabase(connectionString) || !name.startsWith('supermarket_api_test')) {
    throw new Error('REFUSING_NON_LOCAL_TEST_DATABASE');
  }
}

export function createPool(connectionString: string, statementTimeoutMs: number): pg.Pool {
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5_000,
    statement_timeout: statementTimeoutMs,
    ssl: isLocalDatabase(connectionString) ? undefined : { rejectUnauthorized: true },
  });
  return pool;
}
