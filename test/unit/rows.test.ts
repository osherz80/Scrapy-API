import assert from 'node:assert/strict';
import { test } from 'node:test';

import { camelizeRow, toCamelCase } from '../../src/db/rows.ts';

test('column names become camelCase', () => {
  assert.equal(toCamelCase('item_code'), 'itemCode');
  assert.equal(toCamelCase('unit_of_measure_price'), 'unitOfMeasurePrice');
  assert.equal(toCamelCase('b_is_weighted'), 'bIsWeighted');
  assert.equal(toCamelCase('manufacture_item_description'), 'manufactureItemDescription');
  assert.equal(toCamelCase('quantity'), 'quantity');
  assert.equal(toCamelCase('item__code'), 'itemCode');
});

test('camelizeRow renames keys and leaves values untouched', () => {
  const row = camelizeRow({
    chain_id: 'shufersal',
    item_code: '11210000094',
    item_price: '10.90',
    sample_count: 1,
    subchain_id: null,
    future_note: 'x',
  });
  assert.deepEqual(row, {
    chainId: 'shufersal',
    itemCode: '11210000094',
    itemPrice: '10.90',
    sampleCount: 1,
    subchainId: null,
    futureNote: 'x',
  });
  assert.equal(typeof row.itemPrice, 'string');
  assert.equal(typeof row.sampleCount, 'number');
});

test('single-word columns keep their name', () => {
  assert.deepEqual(camelizeRow({ quantity: '60', is_weighted: '0' }), {
    quantity: '60',
    isWeighted: '0',
  });
});
