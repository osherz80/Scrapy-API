import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INTERNAL_COLUMNS, toSearchResult } from '../../src/search/row-result.ts';

const ROW = {
  chainId: 'shufersal',
  itemCode: '11210000094',
  itemName: 'רוטב טבסקו 60 מ"ל',
  itemPrice: '10.90',
  sampleCount: 1,
  subchainId: null,
  storeId: null,
  runId: '00000000-0000-4000-8000-000000000001',
  updatedAt: '2026-10-31T06:00:00.000Z',
  nameTokens: ['רוטב'],
  normalizedName: 'רוטב טבסקו 60 מ"ל',
};

test('internal columns are removed and raw fields are kept', () => {
  const result = toSearchResult(ROW, 9500);
  assert.deepEqual(Object.keys(result).sort(), [
    'chainId',
    'itemCode',
    'itemName',
    'itemPrice',
    'sampleCount',
    'score',
    'storeId',
    'subchainId',
  ]);
  assert.equal(result.score, 9500);
  assert.equal(result.itemPrice, '10.90');
  assert.equal(result.sampleCount, 1);
  assert.equal(result.subchainId, null);
  assert.equal(result.storeId, null);
  for (const key of INTERNAL_COLUMNS) assert.equal(key in result, false);
});

test('score wins over a database column of the same name', () => {
  const result = toSearchResult({ ...ROW, score: 1 }, 4200);
  assert.equal(result.score, 4200);
});

test('unknown future columns pass through untouched', () => {
  const result = toSearchResult({ ...ROW, futureNote: 'x' }, 3000);
  assert.equal(result.futureNote, 'x');
});
