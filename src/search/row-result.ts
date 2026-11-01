/**
 * Columns that exist for ingestion or search plumbing and never belong in a
 * response. Keys are camelCase because rows are converted before this runs.
 */
export const INTERNAL_COLUMNS = new Set(['runId', 'updatedAt', 'nameTokens', 'normalizedName']);

export type SearchResult = Record<string, unknown> & { score: number };

/**
 * Returns the raw row minus internal columns, plus the score. `score` is
 * assigned last so a future database column named `score` cannot override it.
 */
export function toSearchResult(row: Record<string, unknown>, score: number): SearchResult {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!INTERNAL_COLUMNS.has(key)) result[key] = value;
  }
  result.score = score;
  return result as SearchResult;
}
