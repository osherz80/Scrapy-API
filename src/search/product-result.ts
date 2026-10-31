import type { ChainId } from '../contracts/chains.ts';

export const PRICE_ITEM_FIELDS = [
  'PriceUpdateTime',
  'ItemCode',
  'LastSaleDateTime',
  'ItemType',
  'ItemName',
  'ManufactureName',
  'ManufactureCountry',
  'ManufactureItemDescription',
  'UnitQty',
  'Quantity',
  'UnitOfMeasure',
  'bIsWeighted',
  'QtyInPackage',
  'ItemPrice',
  'UnitOfMeasurePrice',
  'AllowDiscount',
  'ItemStatus',
] as const;

export type PackageUnit = 'g' | 'ml' | 'unit';

export interface CatalogProduct {
  chainId: ChainId;
  itemCode: string;
  name: string;
  manufacturer: string | null;
  price: string;
  packageQuantity: string | null;
  packageUnit: PackageUnit | null;
  sourceQuantity: string | null;
  sourceUnitQty: string | null;
  itemPriceUpdatedAt: Date | null;
  isWeighted: boolean;
  sampleCount: number;
  sourceUpdatedAt: Date;
  updatedAt: Date;
}

export interface ProductResult {
  chain: ChainId;
  score: number;
  price: number;
  currency: 'ILS';
  sampleCount: number;
  sourceUpdatedAt: string;
  updatedAt: string;
  isStale: boolean;
  PriceUpdateTime: string;
  ItemCode: string;
  LastSaleDateTime: string;
  ItemType: string;
  ItemName: string;
  ManufactureName: string;
  ManufactureCountry: string;
  ManufactureItemDescription: string;
  UnitQty: string;
  Quantity: string;
  UnitOfMeasure: string;
  bIsWeighted: '0' | '1';
  QtyInPackage: string;
  ItemPrice: string;
  UnitOfMeasurePrice: string;
  AllowDiscount: string;
  ItemStatus: string;
}

const COMPARISON = {
  g: { basis: 100, label: '100 גרם' },
  ml: { basis: 100, label: '100 מיליליטר' },
  unit: { basis: 1, label: '1 יחידה' },
} as const;

export function toProductResult(
  product: CatalogProduct,
  score: number,
  now: Date,
  staleAfterHours: number,
): ProductResult {
  const itemPrice = formatDecimal(product.price, 4);
  const comparison = comparisonFields(product.packageQuantity, product.packageUnit, product.price);
  return {
    chain: product.chainId,
    score,
    price: Number(itemPrice),
    currency: 'ILS',
    sampleCount: product.sampleCount,
    sourceUpdatedAt: product.sourceUpdatedAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    isStale: isStale(product.sourceUpdatedAt, now, staleAfterHours),
    PriceUpdateTime: product.itemPriceUpdatedAt?.toISOString() ?? '',
    ItemCode: product.itemCode,
    LastSaleDateTime: '',
    ItemType: '',
    ItemName: product.name,
    ManufactureName: product.manufacturer ?? '',
    ManufactureCountry: '',
    ManufactureItemDescription: '',
    UnitQty: product.sourceUnitQty ?? '',
    Quantity: product.sourceQuantity === null ? '' : formatQuantity(product.sourceQuantity),
    UnitOfMeasure: comparison.unit,
    bIsWeighted: product.isWeighted ? '1' : '0',
    QtyInPackage: '',
    ItemPrice: itemPrice,
    UnitOfMeasurePrice: comparison.price,
    AllowDiscount: '',
    ItemStatus: '',
  };
}

export function isStale(sourceUpdatedAt: Date, now: Date, staleAfterHours: number): boolean {
  return now.getTime() - sourceUpdatedAt.getTime() > staleAfterHours * 60 * 60 * 1000;
}

export function formatDecimal(value: string, scale: number): string {
  const scaled = scaleDecimal(value, scale);
  const text = scaled.toString().padStart(scale + 1, '0');
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`;
}

export function formatQuantity(value: string): string {
  const scaled = scaleDecimal(value, 4);
  const text = scaled.toString();
  const whole = text.length > 4 ? text.slice(0, -4) : '0';
  const fraction = text.padStart(4, '0').slice(-4).replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}

function comparisonFields(
  quantity: string | null,
  unit: PackageUnit | null,
  price: string,
): { unit: string; price: string } {
  if (quantity === null || unit === null) return { unit: '', price: '' };
  const basis = COMPARISON[unit];
  const hundredths = divideHalfUp(
    scaleDecimal(price, 4) * BigInt(basis.basis) * 100n,
    scaleDecimal(quantity, 4),
  );
  return { unit: basis.label, price: formatDecimal(hundredthsToDecimal(hundredths), 2) };
}

function hundredthsToDecimal(hundredths: bigint): string {
  const text = hundredths.toString().padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

function scaleDecimal(value: string, scale: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error('Invalid decimal');
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  const digits = fraction.slice(0, scale).padEnd(scale, '0');
  let scaled = BigInt(whole) * 10n ** BigInt(scale) + BigInt(digits);
  const next = fraction[scale];
  if (next !== undefined && next >= '5') scaled += 1n;
  return scaled;
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Invalid decimal');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}
