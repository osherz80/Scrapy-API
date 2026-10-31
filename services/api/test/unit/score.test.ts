import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { acceptsScore, normalizeQuery, scoreMatch, SEARCH_MIN_SCORE, tokenize } from '../../src/search/score.ts';

interface NormalizationFixture {
  vectors: Array<{ text: string; normalized: string; tokens: string[] }>;
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../contracts/fixtures/normalization.json', import.meta.url)),
    'utf8',
  ),
) as NormalizationFixture;

test('dagesh is removed as its own code point', () => {
  assert.deepEqual(tokenize('א\u05BC'), ['א']);
});

test('normalization fixtures match the adopted tokenizer', () => {
  for (const vector of fixture.vectors) {
    assert.equal(normalizeQuery(vector.text), vector.normalized);
    assert.deepEqual(tokenize(vector.text), vector.tokens);
  }
});

test('exact barcode and exact name keep their fixed scores', () => {
  assert.equal(scoreMatch('Milk', '0123', 'x', '0123'), 10000);
  assert.equal(scoreMatch('Milk', '123', 'x', '0123'), 0);
  assert.equal(scoreMatch('milk', '729', 'x', 'milk'), 9500);
  assert.equal(scoreMatch('milk', '729', 'x', '  MILK '), 9500);
});

test('hebrew punctuation, manufacturer overlap, and the length penalty stay fixed', () => {
  // 3500 / ln(4) = 2524.665, Math.round -> 2525
  assert.equal(scoreMatch('רוטב טבסקו 60 מ"ל', '11210000094', '', 'טבסקו'), 2525);
  // 5050 / ln(3) = 4596.70, Math.round -> 4597
  assert.equal(scoreMatch('רוטב טבסקו', '1', 'טבסקו', 'טבסקו'), 4597);
  // 7000 / ln(3) = 6371.68, Math.round -> 6372
  assert.equal(scoreMatch('חלב טרי', '1', '', 'חלב'), 6372);
  // 3000 / ln(3) = 2730.72, Math.round -> 2731
  assert.equal(scoreMatch('חלב', '1', '', 'חלב טרי'), 2731);
});

test('zero token overlap and a blank query score zero', () => {
  assert.equal(scoreMatch('לחם', '1', 'חלב', 'חלב'), 0);
  assert.equal(scoreMatch('חלב', '1', '', '   '), 0);
});

test('the acceptance threshold is strict', () => {
  assert.equal(SEARCH_MIN_SCORE, 2500);
  assert.equal(acceptsScore(2500), false);
  assert.equal(acceptsScore(2501), true);
  assert.equal(acceptsScore(scoreMatch('רוטב טבסקו 60 מ"ל', '11210000094', '', 'טבסקו')), true);
});
