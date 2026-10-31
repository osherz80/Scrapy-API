import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { NAME_CANDIDATE_SQL } from '../../src/search/candidates.ts';
import { matchesStoredCandidate } from '../../src/search/candidates.ts';
import { createRanker, rankProducts, type StoredProduct } from '../../src/search/rank.ts';
import { normalizeQuery, tokenize } from '../../src/search/score.ts';

const NOW = new Date('2026-10-31T12:00:00.000Z');

function product(overrides: Partial<StoredProduct> & Pick<StoredProduct, 'chainId' | 'itemCode' | 'name'>): StoredProduct {
  const name = overrides.name;
  return {
    manufacturer: overrides.manufacturer ?? null,
    price: '5.0000',
    packageQuantity: null,
    packageUnit: null,
    sourceQuantity: null,
    sourceUnitQty: null,
    itemPriceUpdatedAt: null,
    isWeighted: false,
    sampleCount: 1,
    sourceUpdatedAt: NOW,
    updatedAt: NOW,
    chainId: overrides.chainId,
    itemCode: overrides.itemCode,
    name,
    normalizedName: overrides.normalizedName ?? normalizeQuery(name),
    nameTokens: overrides.nameTokens ?? tokenize(name),
  };
}

test('name candidate SQL does not limit or use the manufacturer', () => {
  assert.equal(/\bLIMIT\b/i.test(NAME_CANDIDATE_SQL), false);
  assert.equal(/manufacturer/i.test(NAME_CANDIDATE_SQL.split('WHERE')[1] ?? ''), false);
  assert.equal(matchesStoredCandidate({
    itemCode: '1',
    normalizedName: 'לחם',
    nameTokens: tokenize('לחם'),
  }, 'חלב'), false);
});

test('chunked ranking matches a full pass and keeps the best item in a chain', () => {
  const rows = [
    product({ chainId: 'shufersal', itemCode: 'aaa', name: 'לחם' }),
    product({ chainId: 'shufersal', itemCode: 'zzz', name: 'חלב טרי' }),
    product({ chainId: 'carrefour', itemCode: 'mmm', name: 'חלב' }),
    product({ chainId: 'victory', itemCode: '1', name: 'גבינה', manufacturer: 'חלב' }),
  ];
  const query = { queryType: 'name' as const, q: 'חלב' };
  const once = rankProducts(rows, query, 1, NOW, 48);
  const ranker = createRanker(1);
  for (const row of rows) ranker.add([row], query);
  const chunked = ranker.finish(NOW, 48);
  assert.deepEqual(chunked.map((row) => [row.chain, row.ItemCode]), once.map((row) => [row.chain, row.ItemCode]));
  assert.equal(once.find((row) => row.chain === 'shufersal')?.ItemCode, 'zzz');
  assert.equal(once.some((row) => row.chain === 'victory'), false);
  assert.deepEqual(once.map((row) => row.chain), ['carrefour', 'shufersal']);
});

test('sku ranking is exact and keeps leading zeros', () => {
  const rows = [
    product({ chainId: 'shufersal', itemCode: '0123', name: 'חלב' }),
    product({ chainId: 'victory', itemCode: '0123', name: 'חלב אחר' }),
    product({ chainId: 'carrefour', itemCode: '123', name: 'חלב' }),
  ];
  const found = rankProducts(rows, { queryType: 'sku', q: '0123' }, 1, NOW, 48);
  assert.deepEqual(found.map((row) => [row.chain, row.score]), [
    ['shufersal', 10000],
    ['victory', 10000],
  ]);
  assert.equal(rankProducts(rows, { queryType: 'sku', q: '123' }, 1, NOW, 48)[0]?.ItemCode, '123');
});

test('the catalog migration does not create database roles', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../db/migrations/001_catalog.sql', import.meta.url)), 'utf8');
  assert.equal(/CREATE ROLE/i.test(sql), false);
  assert.equal(/supermarket_search/i.test(sql), false);
});
