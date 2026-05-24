// Calibration is an aggregate property, not a per-example one. These operate on
// {p, outcome} pairs: p in [0,1] is the model's stated confidence, outcome is 0/1.
export function brierScore(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const sum = pairs.reduce((acc, { p, outcome }) => acc + (Number(p) - Number(outcome)) ** 2, 0);
  return sum / pairs.length;
}

export function expectedCalibrationError(pairs, bins = 10) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const buckets = Array.from({ length: bins }, () => ({ n: 0, conf: 0, acc: 0 }));
  for (const { p, outcome } of pairs) {
    const value = Math.min(1, Math.max(0, Number(p)));
    const index = Math.min(bins - 1, Math.floor(value * bins));
    buckets[index].n += 1;
    buckets[index].conf += value;
    buckets[index].acc += Number(outcome);
  }
  const n = pairs.length;
  let ece = 0;
  for (const bucket of buckets) {
    if (bucket.n === 0) continue;
    ece += (bucket.n / n) * Math.abs(bucket.acc / bucket.n - bucket.conf / bucket.n);
  }
  return ece;
}

export function calibrationSummary(pairs, bins = 10) {
  if (!Array.isArray(pairs) || pairs.length === 0) return null;
  const round = value => Math.round(value * 1e6) / 1e6;
  return { n: pairs.length, brier: round(brierScore(pairs)), ece: round(expectedCalibrationError(pairs, bins)), bins };
}

// Pull (confidence, outcome) pairs from confidence_calibration results that have a
// real binary ground truth; probability targets (expectedConfidence not 0/1) are skipped.
export function collectCalibrationPairs(results) {
  const pairs = [];
  for (const result of results || []) {
    if (result?.evalType !== 'confidence_calibration') continue;
    const metrics = result.metadata?.metrics || result.metrics;
    if (!metrics) continue;
    const p = Number(metrics.confidence);
    const outcome = Number(metrics.expectedConfidence);
    if (!Number.isFinite(p)) continue;
    if (outcome !== 0 && outcome !== 1) continue;
    pairs.push({ p, outcome });
  }
  return pairs;
}

export function confusionCounts(rows) {
  const decisiveRows = rows.filter(row =>
    row.humanPass !== null
    && row.humanPass !== undefined
    && row.judgePass !== null
    && row.judgePass !== undefined
    && !row.parseError
    && !row.evalError
  );

  const truePositive = decisiveRows.filter(row => row.humanPass === true && row.judgePass === true).length;
  const trueNegative = decisiveRows.filter(row => row.humanPass === false && row.judgePass === false).length;
  const falsePositive = decisiveRows.filter(row => row.humanPass === false && row.judgePass === true).length;
  const falseNegative = decisiveRows.filter(row => row.humanPass === true && row.judgePass === false).length;

  return {
    truePositive,
    trueNegative,
    falsePositive,
    falseNegative,
    total: decisiveRows.length,
  };
}

export function binaryAgreementMetrics(rows) {
  const counts = confusionCounts(rows);
  const observedAgreement = counts.total > 0
    ? (counts.truePositive + counts.trueNegative) / counts.total
    : 0;

  const humanPositive = counts.truePositive + counts.falseNegative;
  const humanNegative = counts.trueNegative + counts.falsePositive;
  const judgePositive = counts.truePositive + counts.falsePositive;
  const judgeNegative = counts.trueNegative + counts.falseNegative;
  const expectedAgreement = counts.total > 0
    ? ((humanPositive * judgePositive) + (humanNegative * judgeNegative)) / (counts.total * counts.total)
    : 0;
  const cohensKappa = counts.total > 0 && expectedAgreement !== 1
    ? (observedAgreement - expectedAgreement) / (1 - expectedAgreement)
    : 0;

  return {
    ...counts,
    agreement: observedAgreement,
    expectedAgreement,
    cohensKappa,
  };
}

export function reviewerAgreement(labels) {
  const comparisons = [];

  for (const label of labels) {
    const reviewerLabels = Array.isArray(label.reviewer_labels) ? label.reviewer_labels : [];
    for (let i = 0; i < reviewerLabels.length; i++) {
      for (let j = i + 1; j < reviewerLabels.length; j++) {
        const a = reviewerLabels[i];
        const b = reviewerLabels[j];
        if (typeof a.human_pass === 'boolean' && typeof b.human_pass === 'boolean') {
          comparisons.push({
            humanPass: a.human_pass,
            judgePass: b.human_pass,
            parseError: false,
            evalError: false,
          });
        }
      }
    }
  }

  return {
    pairs: comparisons.length,
    ...binaryAgreementMetrics(comparisons),
  };
}
