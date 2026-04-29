#!/usr/bin/env node

import { dirname, resolve } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { loadLabels, parseBoolean, validateLabel } from '../labels/schema.mjs';
import { evaluate } from '../evaluators/index.mjs';
import { getProvider } from '../providers/index.mjs';
import { binaryAgreementMetrics, reviewerAgreement } from '../evaluators/metrics.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const templateIndex = args.indexOf('--judge-template');
  const providerIndex = args.indexOf('--judge-provider');
  const modelIndex = args.indexOf('--judge-model');
  const repeatIndex = args.indexOf('--repeat');
  const timeoutIndex = args.indexOf('--timeout-ms');
  const panelIndex = args.indexOf('--judge-panel');
  const minAgreementIndex = args.indexOf('--min-agreement');
  const minStabilityIndex = args.indexOf('--min-stability');
  const baselineIndex = args.indexOf('--drift-baseline');
  const writeBaselineIndex = args.indexOf('--write-baseline');
  const maxAgreementDropIndex = args.indexOf('--max-agreement-drop');
  const maxStabilityDropIndex = args.indexOf('--max-stability-drop');
  const maxCallsIndex = args.indexOf('--max-calls');
  const maxCallCostIndex = args.indexOf('--max-call-cost');
  const streamJsonlIndex = args.indexOf('--stream-jsonl');
  return {
    input: args.find(arg => !arg.startsWith('-')) || 'labels/sample-goldens.json',
    json: args.includes('--json'),
    judgeTemplate: templateIndex >= 0 ? args[templateIndex + 1] : undefined,
    judgeProviderName: providerIndex >= 0 ? args[providerIndex + 1] : process.env.JUDGE_PROVIDER,
    judgeModel: modelIndex >= 0 ? args[modelIndex + 1] : process.env.JUDGE_MODEL,
    judgePanelSpec: panelIndex >= 0 ? args[panelIndex + 1] : process.env.JUDGE_PANEL,
    repeat: repeatIndex >= 0 ? Number(args[repeatIndex + 1]) : Number(process.env.JUDGE_REPEAT || 1),
    timeoutMs: timeoutIndex >= 0 ? Number(args[timeoutIndex + 1]) : Number(process.env.JUDGE_TIMEOUT_MS || 180000),
    minAgreement: minAgreementIndex >= 0 ? Number(args[minAgreementIndex + 1]) : Number(process.env.JUDGE_MIN_AGREEMENT || 0.9),
    minStability: minStabilityIndex >= 0 ? Number(args[minStabilityIndex + 1]) : Number(process.env.JUDGE_MIN_STABILITY || 1),
    driftBaseline: baselineIndex >= 0 ? args[baselineIndex + 1] : process.env.JUDGE_DRIFT_BASELINE,
    writeBaseline: writeBaselineIndex >= 0 ? args[writeBaselineIndex + 1] : process.env.JUDGE_WRITE_BASELINE,
    maxAgreementDrop: maxAgreementDropIndex >= 0 ? Number(args[maxAgreementDropIndex + 1]) : Number(process.env.JUDGE_MAX_AGREEMENT_DROP || 0.05),
    maxStabilityDrop: maxStabilityDropIndex >= 0 ? Number(args[maxStabilityDropIndex + 1]) : Number(process.env.JUDGE_MAX_STABILITY_DROP || 0.05),
    maxCalls: maxCallsIndex >= 0 ? Number(args[maxCallsIndex + 1]) : optionalNumber(process.env.MAX_CALLS),
    maxCallCostUsd: maxCallCostIndex >= 0 ? Number(args[maxCallCostIndex + 1]) : optionalNumber(process.env.MAX_COST_PER_CALL_USD),
    streamJsonl: streamJsonlIndex >= 0 || parseBoolean(process.env.VALIDATOR_STREAM_JSONL) === true,
    streamJsonlPath: streamJsonlIndex >= 0 && args[streamJsonlIndex + 1] && !args[streamJsonlIndex + 1].startsWith('-')
      ? args[streamJsonlIndex + 1]
      : process.env.STREAM_JSONL_OUTPUT,
    progress: args.includes('--progress') || parseBoolean(process.env.VALIDATOR_PROGRESS) === true,
  };
}

const config = parseArgs();
initJsonlStream(config);
const labels = loadLabels(resolve(process.cwd(), config.input));
const usable = labels.filter(label => validateLabel(label).length === 0);

let judgeProvider = null;
let judgePanel = [];
if (config.judgeProviderName) {
  if (config.judgeProviderName === 'claude-code') {
    console.error('`claude-code` is not supported for static judge validation. Use a text-completion provider such as anthropic, openai, google, openrouter, or ollama.');
    process.exit(2);
  }
  judgeProvider = getProvider(config.judgeProviderName);
}
if (config.judgePanelSpec) {
  judgePanel = config.judgePanelSpec.split(',').map(member => {
    const separator = member.indexOf(':');
    const providerName = separator >= 0 ? member.slice(0, separator) : member;
    const provider = getProvider(providerName);
    return {
      providerName,
      provider,
      model: separator >= 0 ? member.slice(separator + 1) : provider.defaultModel,
    };
  });
}

const rows = [];
const callBudget = createCallBudget(config.maxCalls);
for (const label of usable) {
  if (config.progress && !config.json) {
    console.error(`Validating ${label.id} (${rows.length + 1}/${usable.length})`);
  }

  const testCase = {
    name: label.id,
    prompt: label.prompt,
    criteria: ['matches_human_judgment'],
    judge_template: config.judgeTemplate || label.metadata?.judge_template || 'general-product-quality',
    metadata: {
      human_pass: label.human_pass,
      critique: label.critique,
      failure_mode: label.failure_mode,
    },
  };

  const attempts = [];
  for (let attempt = 1; attempt <= Math.max(config.repeat, 1); attempt++) {
    const result = await evaluate(testCase, label.response, {
      judgeProvider,
      judgeModel: config.judgeModel,
      judgePanel,
      timeoutMs: config.timeoutMs,
      callBudget,
      maxCallCostUsd: config.maxCallCostUsd,
    });
    attempts.push({
      attempt,
      pass: result.pass,
      score: result.score,
      reason: result.reason,
      judgeResponse: result.judgeResponse || '',
      parseError: result.parseError || false,
      evalError: result.evalError || false,
    });
  }

  const decisiveAttempts = attempts.filter(attempt => !attempt.parseError && !attempt.evalError);
  const trueVotes = decisiveAttempts.filter(attempt => attempt.pass === true).length;
  const falseVotes = decisiveAttempts.filter(attempt => attempt.pass === false).length;
  const judgePass = trueVotes > falseVotes
    ? true
    : falseVotes > trueVotes
      ? false
      : null;
  const stable = decisiveAttempts.length > 0
    && decisiveAttempts.length === attempts.length
    && decisiveAttempts.every(attempt => attempt.pass === decisiveAttempts[0].pass);
  const avgScore = decisiveAttempts.length > 0
    ? decisiveAttempts.reduce((sum, attempt) => sum + (attempt.score || 0), 0) / decisiveAttempts.length
    : 0;
  const primary = attempts[0];

  rows.push({
    id: label.id,
    humanPass: label.human_pass,
    judgePass,
    agreement: judgePass === null ? null : judgePass === label.human_pass,
    stable,
    trueVotes,
    falseVotes,
    score: avgScore,
    reason: primary.reason,
    judgeResponse: primary.judgeResponse || '',
    parseError: attempts.some(attempt => attempt.parseError),
    evalError: attempts.some(attempt => attempt.evalError),
    attempts,
    failureMode: label.failure_mode,
    critique: label.critique,
  });
  emitJsonlEvent(config, { type: 'label_result', row: rows[rows.length - 1], callsUsed: callBudget.used, maxCalls: callBudget.maxCalls });
}

const parseErrorCount = rows.filter(r => r.parseError).length;
const evalErrorCount = rows.filter(r => r.evalError).length;
const decisiveRows = rows.filter(row =>
  row.humanPass !== null
  && row.humanPass !== undefined
  && row.judgePass !== null
  && row.judgePass !== undefined
  && !row.parseError
  && !row.evalError
);
const metrics = binaryAgreementMetrics(rows);
const humanHumanAgreement = reviewerAgreement(usable);
const stableCount = rows.filter(r => r.stable).length;
const stability = rows.length > 0 ? stableCount / rows.length : 0;
const thresholdFailures = [];
if (decisiveRows.length === 0) {
  thresholdFailures.push('No decisive judge rows were produced');
}
if (metrics.agreement < config.minAgreement) {
  thresholdFailures.push(`Agreement ${formatPercent(metrics.agreement)} is below threshold ${formatPercent(config.minAgreement)}`);
}
if (stability < config.minStability) {
  thresholdFailures.push(`Stability ${formatPercent(stability)} is below threshold ${formatPercent(config.minStability)}`);
}
const drift = loadDriftBaseline(config.driftBaseline, {
  agreement: metrics.agreement,
  stability,
  maxAgreementDrop: config.maxAgreementDrop,
  maxStabilityDrop: config.maxStabilityDrop,
});

const report = {
  labels: labels.length,
  usable: usable.length,
  repeat: Math.max(config.repeat, 1),
  agreement: metrics.agreement,
  expectedAgreement: metrics.expectedAgreement,
  cohensKappa: metrics.cohensKappa,
  humanHumanAgreement,
  parseErrorCount,
  evalErrorCount,
  stability,
  thresholds: {
    minAgreement: config.minAgreement,
    minStability: config.minStability,
    failures: thresholdFailures,
  },
  drift,
  unstable: rows.filter(r => !r.stable).map(r => ({
    id: r.id,
    humanPass: r.humanPass,
    trueVotes: r.trueVotes,
    falseVotes: r.falseVotes,
    attempts: r.attempts,
  })),
  confusionMatrix: {
    truePositive: metrics.truePositive,
    trueNegative: metrics.trueNegative,
    falsePositive: metrics.falsePositive,
    falseNegative: metrics.falseNegative,
  },
  disagreements: rows.filter(r => r.agreement === false),
  failures: rows.filter(r => r.parseError || r.evalError),
  rows,
  callsUsed: callBudget.used,
  maxCalls: callBudget.maxCalls,
};

if (config.writeBaseline) {
  writeFileSync(resolve(process.cwd(), config.writeBaseline), JSON.stringify(report, null, 2), 'utf8');
}

if (config.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('# Evaluator Validation');
  console.log('');
  console.log(`- Labels: ${report.labels}`);
  console.log(`- Usable labels: ${report.usable}`);
  console.log(`- Repeats per label: ${report.repeat}`);
  console.log(`- Agreement: ${Math.round(metrics.agreement * 100)}%`);
  console.log(`- Minimum agreement: ${Math.round(config.minAgreement * 100)}%`);
  console.log(`- Cohen's kappa: ${metrics.cohensKappa.toFixed(3)}`);
  if (humanHumanAgreement.pairs > 0) {
    console.log(`- Human-human agreement: ${Math.round(humanHumanAgreement.agreement * 100)}%`);
    console.log(`- Human-human Cohen's kappa: ${humanHumanAgreement.cohensKappa.toFixed(3)}`);
  }
  console.log(`- Stable labels: ${stableCount}/${rows.length} (${Math.round(report.stability * 100)}%)`);
  console.log(`- Minimum stability: ${Math.round(config.minStability * 100)}%`);
  console.log(`- Parse/format failures: ${parseErrorCount}`);
  console.log(`- Provider/evaluator failures: ${evalErrorCount}`);
  console.log(`- True positives: ${metrics.truePositive}`);
  console.log(`- True negatives: ${metrics.trueNegative}`);
  console.log(`- False positives: ${metrics.falsePositive}`);
  console.log(`- False negatives: ${metrics.falseNegative}`);
  console.log('');

  if (report.thresholds.failures.length > 0) {
    console.log('## Threshold Failures');
    console.log('');
    for (const failure of report.thresholds.failures) {
      console.log(`- ${failure}`);
    }
    console.log('');
  }

  if (report.drift?.checked) {
    console.log('## Drift Check');
    console.log('');
    console.log(`- Baseline: ${report.drift.baselinePath}`);
    console.log(`- Agreement drop: ${formatPercent(report.drift.agreementDrop)}`);
    console.log(`- Stability drop: ${formatPercent(report.drift.stabilityDrop)}`);
    for (const failure of report.drift.failures) {
      console.log(`- ${failure}`);
    }
    console.log('');
  }

  if (report.unstable.length > 0) {
    console.log('## Unstable Judge Decisions');
    console.log('');
    for (const row of report.unstable) {
      console.log(`- ${row.id}: true votes=${row.trueVotes}, false votes=${row.falseVotes}`);
      for (const attempt of row.attempts) {
        console.log(`  - attempt ${attempt.attempt}: pass=${attempt.pass} score=${attempt.score} reason=${attempt.reason}`);
      }
    }
    console.log('');
  }

  const parseFailures = rows.filter(row => row.parseError);
  if (parseFailures.length > 0) {
    console.log('## Parse Or Format Failures');
    console.log('');
    for (const row of parseFailures) {
      console.log(`- ${row.id}: ${row.reason}`);
      if (row.judgeResponse) {
        console.log(`  - Raw judge response: ${row.judgeResponse}`);
      }
    }
    console.log('');
  }

  const evalFailures = rows.filter(row => row.evalError);
  if (evalFailures.length > 0) {
    console.log('## Provider Or Evaluator Failures');
    console.log('');
    for (const row of evalFailures) {
      console.log(`- ${row.id}: ${row.reason}`);
    }
    console.log('');
  }

  if (report.disagreements.length > 0) {
    console.log('## Disagreements');
    console.log('');
    for (const row of report.disagreements) {
      console.log(`- ${row.id}: human=${row.humanPass} judge=${row.judgePass} score=${row.score}`);
      console.log(`  - Judge: ${row.reason}`);
      if (row.parseError && row.judgeResponse) {
        console.log(`  - Raw judge response: ${row.judgeResponse}`);
      }
      console.log(`  - Human: ${row.critique}`);
    }
  } else {
    console.log('No disagreements found.');
  }
}
emitJsonlEvent(config, { type: 'summary', report: { ...report, rows: undefined } });

if (
  parseErrorCount > 0
  || evalErrorCount > 0
  || thresholdFailures.length > 0
  || drift.failures.length > 0
) {
  process.exitCode = 1;
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createCallBudget(maxCalls) {
  return {
    maxCalls,
    used: 0,
    consume(kind, details = {}) {
      if (maxCalls === null || maxCalls === undefined) return null;
      if (this.used >= maxCalls) {
        throw new Error(`Max calls exceeded before ${kind} call (${this.used}/${maxCalls})`);
      }
      this.used += 1;
      return { index: this.used, max: maxCalls, kind, ...details };
    },
  };
}

function emitJsonlEvent(config, event) {
  if (!config.streamJsonl) return;
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n';
  if (config.streamJsonlPath) {
    const streamPath = resolve(process.cwd(), config.streamJsonlPath);
    mkdirSync(dirname(streamPath), { recursive: true });
    writeFileSync(streamPath, line, { flag: 'a' });
  } else {
    process.stderr.write(line);
  }
}

function initJsonlStream(config) {
  if (config.streamJsonl && config.streamJsonlPath) {
    const streamPath = resolve(process.cwd(), config.streamJsonlPath);
    mkdirSync(dirname(streamPath), { recursive: true });
    writeFileSync(streamPath, '', 'utf8');
  }
}

function loadDriftBaseline(baselinePath, current) {
  const empty = {
    checked: false,
    baselinePath: baselinePath || null,
    agreementDrop: 0,
    stabilityDrop: 0,
    failures: [],
  };
  if (!baselinePath) return empty;

  const resolved = resolve(process.cwd(), baselinePath);
  if (!existsSync(resolved)) {
    return {
      ...empty,
      checked: true,
      baselinePath: resolved,
      failures: [`Drift baseline not found: ${resolved}`],
    };
  }

  const baseline = JSON.parse(readFileSync(resolved, 'utf8'));
  const agreementDrop = Number(baseline.agreement || 0) - current.agreement;
  const stabilityDrop = Number(baseline.stability || 0) - current.stability;
  const failures = [];
  if (agreementDrop > current.maxAgreementDrop) {
    failures.push(`Agreement dropped by ${formatPercent(agreementDrop)} from baseline`);
  }
  if (stabilityDrop > current.maxStabilityDrop) {
    failures.push(`Stability dropped by ${formatPercent(stabilityDrop)} from baseline`);
  }

  return {
    checked: true,
    baselinePath: resolved,
    baselineAgreement: baseline.agreement,
    baselineStability: baseline.stability,
    agreementDrop,
    stabilityDrop,
    maxAgreementDrop: current.maxAgreementDrop,
    maxStabilityDrop: current.maxStabilityDrop,
    failures,
  };
}
