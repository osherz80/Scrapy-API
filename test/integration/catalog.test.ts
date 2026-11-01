import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { PgCatalog, runSearch } from '../../src/db/catalog.ts';
import { assertLocalTestDatabase, createPool } from '../../src/db/pool.ts';
import { createLoggerFactory } from '../../src/logger/factory.ts';
import { createMemoryTransport } from '../../src/logger/transports/memory.ts';
import { PgRefreshStore } from '../../src/refresh/store.ts';
import { tokenize } from '../../src/search/score.ts';
import { localTestDatabase, stopLocalTestDatabase } from './postgres-server.ts';
import { applyScraperSchema } from './scraper-schema.ts';

const RUN_ID = '00000000-0000-4000-8000-000000000010';
const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;

after(async () => {
  await stopLocalTestDatabase();
});

test('search reads the scraper schema and returns scored camelCase rows', async () => {
  const databaseUrl = await localTestDatabase();
  assertLocalTestDatabase(databaseUrl);
  const pool = createPool(databaseUrl, 15_000);
  await applyScraperSchema(pool);

  const logger = createLoggerFactory({
    level: 'error',
    environment: 'test',
    version: 'test',
    transports: [createMemoryTransport()],
  }).create();

  await seed(pool);
  const catalog = new PgCatalog(pool, logger);

  const sku = await runSearch(catalog, { queryType: 'sku', q: '0123' }, 10);
  assert.deepEqual(sku.items.map((row) => [row.chainId, row.score]), [
    ['shufersal', 10000],
    ['victory', 10000],
  ]);
  assert.equal(sku.items[0]?.itemName, 'חלב טרי');
  assert.equal(await runSearch(catalog, { queryType: 'sku', q: '123' }, 10).then((result) => result.items.length), 0);

  const names = await runSearch(catalog, { queryType: 'name', q: 'חלב' }, 10);
  assert.equal(names.items.some((row) => row.itemCode === '999'), false);
  assert.equal(names.items.some((row) => row.itemCode === 'best'), true);
  assert.equal(names.items.length, 3);

  const punctuation = await runSearch(catalog, { queryType: 'name', q: '!!!' }, 10);
  assert.deepEqual(punctuation.items.map((row) => [row.itemCode, row.score]), [['555', 9500]]);

  const missingName = await runSearch(catalog, { queryType: 'sku', q: '0000' }, 10);
  assert.equal(missingName.items.length, 1);
  assert.equal(missingName.items[0]?.itemName, null);
  assert.equal((await runSearch(catalog, { queryType: 'name', q: 'אין' }, 10)).items.length, 0);

  for (const row of [...sku.items, ...names.items, ...punctuation.items]) {
    for (const key of Object.keys(row)) {
      assert.match(key, CAMEL_CASE, `unexpected response key ${key}`);
    }
    for (const key of ['runId', 'updatedAt', 'nameTokens', 'normalizedName', 'item_code', 'unit_of_measure_price']) {
      assert.equal(key in row, false, `leaked ${key}`);
    }
  }

  const carrefour = names.items.find((row) => row.chainId === 'carrefour');
  assert.equal(carrefour?.subchainId, '001');
  assert.equal(carrefour?.storeId, 'store-1');

  await pool.query(`ALTER TABLE public.products ADD COLUMN future_note text`);
  await pool.query(`UPDATE public.products SET future_note = 'hello' WHERE item_code = '0123'`);
  const added = await runSearch(catalog, { queryType: 'sku', q: '0123' }, 10);
  assert.deepEqual(added.items.map((row) => row.futureNote), ['hello', 'hello']);

  const refresh = new PgRefreshStore(pool);
  const first = await refresh.admit(['shufersal', 'rami-levy']);
  const second = await refresh.admit(['rami-levy']);
  assert.ok('runId' in first);
  assert.ok('conflicts' in second);
  if ('conflicts' in second) assert.equal(second.conflicts[0]?.chainId, 'rami-levy');
  assert.ok('runId' in await refresh.admit(['yochananof']));

  if ('runId' in first) {
    await refresh.recordDispatch(first.runId, 'uncertain');
    const status = await refresh.getRun(first.runId, new Date(), 48);
    assert.equal(status?.dispatchState, 'UNCERTAIN');
    assert.equal(status?.status, 'PENDING');
    await pool.query(
      `UPDATE public.refresh_run_chains SET error_message = $2 WHERE run_id = $1`,
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

  await pool.end();
});

async function seed(pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> }): Promise<void> {
  await pool.query(
    `INSERT INTO public.refresh_runs(id, origin, status, requested_chains, dispatch_state, started_at, finished_at)
     VALUES ($1, 'MANUAL', 'SUCCEEDED', '{carrefour,shufersal,victory}', 'ACKNOWLEDGED', now(), now())`,
    [RUN_ID],
  );
  for (const chainId of ['carrefour', 'shufersal', 'victory']) {
    await pool.query(
      `INSERT INTO public.refresh_run_chains(
         run_id, chain_id, status, attempt_count, successful_branch_count, product_count, started_at, finished_at)
       VALUES ($1, $2, 'SUCCEEDED', 1, 1, 2, now(), now())`,
      [RUN_ID, chainId],
    );
  }
  await insertProduct(pool, { chainId: 'shufersal', itemCode: '0123', itemName: 'חלב טרי' });
  await insertProduct(pool, { chainId: 'victory', itemCode: '0123', itemName: 'חלב' });
  await insertProduct(pool, { chainId: 'shufersal', itemCode: '999', itemName: 'לחם', manufactureName: 'חלב' });
  await insertProduct(pool, {
    chainId: 'carrefour',
    itemCode: 'best',
    itemName: 'חלב',
    subchainId: '001',
    storeId: 'store-1',
  });
  await insertProduct(pool, { chainId: 'shufersal', itemCode: '555', itemName: '!!!', nameTokens: [] });
  await insertProduct(pool, { chainId: 'shufersal', itemCode: '0000', itemName: null, nameTokens: [] });
}

async function insertProduct(
  pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  product: {
    chainId: string;
    itemCode: string;
    itemName: string | null;
    manufactureName?: string | null;
    subchainId?: string | null;
    storeId?: string | null;
    nameTokens?: string[];
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO public.products(
       chain_id, item_code, item_name, manufacture_name, item_price, quantity, unit_qty,
       is_weighted, b_is_weighted, sample_count, subchain_id, store_id, updated_at, run_id, name_tokens)
     VALUES ($1,$2,$3,$4,'10.90','60','מיליליטר','0','0',1,$5,$6,now(),$7,$8)`,
    [
      product.chainId,
      product.itemCode,
      product.itemName,
      product.manufactureName ?? null,
      product.subchainId ?? null,
      product.storeId ?? null,
      RUN_ID,
      product.nameTokens ?? tokenize(product.itemName ?? ''),
    ],
  );
}
