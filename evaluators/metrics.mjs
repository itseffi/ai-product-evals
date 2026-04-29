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
