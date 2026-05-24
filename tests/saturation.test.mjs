import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSaturated } from '../evaluators/metrics.mjs';

test('saturated when every decisive case lands the same way', () => {
  assert.equal(isSaturated(5, 0), true);
  assert.equal(isSaturated(0, 5), true);
  assert.equal(isSaturated(3, 2), false);
  assert.equal(isSaturated(0, 0), false);
});
