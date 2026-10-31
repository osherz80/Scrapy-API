import type pg from 'pg';

import { isChainId } from '../contracts/chains.ts';
import { HttpError } from '../http/errors.ts';
import type { Logger } from '../logger/types.ts';
import { NAME_CANDIDATE_SQL, SKU_SQL } from '../search/candidates.ts';
import type { PackageUnit } from '../search/product-result.ts';
import { rankProducts, type SearchQuery, type StoredProduct } from '../search/rank.ts';
import type { ProductResult } from '../search/product-result.ts';
import { normalizeQuery, tokenize } from '../search/score.ts';

export interface CatalogReader {
  findBySku(itemCode: string): Promise<StoredProduct[]>;
  findNameCandidates(query: string): Promise<StoredProduct[]>;
}

export interface CatalogStore {
  withSnapshot<T>(fn: (reader: CatalogReader) => Promise<T>): Promise<T>;
}

interface ProductRow {
  chain_id: string;
  item_code: string;
  name: string;
  manufacturer: string | null;
  price: string;
  package_quantity: string | null;
  package_unit: string | null;
  source_quantity: string | null;
  source_unit_qty: string | null;
  item_price_updated_at: Date | null;
  is_weighted: boolean;
  sample_count: number;
  source_updated_at: Date;
  updated_at: Date;
  normalized_name: string;
  name_tokens: string[];
}

export class PgCatalog implements CatalogStore {
  private readonly pool: pg.Pool;
  private readonly logger: Logger;

  constructor(pool: pg.Pool, logger: Logger) {
    this.pool = pool;
    this.logger = logger;
  }

  async withSnapshot<T>(fn: (reader: CatalogReader) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const started = Date.now();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const result = await fn(new PgReader(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error(new Error('Database query failed'), { databaseMs: Date.now() - started });
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'UNAVAILABLE', 'Database unavailable', undefined, 5);
    } finally {
      client.release();
    }
  }
}

class PgReader implements CatalogReader {
  private readonly client: pg.PoolClient;

  constructor(client: pg.PoolClient) {
    this.client = client;
  }

  async findBySku(itemCode: string): Promise<StoredProduct[]> {
    const result = await this.client.query<ProductRow>(SKU_SQL, [itemCode]);
    return result.rows.map(mapRow);
  }

  async findNameCandidates(query: string): Promise<StoredProduct[]> {
    const result = await this.client.query<ProductRow>(NAME_CANDIDATE_SQL, [
      query.trim(),
      normalizeQuery(query),
      tokenize(query),
    ]);
    return result.rows.map(mapRow);
  }
}

export async function runSearch(
  store: CatalogStore,
  query: SearchQuery,
  limitPerChain: number,
  now: Date,
  staleAfterHours: number,
): Promise<{ items: ProductResult[]; candidatesScored: number }> {
  return store.withSnapshot(async (reader) => {
    const products = query.queryType === 'sku'
      ? await reader.findBySku(query.q)
      : await reader.findNameCandidates(query.q);
    return {
      items: rankProducts(products, query, limitPerChain, now, staleAfterHours),
      candidatesScored: products.length,
    };
  });
}

function mapRow(row: ProductRow): StoredProduct {
  if (!isChainId(row.chain_id)) throw new HttpError(503, 'UNAVAILABLE', 'Database unavailable');
  return {
    chainId: row.chain_id,
    itemCode: row.item_code,
    name: row.name,
    manufacturer: row.manufacturer,
    price: row.price,
    packageQuantity: row.package_quantity,
    packageUnit: packageUnit(row.package_unit),
    sourceQuantity: row.source_quantity,
    sourceUnitQty: row.source_unit_qty,
    itemPriceUpdatedAt: row.item_price_updated_at,
    isWeighted: row.is_weighted,
    sampleCount: row.sample_count,
    sourceUpdatedAt: row.source_updated_at,
    updatedAt: row.updated_at,
    normalizedName: row.normalized_name,
    nameTokens: row.name_tokens,
  };
}

function packageUnit(value: string | null): PackageUnit | null {
  if (value === null) return null;
  if (value === 'g' || value === 'ml' || value === 'unit') return value;
  throw new HttpError(503, 'UNAVAILABLE', 'Database unavailable');
}
