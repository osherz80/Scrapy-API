import assert from 'node:assert/strict';
import { test } from 'node:test';

import type pg from 'pg';

import { PgCatalog } from '../../src/db/catalog.ts';
import { HttpError } from '../../src/http/errors.ts';
import { createLoggerFactory } from '../../src/logger/factory.ts';
import { createMemoryTransport } from '../../src/logger/transports/memory.ts';

for (const phase of ['connect', 'query'] as const) {
  test(`catalog logs a safe database error code on ${phase} failure`, async () => {
    const transport = createMemoryTransport();
    const logger = createLoggerFactory({ level: 'info', environment: 'test', version: 'test', transports: [transport] }).create();
    const failure = Object.assign(new Error('private query and credentials'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    let released = false;
    const pool = {
      async connect() {
        if (phase === 'connect') throw failure;
        return {
          async query() { throw failure; },
          release() { released = true; },
        };
      },
    } as unknown as pg.Pool;
    const catalog = new PgCatalog(pool, logger);
    await assert.rejects(catalog.withSnapshot(async () => []), (error: unknown) =>
      error instanceof HttpError && error.statusCode === 503 && error.message === 'Database unavailable');
    const record = transport.records.find((entry) => entry.meta.databaseCode === failure.code);
    assert.ok(record);
    assert.equal(record.meta.phase, phase);
    assert.equal(JSON.stringify(transport.records).includes('private query'), false);
    assert.equal(released, phase === 'query');
  });
}
