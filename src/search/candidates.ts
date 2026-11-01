import { normalizeQuery, tokenize } from './score.ts';

export interface StoredCandidate {
  itemCode: string;
  itemName: string | null;
  nameTokens: readonly string[];
}

/**
 * Name-search recall rule shared by SQL and tests. Manufacturer text is not a
 * candidate path. The exact-name branch mirrors `lower(btrim(item_name)) = $2`
 * in the SQL, which is the only exact-name recall path now that
 * `normalized_name` is gone.
 */
export function matchesStoredCandidate(product: StoredCandidate, query: string): boolean {
  const q = query.trim();
  if (q.length === 0) return false;
  if (product.itemCode === q) return true;
  if (product.itemName !== null && normalizeQuery(product.itemName) === normalizeQuery(q)) return true;
  return tokenize(q).some((token) => product.nameTokens.includes(token));
}

export const NAME_CANDIDATE_SQL = `
SELECT *
FROM public.products
WHERE item_code = $1
   OR lower(btrim(item_name)) = $2
   OR name_tokens && $3::text[]
`;

export const SKU_SQL = `
SELECT *
FROM public.products
WHERE item_code = $1
`;
