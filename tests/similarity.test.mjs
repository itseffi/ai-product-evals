import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSimilarityResult } from '../similarity.mjs';

test('semantic similarity result is flagged as a weak correctness signal', () => {
  const result = buildSimilarityResult(0.95, 0.7);
  assert.equal(result.pass, true);
  assert.equal(result.score, 0.95);
  assert.equal(result.weakSignal, true);
  assert.match(result.warning, /retrieval|reference/i);
});

test('similarity below threshold does not pass', () => {
  const result = buildSimilarityResult(0.4, 0.7);
  assert.equal(result.pass, false);
  assert.equal(result.weakSignal, true);
});
