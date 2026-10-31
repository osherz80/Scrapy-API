import type { FastifyInstance } from 'fastify';

import type { CatalogStore } from '../db/catalog.ts';
import { runSearch } from '../db/catalog.ts';
import { HttpError } from '../http/errors.ts';
import type { RateLimiter } from '../http/rate-limit.ts';
import { parseBatch, parseLimitPerChain, parseSearchQuery, rejectUnknownQueryKeys } from '../http/search-input.ts';
import type { Logger } from '../logger/types.ts';
import { rankProducts } from '../search/rank.ts';

export function registerSearch(
  app: FastifyInstance,
  store: CatalogStore,
  logger: Logger,
  options: { staleAfterHours: number; now: () => Date; rateLimit: RateLimiter },
): void {
  app.get('/v1/search', async (request) => {
    take(options.rateLimit, 'search');
    const query = request.query as Record<string, unknown>;
    rejectUnknownQueryKeys(query, ['queryType', 'q', 'limitPerChain']);
    const parsed = parseSearchQuery({ queryType: query.queryType, q: query.q });
    const limitPerChain = parseLimitPerChain(query.limitPerChain);
    const started = Date.now();
    const result = await guardDatabase(() => runSearch(store, parsed, limitPerChain, options.now(), options.staleAfterHours));
    request.observation.queryType = parsed.queryType;
    request.observation.resultCount = result.items.length;
    logger.info('search', {
      requestId: request.id,
      queryType: parsed.queryType,
      resultCount: result.items.length,
      candidatesScored: result.candidatesScored,
      databaseMs: Date.now() - started,
    });
    return result.items;
  });

  app.post('/v1/search/batch', async (request) => {
    take(options.rateLimit, 'search');
    const query = request.query as Record<string, unknown>;
    rejectUnknownQueryKeys(query, ['limitPerChain']);
    const limitPerChain = parseLimitPerChain(query.limitPerChain);
    const queries = parseBatch(request.body);
    const started = Date.now();
    const results = await guardDatabase(() => store.withSnapshot(async (reader) => {
      const rows = [];
      for (const entry of queries) {
        const products = entry.queryType === 'sku'
          ? await reader.findBySku(entry.q)
          : await reader.findNameCandidates(entry.q);
        rows.push({
          id: entry.id,
          items: rankProducts(products, entry, limitPerChain, options.now(), options.staleAfterHours),
          candidates: products.length,
        });
      }
      return rows;
    }));
    request.observation.queryType = 'batch';
    request.observation.resultCount = results.reduce((sum, row) => sum + row.items.length, 0);
    logger.info('search', {
      requestId: request.id,
      queryType: 'batch',
      resultCount: request.observation.resultCount,
      candidatesScored: results.reduce((sum, row) => sum + row.candidates, 0),
      databaseMs: Date.now() - started,
    });
    return { results: results.map(({ id, items }) => ({ id, items })) };
  });
}

async function guardDatabase<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'UNAVAILABLE', 'Database unavailable', undefined, 5);
  }
}

function take(rateLimit: RateLimiter, bucket: 'search'): void {
  const decision = rateLimit.take(bucket);
  if (!decision.allowed) {
    throw new HttpError(429, 'RATE_LIMITED', 'Rate limit exceeded', undefined, decision.retryAfterSeconds);
  }
}
