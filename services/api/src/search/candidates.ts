import { normalizeQuery, tokenize } from './score.ts';

export interface StoredCandidate {
  itemCode: string;
  normalizedName: string;
  nameTokens: readonly string[];
}

/** Name-search recall rule shared by SQL and tests. Manufacturer text is not a candidate path. */
export function matchesStoredCandidate(product: StoredCandidate, query: string): boolean {
  const q = query.trim();
  if (q.length === 0) return false;
  if (product.itemCode === q) return true;
  if (product.normalizedName === normalizeQuery(q)) return true;
  const tokens = tokenize(q);
  return tokens.some((token) => product.nameTokens.includes(token));
}

export const NAME_CANDIDATE_SQL = `
SELECT chain_id, item_code, name, manufacturer, price::text AS price,
       package_quantity::text AS package_quantity, package_unit,
       source_quantity::text AS source_quantity, source_unit_qty,
       item_price_updated_at, is_weighted, sample_count,
       source_updated_at, updated_at, normalized_name, name_tokens
FROM supermarket.products
WHERE item_code = $1
   OR normalized_name = $2
   OR name_tokens && $3::text[]
`;

export const SKU_SQL = `
SELECT chain_id, item_code, name, manufacturer, price::text AS price,
       package_quantity::text AS package_quantity, package_unit,
       source_quantity::text AS source_quantity, source_unit_qty,
       item_price_updated_at, is_weighted, sample_count,
       source_updated_at, updated_at, normalized_name, name_tokens
FROM supermarket.products
WHERE item_code = $1
`;
