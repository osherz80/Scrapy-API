/**
 * Adopted from Neuton-Back `src/lib/supermarket/prices.ts` on 2026-10-31.
 * `normalizeQuery`, `tokenize`, and `scoreMatch` follow that source, including `Math.round`.
 * Geresh U+05F3, gershayim U+05F4, and dagesh U+05BC are stripped as separate code points.
 * A match is usable only when its score is strictly greater than `SEARCH_MIN_SCORE`.
 */
export const SEARCH_MIN_SCORE = 2500;

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['"\u05F3\u05F4]/g, '')
    .replace(/\u05BC/g, '')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .split(/[\s\-,]+/)
    .filter(Boolean);
}

export function scoreMatch(
  name: string,
  barcode: string,
  manufacturer: string,
  query: string,
): number {
  const q = normalizeQuery(query);
  const b = barcode.toLowerCase();

  if (q && b === q) return 10000;
  if (q && name.toLowerCase() === q) return 9500;

  const qTokens = tokenize(query);
  const nTokens = tokenize(name);
  const mTokens = tokenize(manufacturer);
  if (qTokens.length === 0) return 0;

  const matchedTokens = qTokens.filter((token) => nTokens.includes(token));
  const recallRatio = matchedTokens.length / qTokens.length;
  if (recallRatio === 0) return 0;

  const extraTokens = nTokens.filter((token) => !qTokens.includes(token));
  const extraRatio = extraTokens.length / nTokens.length;
  let score = Math.round(6000 * recallRatio * (1 - extraRatio));

  const normalizedName = normalizeQuery(name);
  if (q && normalizedName.includes(q)) {
    score += 2000;
    if (normalizedName.startsWith(q)) score += 2000;
  }

  const manufacturerOverlap = qTokens.filter((token) => mTokens.includes(token)).length;
  score += manufacturerOverlap * 50;

  const lengthFactor = Math.max(0.4, 1 / Math.log(Math.max(3, nTokens.length)));
  score = Math.round(score * lengthFactor);
  return Math.max(0, score);
}

export function acceptsScore(score: number): boolean {
  return score > SEARCH_MIN_SCORE;
}
