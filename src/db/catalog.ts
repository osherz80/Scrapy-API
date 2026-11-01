import type pg from 'pg';

import { HttpError } from '../http/errors.ts';
import type { Logger } from '../logger/types.ts';
import { NAME_CANDIDATE_SQL, SKU_SQL } from '../search/candidates.ts';
import { rankProducts, type SearchQuery, type StoredProduct } from '../search/rank.ts';
import type { SearchResult } from '../search/row-result.ts';
import { normalizeQuery, tokenize } from '../search/score.ts';
import { camelizeRow } from './rows.ts';

export interface CatalogReader {
  findBySku(itemCode: string): Promise<StoredProduct[]>;
  findNameCandidates(query: string): Promise<StoredProduct[]>;
}

export interface CatalogStore {
  withSnapshot<T>(fn: (reader: CatalogReader) => Promise<T>): Promise<T>;
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
    const result = await this.client.query(SKU_SQL, [itemCode]);
    return result.rows.map(asStoredProduct);
  }

  async findNameCandidates(query: string): Promise<StoredProduct[]> {
    const result = await this.client.query(NAME_CANDIDATE_SQL, [
      query.trim(),
      normalizeQuery(query),
      tokenize(query),
    ]);
    return result.rows.map(asStoredProduct);
  }
}

export async function runSearch(
  store: CatalogStore,
  query: SearchQuery,
  limitPerChain: number,
): Promise<{ items: SearchResult[]; candidatesScored: number }> {
  return store.withSnapshot(async (reader) => {
    const products = query.queryType === 'sku'
      ? await reader.findBySku(query.q)
      : await reader.findNameCandidates(query.q);
    return {
      items: rankProducts(products, query, limitPerChain),
      candidatesScored: products.length,
    };
  });
}

function asStoredProduct(row: Record<string, unknown>): StoredProduct {
  return camelizeRow(row) as StoredProduct;
}
