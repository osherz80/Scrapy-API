import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CatalogProduct } from '../../src/search/product-result.ts';
import { isStale, PRICE_ITEM_FIELDS, toProductResult } from '../../src/search/product-result.ts';
import { normalizeProductPrice } from '../fixtures/neuton-units.ts';

const NOW = new Date('2026-10-31T12:00:00.000Z');

function tabasco(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    chainId: 'shufersal',
    itemCode: '11210000094',
    name: 'רוטב טבסקו 60 מ"ל',
    manufacturer: 'מקאילהייני קו',
    price: '10.9000',
    packageQuantity: '60',
    packageUnit: 'ml',
    sourceQuantity: '60',
    sourceUnitQty: 'מיליליטר',
    itemPriceUpdatedAt: new Date('2026-05-01T00:00:00.000Z'),
    isWeighted: false,
    sampleCount: 1,
    sourceUpdatedAt: new Date('2026-10-31T00:00:00.000Z'),
    updatedAt: new Date('2026-10-31T06:00:00.000Z'),
    ...overrides,
  };
}

test('the Tabasco row converts to 0.181667 ILS per ml', () => {
  const result = toProductResult(tabasco(), 2525, NOW, 48);
  assert.equal(result.ItemCode, '11210000094');
  assert.equal(result.ItemName, 'רוטב טבסקו 60 מ"ל');
  assert.equal(result.ManufactureName, 'מקאילהייני קו');
  assert.equal(result.UnitQty, 'מיליליטר');
  assert.equal(result.Quantity, '60');
  assert.equal(result.ItemPrice, '10.9000');
  assert.equal(result.price, 10.9);
  assert.equal(result.currency, 'ILS');
  assert.equal(result.sampleCount, 1);
  assert.equal(result.UnitOfMeasure, '100 מיליליטר');
  assert.equal(result.UnitOfMeasurePrice, '18.17');
  assert.equal(result.PriceUpdateTime, '2026-05-01T00:00:00.000Z');
  assert.equal(result.sourceUpdatedAt, '2026-10-31T00:00:00.000Z');
  assert.equal(result.updatedAt, '2026-10-31T06:00:00.000Z');
  assert.equal(result.bIsWeighted, '0');
  for (const field of ['LastSaleDateTime', 'ItemType', 'ManufactureCountry', 'ManufactureItemDescription', 'AllowDiscount', 'ItemStatus', 'QtyInPackage'] as const) {
    assert.equal(result[field], '');
  }
  for (const field of PRICE_ITEM_FIELDS) {
    assert.equal(typeof result[field], 'string');
  }

  const converted = normalizeProductPrice(result, result.ItemName);
  assert.equal(converted?.baseUnit, 'ml');
  assert.equal(converted?.baseUnitAmount, '60.000');
  assert.equal(converted?.baseUnitCost, '0.181667');
});

test('a litre observation stays a litre in the legacy pair and 1000 ml after conversion', () => {
  const result = toProductResult(
    tabasco({
      sourceQuantity: '1',
      sourceUnitQty: 'ליטר',
      packageQuantity: '1000',
      packageUnit: 'ml',
    }),
    2525,
    NOW,
    48,
  );
  assert.equal(result.Quantity, '1');
  assert.equal(result.UnitQty, 'ליטר');
  assert.equal(result.UnitOfMeasure, '100 מיליליטר');
  assert.equal(result.UnitOfMeasurePrice, '1.09');
  const converted = normalizeProductPrice(result, result.ItemName);
  assert.equal(converted?.baseUnit, 'ml');
  assert.equal(converted?.baseUnitAmount, '1000.000');
  assert.equal(converted?.baseUnitCost, '0.010900');
});

test('a second sku stays a separate result and missing package data stays searchable', () => {
  const first = toProductResult(tabasco(), 2525, NOW, 48);
  const second = toProductResult(tabasco({ itemCode: '11210007253' }), 2525, NOW, 48);
  assert.notEqual(first.ItemCode, second.ItemCode);

  const missing = toProductResult(
    tabasco({
      itemCode: '011210000094',
      manufacturer: null,
      packageQuantity: null,
      packageUnit: null,
      sourceQuantity: null,
      sourceUnitQty: null,
      itemPriceUpdatedAt: null,
    }),
    10000,
    NOW,
    48,
  );
  assert.equal(missing.ItemCode, '011210000094');
  assert.equal(missing.ManufactureName, '');
  assert.equal(missing.Quantity, '');
  assert.equal(missing.UnitQty, '');
  assert.equal(missing.UnitOfMeasure, '');
  assert.equal(missing.UnitOfMeasurePrice, '');
  assert.equal(missing.PriceUpdateTime, '');
  assert.equal(normalizeProductPrice(missing, missing.ItemName), null);
});

test('stale means strictly older than the configured window', () => {
  const fresh = new Date('2026-10-29T12:00:00.000Z');
  const exactly = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
  const older = new Date(exactly.getTime() - 1);
  assert.equal(isStale(fresh, NOW, 48), false);
  assert.equal(isStale(exactly, NOW, 48), false);
  assert.equal(isStale(older, NOW, 48), true);
  assert.equal(toProductResult(tabasco({ sourceUpdatedAt: older, updatedAt: NOW }), 1, NOW, 48).isStale, true);
});
