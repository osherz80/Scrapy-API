import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { applyMigrations } from '../../src/db/migrate.ts';
import { MigrationError } from '../../src/db/migrations.ts';
import { createPool, assertLocalTestDatabase } from '../../src/db/pool.ts';
import { PgCatalog } from '../../src/db/catalog.ts';
import { createLoggerFactory } from '../../src/logger/factory.ts';
import { createMemoryTransport } from '../../src/logger/transports/memory.ts';
import { PgRefreshStore } from '../../src/refresh/store.ts';
import { normalizeQuery, tokenize } from '../../src/search/score.ts';
import { localTestDatabase, stopLocalTestDatabase } from './postgres-server.ts';

after(async () => {
  await stopLocalTestDatabase();
});

test('migration, sku lookup, name recall, and refresh admission use a local database', async () => {
  const databaseUrl = await localTestDatabase();
  assertLocalTestDatabase(databaseUrl);
  const applied = await applyMigrations(databaseUrl);
  assert.deepEqual(applied, ['001']);
  assert.deepEqual(await applyMigrations(databaseUrl), []);

  const pool = createPool(databaseUrl, 15_000);
  const logger = createLoggerFactory({
    level: 'error',
    environment: 'test',
    version: 'test',
    transports: [createMemoryTransport()],
  }).create();
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO supermarket.refresh_runs(id, origin, status, requested_chains, dispatch_state, started_at, finished_at)
       VALUES ('00000000-0000-4000-8000-000000000010', 'MANUAL', 'SUCCEEDED', '{carrefour,shufersal,victory}', 'ACKNOWLEDGED', now(), now())`,
    );
    for (const chainId of ['carrefour', 'shufersal', 'victory']) {
      await client.query(
        `INSERT INTO supermarket.refresh_run_chains(
           run_id, chain_id, status, attempt_count, successful_branch_count, product_count, started_at, finished_at)
         VALUES ('00000000-0000-4000-8000-000000000010', $1, 'SUCCEEDED', 1, 1, 2, now(), now())`,
        [chainId],
      );
    }
    const published = new Date('2026-10-31T00:00:00.000Z');
    await insertProduct(client, 'shufersal', '0123', 'חלב טרי', published);
    await insertProduct(client, 'victory', '0123', 'חלב', published);
    await insertProduct(client, 'shufersal', '999', 'לחם', published, 'חלב');
    for (let index = 0; index < 30; index += 1) {
      await insertProduct(client, 'carrefour', `b${String(index).padStart(3, '0')}`, `מוצר ${index}`, published);
    }
    await insertProduct(client, 'carrefour', 'best', 'חלב', published);
  } finally {
    client.release();
  }

  const catalog = new PgCatalog(pool, logger);
  const sku = await catalog.withSnapshot(async (reader) => reader.findBySku('0123'));
  assert.deepEqual(sku.map((row) => row.chainId).sort(), ['shufersal', 'victory']);
  assert.deepEqual(await catalog.withSnapshot(async (reader) => reader.findBySku('123')), []);

  const names = await catalog.withSnapshot(async (reader) => reader.findNameCandidates('חלב'));
  assert.equal(names.some((row) => row.itemCode === '999'), false);
  assert.equal(names.some((row) => row.itemCode === 'best'), true);
  assert.equal(names.length, 3);

  const refresh = new PgRefreshStore(pool);
  const first = await refresh.admit(['shufersal', 'rami-levy']);
  const second = await refresh.admit(['rami-levy']);
  assert.ok('runId' in first);
  assert.ok('conflicts' in second);
  if ('conflicts' in second) assert.equal(second.conflicts[0]?.chainId, 'rami-levy');
  const disjoint = await refresh.admit(['yochananof']);
  assert.ok('runId' in disjoint);

  if ('runId' in first) {
    await refresh.recordDispatch(first.runId, 'uncertain');
    const status = await refresh.getRun(first.runId, new Date(), 48);
    assert.equal(status?.dispatchState, 'UNCERTAIN');
    assert.equal(status?.status, 'PENDING');
    await pool.query(
      `UPDATE supermarket.refresh_run_chains SET error_message = $2 WHERE run_id = $1`,
      [first.runId, 'failed bearer super-secret https://user:pass@example.com/file'],
    );
    await refresh.recordDispatch(first.runId, 'rejected');
    const failed = await refresh.getRun(first.runId, new Date(), 48);
    assert.equal(failed?.status, 'FAILED');
    assert.equal(failed?.dispatchState, 'REJECTED');
    const planted = failed?.chains[0]?.errorMessage ?? '';
    assert.match(planted, /bearer \[redacted\]/);
    assert.equal(planted.includes('super-secret'), false);
    assert.equal(planted.includes('user:pass'), false);
  }

  const chains = await refresh.listChains(new Date('2026-10-31T12:00:00.000Z'), 48);
  const quiet = chains.find((chain) => chain.id === 'keshet-teamim');
  assert.equal(quiet?.productCount, 0);
  assert.equal(quiet?.catalogUpdatedAt, null);
  assert.equal(quiet?.sourceUpdatedAt, null);
  assert.equal(quiet?.isStale, false);

  const raced = await Promise.all([refresh.admit(['victory']), refresh.admit(['victory'])]);
  assert.equal(raced.filter((outcome) => 'runId' in outcome).length, 1);
  assert.equal(raced.filter((outcome) => 'conflicts' in outcome).length, 1);

  const singleStarted = performance.now();
  for (let index = 0; index < 20; index += 1) {
    await catalog.withSnapshot(async (reader) => reader.findNameCandidates('חלב'));
  }
  const meanSingleMs = (performance.now() - singleStarted) / 20;
  const batchStarted = performance.now();
  await catalog.withSnapshot(async (reader) => {
    for (let index = 0; index < 10; index += 1) await reader.findNameCandidates('חלב');
  });
  const batchMs = performance.now() - batchStarted;
  assert.equal(meanSingleMs < 2_000, true);
  assert.equal(batchMs < 10_000, true);
  console.info(`local fixture mean name lookup ${meanSingleMs.toFixed(1)} ms; ten-query snapshot ${batchMs.toFixed(1)} ms`);

  await pool.query(`UPDATE supermarket.schema_migrations SET checksum = 'drift' WHERE version = '001'`);
  await assert.rejects(applyMigrations(databaseUrl), (error: unknown) => {
    assert.equal(error instanceof MigrationError, true);
    assert.equal((error as MigrationError).code, 'MIGRATION_DRIFT');
    return true;
  });

  await pool.end();
});

async function insertProduct(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  chainId: string,
  itemCode: string,
  name: string,
  published: Date,
  manufacturer: string | null = null,
): Promise<void> {
  await client.query(
    `INSERT INTO supermarket.products(
       chain_id, item_code, name, manufacturer, price, package_quantity, package_unit,
       source_quantity, source_unit_qty, is_weighted, sample_count, source_updated_at,
       newest_source_updated_at, updated_at, run_id, normalized_name, name_tokens)
     VALUES ($1,$2,$3,$4,5.5,1,'unit',1,'יחידה',false,1,$5,$5,$5,'00000000-0000-4000-8000-000000000010',$6,$7)`,
    [chainId, itemCode, name, manufacturer, published, normalizeQuery(name), tokenize(name)],
  );
}
