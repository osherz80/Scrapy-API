import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigError, loadConfig } from '../../src/config.ts';

function baseEnv(): Record<string, string> {
  return {
    DATABASE_READ_URL: 'postgresql://search:search-password@db.example:5432/postgres?sslmode=require',
    DATABASE_CONTROL_URL: 'postgresql://control:control-password@db.example:5432/postgres?sslmode=require',
    SEARCH_API_KEY: 's'.repeat(32),
    ADMIN_API_KEY: 'a'.repeat(32),
    GITHUB_REPOSITORY: 'neuton/scrapy-api',
    GITHUB_WORKFLOW_ID: 'refresh.yml',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_TOKEN: `ghs_${'t'.repeat(20)}`,
  };
}

test('loadConfig applies the spec defaults', () => {
  const config = loadConfig(baseEnv());
  assert.equal(config.port, 3000);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.logLevel, 'debug');
  assert.equal(config.logEnv, 'development');
  assert.equal(config.appVersion, 'dev');
  assert.equal(config.staleAfterHours, 48);
  assert.equal(config.dbQueryTimeoutMs, 15_000);
  assert.equal(config.requestTimeoutMs, 30_000);
  assert.equal(config.searchRateLimitPerMinute, 60);
  assert.equal(config.refreshRateLimitPerMinute, 5);
  assert.equal(config.dbConcurrency, 2);
});

test('loadConfig names every missing required value and no secret', () => {
  assert.throws(
    () => loadConfig({}),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.deepEqual(error.missing, [
        'DATABASE_READ_URL',
        'DATABASE_CONTROL_URL',
        'SEARCH_API_KEY',
        'ADMIN_API_KEY',
        'GITHUB_REPOSITORY',
        'GITHUB_WORKFLOW_ID',
        'GITHUB_REF',
        'GITHUB_TOKEN',
      ]);
      assert.equal(error.message.includes('postgresql://'), false);
      assert.equal(error.message.includes('password'), false);
      return true;
    },
  );
});

test('production cannot keep a debug log level', () => {
  const config = loadConfig({ ...baseEnv(), LOG_ENV: 'production', LOG_LEVEL: 'debug' });
  assert.equal(config.logLevel, 'info');
});

test('remote database URLs cannot disable TLS', () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv(),
        DATABASE_READ_URL: 'postgresql://search:search-password@db.example:5432/postgres?sslmode=disable',
      }),
    (error: unknown) => error instanceof ConfigError && error.invalid.includes('DATABASE_READ_URL'),
  );
});

test('local database URLs may omit a password', () => {
  const config = loadConfig({
    ...baseEnv(),
    DATABASE_READ_URL: 'postgresql://search@127.0.0.1:5432/supermarket_api_test',
  });
  assert.match(config.databaseReadUrl, /127\.0\.0\.1/);
});

test('the two API keys must differ and be at least 32 characters', () => {
  const secret = 'k'.repeat(32);
  assert.throws(
    () => loadConfig({ ...baseEnv(), SEARCH_API_KEY: secret, ADMIN_API_KEY: secret }),
    (error: unknown) => error instanceof ConfigError && error.invalid.includes('ADMIN_API_KEY'),
  );
  assert.throws(
    () => loadConfig({ ...baseEnv(), SEARCH_API_KEY: 'short' }),
    (error: unknown) => error instanceof ConfigError && error.invalid.includes('SEARCH_API_KEY'),
  );
});
