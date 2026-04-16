#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const tracesDir = resolve(process.cwd(), 'traces');

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
  return JSON.parse(readFileSync(path, 'utf8'));
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

function summarize(trace) {
  const failures = trace.results.filter(r => r.pass === false || !r.success);
  const categories = new Map();

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
  lines.push(`- Total results: ${trace.results.length}`);
  lines.push(`- Failures: ${failures.length}`);
  lines.push('');

  if (ordered.length === 0) {
    lines.push('No failures found in this trace.');
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

  return lines.join('\n');
}

function toJson(trace) {
  const failures = trace.results.filter(r => r.pass === false || !r.success);
  const categories = new Map();

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
    totalResults: trace.results.length,
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
  };
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
