import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigError, loadConfig } from '../../src/config.ts';

function baseEnv(): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://app:app-password@db.example:5432/postgres?sslmode=require',
  };
}

test('loadConfig accepts a database CA certificate path', () => {
  const config = loadConfig({ ...baseEnv(), DATABASE_SSLROOTCERT: 'certs/database.crt' });
  assert.equal(config.databaseSslRootCert, 'certs/database.crt');
  assert.equal(loadConfig(baseEnv()).databaseSslRootCert, undefined);
});

test('loadConfig applies the spec defaults from DATABASE_URL alone', () => {
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
  assert.equal(config.githubRepository, '');
  assert.equal(config.githubToken, '');
});

test('loadConfig names a missing DATABASE_URL and no secret', () => {
  assert.throws(
    () => loadConfig({}),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.deepEqual(error.missing, ['DATABASE_URL']);
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

test('a remote database URL cannot disable TLS', () => {
  assert.throws(
    () =>
      loadConfig({
        ...baseEnv(),
        DATABASE_URL: 'postgresql://app:app-password@db.example:5432/postgres?sslmode=disable',
      }),
    (error: unknown) => error instanceof ConfigError && error.invalid.includes('DATABASE_URL'),
  );
});

test('a local database URL may omit a password', () => {
  const config = loadConfig({
    ...baseEnv(),
    DATABASE_URL: 'postgresql://app@127.0.0.1:5432/supermarket_api_test',
  });
  assert.match(config.databaseUrl, /127\.0\.0\.1/);
});

test('refresh dispatch settings are accepted together and rejected when incomplete', () => {
  const config = loadConfig({
    ...baseEnv(),
    GITHUB_REPOSITORY: 'osherz80/Scrapy-API',
    GITHUB_WORKFLOW_ID: 'refresh.yml',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_TOKEN: `ghs_${'t'.repeat(20)}`,
  });
  assert.equal(config.githubRepository, 'osherz80/Scrapy-API');
  assert.equal(config.githubWorkflowId, 'refresh.yml');
  assert.equal(config.githubRef, 'refs/heads/main');

  assert.throws(
    () => loadConfig({ ...baseEnv(), GITHUB_REPOSITORY: 'osherz80/Scrapy-API' }),
    (error: unknown) =>
      error instanceof ConfigError &&
      error.missing.includes('GITHUB_WORKFLOW_ID') &&
      error.missing.includes('GITHUB_REF') &&
      error.missing.includes('GITHUB_TOKEN'),
  );
});
