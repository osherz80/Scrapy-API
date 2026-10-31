import { HttpError } from './errors.ts';
import type { SearchQuery } from '../search/rank.ts';

export interface BatchQuery extends SearchQuery {
  id: string;
}

export function parseLimitPerChain(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^(?:[1-9]|10)$/.test(value)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'limitPerChain must be between 1 and 10', [
      { path: 'limitPerChain' },
    ]);
  }
  return Number(value);
}

export function parseSearchQuery(input: { queryType: unknown; q: unknown }): SearchQuery {
  if (input.queryType !== 'name' && input.queryType !== 'sku') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'queryType must be name or sku', [{ path: 'queryType' }]);
  }
  if (typeof input.q !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'q must be a string', [{ path: 'q' }]);
  }
  const q = input.q.trim();
  if (q.length < 1 || q.length > 200) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'q must be between 1 and 200 characters', [{ path: 'q' }]);
  }
  return { queryType: input.queryType, q };
}

export function parseBatch(body: unknown): BatchQuery[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: '' }]);
  }
  const record = body as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => key !== 'queries');
  if (unknownKey) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: unknownKey }]);
  }
  if (!Array.isArray(record.queries) || record.queries.length < 1 || record.queries.length > 10) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'queries must contain between 1 and 10 entries', [
      { path: 'queries' },
    ]);
  }
  const ids = new Set<string>();
  return record.queries.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: `queries.${index}` }]);
    }
    const query = entry as Record<string, unknown>;
    const extra = Object.keys(query).find((key) => key !== 'id' && key !== 'queryType' && key !== 'q');
    if (extra) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: `queries.${index}.${extra}` }]);
    }
    if (typeof query.id !== 'string' || query.id.trim() === '' || query.id.length > 64) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'query id must be 1 to 64 characters', [
        { path: `queries.${index}.id` },
      ]);
    }
    if (ids.has(query.id)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'query ids must be unique', [{ path: `queries.${index}.id` }]);
    }
    ids.add(query.id);
    const parsed = parseSearchQuery({ queryType: query.queryType, q: query.q });
    return { id: query.id, ...parsed };
  });
}

export function rejectUnknownQueryKeys(query: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(query).find((key) => !allowed.includes(key));
  if (extra) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: extra }]);
}
