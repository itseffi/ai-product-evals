#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { loadLabelsFromDir } from '../labels/schema.mjs';

const tracesDir = resolve(process.cwd(), 'traces');
const labelsDir = resolve(process.cwd(), 'labels');

function listTraceFiles() {
  if (!existsSync(tracesDir)) return [];
  return readdirSync(tracesDir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .reverse();
}

function loadTrace(traceId) {
  const file = traceId.endsWith('.json') ? traceId : `${traceId}.json`;
  const path = join(tracesDir, file);
  try {
    const trace = JSON.parse(readFileSync(path, 'utf8'));
    return {
      ...trace,
      results: Array.isArray(trace.results) ? trace.results : [],
    };
  } catch (error) {
    throw new Error(`Invalid trace JSON ${path}: ${error.message}`);
  }
}

function categorize(result) {
  const reason = `${result.evalReason || ''} ${result.response?.error || ''}`.toLowerCase();

  if (!result.success) {
    if (reason.includes('api key') || reason.includes('not configured')) return 'provider_config';
    if (reason.includes('unknown provider') || reason.includes('unknown model')) return 'provider_selection';
    if (reason.includes('timeout') || reason.includes('fetch') || reason.includes('status')) return 'provider_transport';
    return 'runner_or_provider_error';
  }

  if (reason.includes('llm judge error')) return 'judge_error';
  if (result.evalType === 'tool_call') return 'tool_use_failure';
  if (result.evalType === 'regex') return 'formatting_failure';
  if (result.evalType === 'contains' || result.evalType === 'exact_match') return 'deterministic_assertion_failure';
  if (result.evalType === 'llm_judge') return 'subjective_quality_failure';
  if (result.evalType === 'json_match') return 'structured_output_failure';

  return 'uncategorized_failure';
}

function isOperationalLabel(label) {
  return label.reviewer !== 'calibration-author' && label.metadata?.purpose !== 'calibration';
}

function summarize(trace) {
  const results = Array.isArray(trace.results) ? trace.results : [];
  const failures = results.filter(r => r.pass === false || !r.success);
  const categories = new Map();
  const labels = loadLabelsFromDir(labelsDir).filter(isOperationalLabel);

  for (const result of failures) {
    const category = categorize(result);
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(result);
  }

  const ordered = [...categories.entries()].sort((a, b) => b[1].length - a[1].length);
  const lines = [];

  lines.push(`# Error Analysis: ${trace.evalName}`);
  lines.push('');
  lines.push(`- Trace ID: ${trace.id}`);
  lines.push(`- Started: ${trace.startedAt}`);
  lines.push(`- Total results: ${results.length}`);
  lines.push(`- Failures: ${failures.length}`);
  lines.push('');

  if (ordered.length === 0) {
    lines.push('No failures found in this trace.');
    appendLabelPivots(lines, labels);
    return lines.join('\n');
  }

  lines.push('## Failure Categories');
  lines.push('');

  for (const [category, items] of ordered) {
    lines.push(`### ${category}`);
    lines.push('');
    lines.push(`Count: ${items.length}`);
    lines.push('');

    for (const item of items.slice(0, 5)) {
      lines.push(`- ${item.testCase} | ${item.provider}/${item.model} | ${item.evalType || 'unknown'} | ${(item.evalReason || item.response?.error || 'No reason').replace(/\s+/g, ' ').trim()}`);
    }

    if (items.length > 5) {
      lines.push(`- ... ${items.length - 5} more`);
    }

    lines.push('');
  }

  lines.push('## Recommended Next Step');
  lines.push('');

  const topCategory = ordered[0][0];
  const recommendations = {
    provider_config: 'Use `skills/eval-smoke-test.md` and fix provider credentials or model availability first.',
    provider_selection: 'Check provider/model overrides in `run-eval.mjs`, `providers/`, and the workflow.',
    provider_transport: 'Stabilize provider/network behavior before changing the eval definitions.',
    judge_error: 'Use `skills/write-judge-prompt.md` and `skills/validate-evaluator.md` before trusting judge-based scores.',
    tool_use_failure: 'Use `skills/evaluate-tool-use.md` to inspect parser strictness and tool-choice ambiguity.',
    formatting_failure: 'Use `skills/compare-prompt-strategies.md` if prompts are weak, or strengthen regex checks if they are brittle.',
    deterministic_assertion_failure: 'Inspect whether the assertions are wrong or the model is actually failing. Start with `skills/error-analysis.md` and then the domain-specific skill.',
    subjective_quality_failure: 'Use `skills/validate-evaluator.md` to ensure the evaluator is not mis-scoring outputs.',
    structured_output_failure: 'Tighten structured-output instructions or evaluator parsing before expanding the benchmark.',
    runner_or_provider_error: 'Start with `skills/eval-smoke-test.md` and inspect runner/provider integration.',
    uncategorized_failure: 'Read the failing traces manually and add a new category before changing the suite.',
  };

  lines.push(recommendations[topCategory] || recommendations.uncategorized_failure);
  lines.push('');
  appendLabelPivots(lines, labels);

  return lines.join('\n');
}

function toJson(trace) {
  const results = Array.isArray(trace.results) ? trace.results : [];
  const failures = results.filter(r => r.pass === false || !r.success);
  const categories = new Map();
  const labels = loadLabelsFromDir(labelsDir).filter(isOperationalLabel);

  for (const result of failures) {
    const category = categorize(result);
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(result);
  }

  const ordered = [...categories.entries()].sort((a, b) => b[1].length - a[1].length);
  const topCategory = ordered[0]?.[0] || null;
  const recommendations = {
    provider_config: 'Use `skills/eval-smoke-test.md` and fix provider credentials or model availability first.',
    provider_selection: 'Check provider/model overrides in `run-eval.mjs`, `providers/`, and the workflow.',
    provider_transport: 'Stabilize provider/network behavior before changing the eval definitions.',
    judge_error: 'Use `skills/write-judge-prompt.md` and `skills/validate-evaluator.md` before trusting judge-based scores.',
    tool_use_failure: 'Use `skills/evaluate-tool-use.md` to inspect parser strictness and tool-choice ambiguity.',
    formatting_failure: 'Use `skills/compare-prompt-strategies.md` if prompts are weak, or strengthen regex checks if they are brittle.',
    deterministic_assertion_failure: 'Inspect whether the assertions are wrong or the model is actually failing. Start with `skills/error-analysis.md` and then the domain-specific skill.',
    subjective_quality_failure: 'Use `skills/validate-evaluator.md` to ensure the evaluator is not mis-scoring outputs.',
    structured_output_failure: 'Tighten structured-output instructions or evaluator parsing before expanding the benchmark.',
    runner_or_provider_error: 'Start with `skills/eval-smoke-test.md` and inspect runner/provider integration.',
    uncategorized_failure: 'Read the failing traces manually and add a new category before changing the suite.',
  };

  return {
    traceId: trace.id,
    evalName: trace.evalName,
    startedAt: trace.startedAt,
    totalResults: results.length,
    failureCount: failures.length,
    topCategory,
    recommendedNextStep: topCategory ? recommendations[topCategory] : null,
    categories: ordered.map(([category, items]) => ({
      category,
      count: items.length,
      samples: items.slice(0, 5).map(item => ({
        testCase: item.testCase,
        provider: item.provider,
        model: item.model,
        evalType: item.evalType || 'unknown',
        reason: (item.evalReason || item.response?.error || 'No reason').replace(/\s+/g, ' ').trim(),
      })),
    })),
    labelPivots: buildLabelPivots(labels),
  };
}

function buildLabelPivots(labels) {
  const failed = labels.filter(label => label.human_pass === false);
  return {
    failure_mode: countBy(failed, 'failure_mode'),
    feature: countBy(failed, 'feature'),
    scenario: countBy(failed, 'scenario'),
    persona: countBy(failed, 'persona'),
    suite: countBy(failed, 'suite'),
  };
}

function countBy(items, field) {
  const counts = new Map();
  for (const item of items) {
    const key = item[field] || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function appendLabelPivots(lines, labels) {
  if (labels.length === 0) return;
  const pivots = buildLabelPivots(labels);
  lines.push('## Human-Labeled Failure Pivots');
  lines.push('');

  for (const [field, values] of Object.entries(pivots)) {
    const entries = Object.entries(values);
    if (entries.length === 0) continue;
    lines.push(`### ${field}`);
    lines.push('');
    for (const [value, count] of entries.slice(0, 10)) {
      lines.push(`- ${value}: ${count}`);
    }
    lines.push('');
  }
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const traceArg = args.find(arg => !arg.startsWith('-'));
const latest = listTraceFiles()[0];

if (!traceArg && !latest) {
  console.error('No traces found. Run an eval first.');
  process.exit(1);
}

const trace = loadTrace(traceArg || latest);
if (jsonMode) {
  console.log(JSON.stringify(toJson(trace), null, 2));
} else {
  console.log(summarize(trace));
}
