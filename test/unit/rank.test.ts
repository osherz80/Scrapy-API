import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchesStoredCandidate, NAME_CANDIDATE_SQL, SKU_SQL } from '../../src/search/candidates.ts';
import { createRanker, rankProducts, type StoredProduct } from '../../src/search/rank.ts';
import { tokenize } from '../../src/search/score.ts';

function product(overrides: Partial<StoredProduct> & Pick<StoredProduct, 'chainId' | 'itemCode'>): StoredProduct {
  const itemName = overrides.itemName ?? null;
  return {
    ...overrides,
    itemName,
    manufactureName: overrides.manufactureName ?? null,
    nameTokens: overrides.nameTokens ?? tokenize(itemName ?? ''),
    chainId: overrides.chainId,
    itemCode: overrides.itemCode,
  };
}

test('candidate SQL reads public.products with no legacy normalized name', () => {
  for (const sql of [NAME_CANDIDATE_SQL, SKU_SQL]) {
    assert.match(sql, /FROM public\.products/);
    assert.equal(/supermarket\./.test(sql), false);
    assert.equal(/normalized_name/.test(sql), false);
  }
  assert.equal(/\bLIMIT\b/i.test(NAME_CANDIDATE_SQL), false);
  assert.match(NAME_CANDIDATE_SQL, /lower\(btrim\(item_name\)\) = \$2/);
  assert.equal(/manufacture_name/i.test(NAME_CANDIDATE_SQL.split('WHERE')[1] ?? ''), false);
});

test('the JS recall rule mirrors the SQL', () => {
  const candidate = {
    itemCode: '11210000094',
    itemName: 'רוטב טבסקו 60 מ"ל',
    nameTokens: tokenize('רוטב טבסקו 60 מ"ל'),
  };
  assert.equal(matchesStoredCandidate(candidate, '11210000094'), true);
  assert.equal(matchesStoredCandidate(candidate, '  רוטב טבסקו 60 מ"ל '), true);
  assert.equal(matchesStoredCandidate(candidate, 'רוטב'), true);
  assert.equal(matchesStoredCandidate(candidate, 'חלב'), false);
  assert.equal(matchesStoredCandidate({ itemCode: '1', itemName: null, nameTokens: [] }, '!!!'), false);
  assert.equal(matchesStoredCandidate({ itemCode: '1', itemName: '!!!', nameTokens: [] }, '!!!'), true);
});

test('chunked ranking matches a full pass and keeps the best item in a chain', () => {
  const rows = [
    product({ chainId: 'shufersal', itemCode: 'aaa', itemName: 'לחם' }),
    product({ chainId: 'shufersal', itemCode: 'zzz', itemName: 'חלב טרי' }),
    product({ chainId: 'carrefour', itemCode: 'mmm', itemName: 'חלב' }),
    product({ chainId: 'victory', itemCode: '1', itemName: 'גבינה', manufactureName: 'חלב' }),
  ];
  const query = { queryType: 'name' as const, q: 'חלב' };
  const once = rankProducts(rows, query, 1);
  const ranker = createRanker(1);
  for (const row of rows) ranker.add([row], query);
  const chunked = ranker.finish();
  assert.deepEqual(chunked.map((row) => [row.chainId, row.itemCode]), once.map((row) => [row.chainId, row.itemCode]));
  assert.equal(once.find((row) => row.chainId === 'shufersal')?.itemCode, 'zzz');
  assert.equal(once.some((row) => row.chainId === 'victory'), false);
  assert.deepEqual(once.map((row) => row.chainId), ['carrefour', 'shufersal']);
});

test('sku ranking is exact and keeps leading zeros', () => {
  const rows = [
    product({ chainId: 'shufersal', itemCode: '0123', itemName: 'חלב' }),
    product({ chainId: 'victory', itemCode: '0123', itemName: 'חלב אחר' }),
    product({ chainId: 'carrefour', itemCode: '123', itemName: 'חלב' }),
  ];
  const found = rankProducts(rows, { queryType: 'sku', q: '0123' }, 1);
  assert.deepEqual(found.map((row) => [row.chainId, row.score]), [
    ['shufersal', 10000],
    ['victory', 10000],
  ]);
  assert.equal(rankProducts(rows, { queryType: 'sku', q: '123' }, 1)[0]?.itemCode, '123');
});

test('ranked rows are flat scored rows without internal columns', () => {
  const rows = rankProducts(
    [product({
      chainId: 'shufersal',
      itemCode: '0123',
      itemName: 'חלב',
      runId: '00000000-0000-4000-8000-000000000001',
      updatedAt: '2026-10-31T06:00:00.000Z',
      sampleCount: 2,
    })],
    { queryType: 'sku', q: '0123' },
    1,
  );
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row?.score, 10000);
  assert.equal(row?.itemCode, '0123');
  assert.equal(row?.itemName, 'חלב');
  assert.equal(row?.sampleCount, 2);
  assert.equal(row !== undefined && 'runId' in row, false);
  assert.equal(row !== undefined && 'updatedAt' in row, false);
  assert.equal(row !== undefined && 'nameTokens' in row, false);
});
