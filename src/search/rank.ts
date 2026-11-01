import { toSearchResult, type SearchResult } from './row-result.ts';
import { acceptsScore, scoreMatch } from './score.ts';

/**
 * A camelCase `public.products` row. Scoring fields are explicit; every other
 * column is carried through untouched so schema additions need no API change.
 */
export interface StoredProduct {
  chainId: string;
  itemCode: string;
  itemName: string | null;
  manufactureName: string | null;
  nameTokens: string[];
  [column: string]: unknown;
}

export interface SearchQuery {
  queryType: 'name' | 'sku';
  q: string;
}

interface Scored {
  product: StoredProduct;
  score: number;
}

export function rankProducts(
  products: readonly StoredProduct[],
  query: SearchQuery,
  limitPerChain: number,
): SearchResult[] {
  const ranker = createRanker(limitPerChain);
  for (let index = 0; index < products.length; index += 200) {
    ranker.add(products.slice(index, index + 200), query);
  }
  return ranker.finish();
}

export function createRanker(limitPerChain: number): {
  add(products: readonly StoredProduct[], query: SearchQuery): void;
  finish(): SearchResult[];
} {
  const byChain = new Map<string, Scored[]>();
  return {
    add(products, query) {
      for (const product of products) {
        const score = scoreOf(product, query);
        if (!acceptsScore(score)) continue;
        const current = byChain.get(product.chainId) ?? [];
        current.push({ product, score });
        current.sort(compareWithinChain);
        byChain.set(product.chainId, current.slice(0, limitPerChain));
      }
    },
    finish() {
      const selected = [...byChain.values()].flat();
      selected.sort(compareGlobal);
      return selected.map(({ product, score }) => toSearchResult(product, score));
    },
  };
}

function scoreOf(product: StoredProduct, query: SearchQuery): number {
  if (query.queryType === 'sku') return product.itemCode === query.q ? 10000 : 0;
  return scoreMatch(product.itemName ?? '', product.itemCode, product.manufactureName ?? '', query.q);
}

function compareWithinChain(left: Scored, right: Scored): number {
  return right.score - left.score || left.product.itemCode.localeCompare(right.product.itemCode);
}

function compareGlobal(left: Scored, right: Scored): number {
  return (
    right.score - left.score ||
    left.product.chainId.localeCompare(right.product.chainId) ||
    left.product.itemCode.localeCompare(right.product.itemCode)
  );
}
