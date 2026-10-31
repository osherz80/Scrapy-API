import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildApp } from '../../src/app.ts';
import type { CatalogStore } from '../../src/db/catalog.ts';
import { createRateLimiter } from '../../src/http/rate-limit.ts';
import { createLoggerFactory } from '../../src/logger/factory.ts';
import { createMemoryTransport, type MemoryTransport } from '../../src/logger/transports/memory.ts';
import { matchesStoredCandidate } from '../../src/search/candidates.ts';
import type { StoredProduct } from '../../src/search/rank.ts';
import { normalizeQuery, tokenize } from '../../src/search/score.ts';
import type { AppConfig } from '../../src/config.ts';

const NOW = new Date('2026-10-31T12:00:00.000Z');

function config(): AppConfig {
  return {
    port: 3000,
    host: '0.0.0.0',
    logLevel: 'info',
    logEnv: 'test',
    appVersion: 'test',
    staleAfterHours: 48,
    databaseUrl: 'postgresql://app@127.0.0.1:5432/supermarket_api_test',
    githubRepository: '',
    githubWorkflowId: '',
    githubRef: '',
    githubToken: '',
    dbQueryTimeoutMs: 15_000,
    requestTimeoutMs: 30_000,
    searchRateLimitPerMinute: 60,
    refreshRateLimitPerMinute: 5,
    dbConcurrency: 2,
  };
}

function product(chainId: StoredProduct['chainId'], itemCode: string, name: string): StoredProduct {
  return {
    chainId,
    itemCode,
    name,
    manufacturer: null,
    price: '4.5000',
    packageQuantity: '1',
    packageUnit: 'unit',
    sourceQuantity: '1',
    sourceUnitQty: 'יחידה',
    itemPriceUpdatedAt: null,
    isWeighted: false,
    sampleCount: 1,
    sourceUpdatedAt: NOW,
    updatedAt: NOW,
    normalizedName: normalizeQuery(name),
    nameTokens: tokenize(name),
  };
}

function memory(rows: StoredProduct[], fail = false): CatalogStore {
  return {
    async withSnapshot(fn) {
      if (fail) throw new Error('connection refused');
      return fn({
        async findBySku(itemCode) {
          return rows.filter((row) => row.itemCode === itemCode);
        },
        async findNameCandidates(query) {
          return rows.filter((row) => matchesStoredCandidate(row, query));
        },
      });
    },
  };
}

function appFor(rows: StoredProduct[], fail = false) {
  const logger = createLoggerFactory({
    level: 'info',
    environment: 'test',
    version: 'test',
    transports: [createMemoryTransport()],
  }).create();
  return buildApp({ config: config(), logger, catalog: memory(rows, fail), now: () => NOW });
}

test('search validates input and returns an array when nothing matches', async () => {
  const app = appFor([product('shufersal', '1', 'לחם')]);
  const missing = await app.inject({ method: 'GET', url: '/v1/search?queryType=name&q=חלב' });
  assert.equal(missing.statusCode, 200);
  assert.deepEqual(missing.json(), []);

  const badLimit = await app.inject({ method: 'GET', url: '/v1/search?queryType=name&q=חלב&limitPerChain=11' });
  assert.equal(badLimit.statusCode, 400);
  assert.equal(badLimit.json<{ error: { message: string } }>().error.message, 'limitPerChain must be between 1 and 10');

  const inferred = await app.inject({ method: 'GET', url: '/v1/search?q=7290000000000' });
  assert.equal(inferred.statusCode, 400);
  await app.close();
});

test('batch preserves order, rejects duplicate ids, and fails closed on a database error', async () => {
  const app = appFor([product('shufersal', '7290000000000', 'חלב')]);
  const response = await app.inject({
    method: 'POST',
    url: '/v1/search/batch?limitPerChain=1',
    payload: {
      queries: [
        { id: 'ingredient-1', queryType: 'name', q: 'אין מוצר' },
        { id: 'ingredient-2', queryType: 'sku', q: '7290000000000' },
      ],
    },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json<{ results: Array<{ id: string; items: unknown[] }> }>();
  assert.deepEqual(body.results.map((row) => row.id), ['ingredient-1', 'ingredient-2']);
  assert.deepEqual(body.results[0]?.items, []);
  assert.equal(body.results[1]?.items.length, 1);

  const duplicate = await app.inject({
    method: 'POST',
    url: '/v1/search/batch',
    payload: {
      queries: [
        { id: 'same', queryType: 'name', q: 'חלב' },
        { id: 'same', queryType: 'sku', q: '1' },
      ],
    },
  });
  assert.equal(duplicate.statusCode, 400);

  const broken = appFor([], true);
  const failure = await broken.inject({ method: 'GET', url: '/v1/search?queryType=sku&q=1' });
  assert.equal(failure.statusCode, 503);
  assert.deepEqual(failure.json<{ error: { message: string } }>().error, {
    code: 'UNAVAILABLE',
    message: 'Database unavailable',
  });
  await app.close();
  await broken.close();
});

test('search rate limit does not require a bearer token', async () => {
  const clock = 0;
  const logger = createLoggerFactory({
    level: 'error',
    environment: 'test',
    version: 'test',
    transports: [createMemoryTransport()],
  }).create();
  const app = buildApp({
    config: config(),
    logger,
    catalog: memory([]),
    now: () => NOW,
    rateLimit: createRateLimiter({ searchPerMinute: 1, refreshPerMinute: 1, now: () => clock }),
  });
  const first = await app.inject({ method: 'GET', url: '/v1/search?queryType=name&q=חלב' });
  const second = await app.inject({ method: 'GET', url: '/v1/search?queryType=name&q=חלב' });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 429);
  assert.equal(second.headers['retry-after'], '60');
  await app.close();
});

test('search logs type, counts, and database time without the query text', async () => {
  const transport: MemoryTransport = createMemoryTransport();
  const logger = createLoggerFactory({
    level: 'info',
    environment: 'test',
    version: 'test',
    transports: [transport],
  }).create();
  const app = buildApp({ config: config(), logger, catalog: memory([product('shufersal', '1', 'חלב')]), now: () => NOW });
  const response = await app.inject({ method: 'GET', url: '/v1/search?queryType=name&q=חלב' });
  assert.equal(response.statusCode, 200);
  const search = transport.records.find((record) => record.message === 'search');
  assert.equal(search?.meta.queryType, 'name');
  assert.equal(search?.meta.resultCount, 1);
  assert.equal(typeof search?.meta.candidatesScored, 'number');
  assert.equal(typeof search?.meta.databaseMs, 'number');
  assert.equal(search?.meta.q, undefined);
  assert.equal(JSON.stringify(search).includes('חלב'), false);
  await app.close();
});
