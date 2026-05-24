import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brierScore, expectedCalibrationError, calibrationSummary, collectCalibrationPairs } from '../evaluators/metrics.mjs';

test('brierScore is mean squared error of probability vs outcome', () => {
  assert.equal(brierScore([]), null);
  assert.equal(brierScore([{ p: 1, outcome: 1 }, { p: 0, outcome: 0 }]), 0);
  assert.ok(Math.abs(brierScore([{ p: 0.7, outcome: 1 }, { p: 0.2, outcome: 0 }]) - 0.065) < 1e-9);
});

test('expectedCalibrationError is zero when confidence matches accuracy', () => {
  assert.equal(expectedCalibrationError([{ p: 1, outcome: 1 }, { p: 0, outcome: 0 }]), 0);
  // bin(0.9)=acc 1 -> gap 0.1; bin(0.1)=acc 0 -> gap 0.1; weighted = 0.1
  assert.ok(Math.abs(expectedCalibrationError([{ p: 0.9, outcome: 1 }, { p: 0.1, outcome: 0 }]) - 0.1) < 1e-9);
});

test('collectCalibrationPairs takes binary-outcome confidence cases only', () => {
  const results = [
    { evalType: 'confidence_calibration', metadata: { metrics: { confidence: 0.8, expectedConfidence: 1 } } },
    { evalType: 'confidence_calibration', metadata: { metrics: { confidence: 0.3, expectedConfidence: 0 } } },
    { evalType: 'confidence_calibration', metadata: { metrics: { confidence: 0.5, expectedConfidence: 0.7 } } }, // ambiguous target, skip
    { evalType: 'contains', metadata: {} },
  ];
  assert.deepEqual(collectCalibrationPairs(results), [
    { p: 0.8, outcome: 1 },
    { p: 0.3, outcome: 0 },
  ]);
});

test('calibrationSummary is null without pairs', () => {
  assert.equal(calibrationSummary([]), null);
});
