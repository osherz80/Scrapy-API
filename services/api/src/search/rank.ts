import type { ChainId } from '../contracts/chains.ts';
import { toProductResult, type CatalogProduct, type ProductResult } from './product-result.ts';
import { acceptsScore, scoreMatch } from './score.ts';

export interface StoredProduct extends CatalogProduct {
  normalizedName: string;
  nameTokens: string[];
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
  now: Date,
  staleAfterHours: number,
): ProductResult[] {
  const ranker = createRanker(limitPerChain);
  for (let index = 0; index < products.length; index += 200) {
    ranker.add(products.slice(index, index + 200), query);
  }
  return ranker.finish(now, staleAfterHours);
}

export function createRanker(limitPerChain: number): {
  add(products: readonly StoredProduct[], query: SearchQuery): void;
  finish(now: Date, staleAfterHours: number): ProductResult[];
} {
  const byChain = new Map<ChainId, Scored[]>();
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
    finish(now, staleAfterHours) {
      const selected = [...byChain.values()].flat();
      selected.sort(compareGlobal);
      return selected.map(({ product, score }) => toProductResult(product, score, now, staleAfterHours));
    },
  };
}

function scoreOf(product: StoredProduct, query: SearchQuery): number {
  if (query.queryType === 'sku') return product.itemCode === query.q ? 10000 : 0;
  return scoreMatch(product.name, product.itemCode, product.manufacturer ?? '', query.q);
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
