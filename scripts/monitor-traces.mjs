#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { loadLabelsFromDir } from '../labels/schema.mjs';

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const tracesIndex = args.indexOf('--traces');
const labelsIndex = args.indexOf('--labels');
const tracesDir = resolve(process.cwd(), tracesIndex >= 0 ? args[tracesIndex + 1] : 'traces');
const labelsDir = resolve(process.cwd(), labelsIndex >= 0 ? args[labelsIndex + 1] : 'labels');

function loadTraces() {
  if (!existsSync(tracesDir)) return [];
  return readdirSync(tracesDir)
    .filter(name => name.endsWith('.json'))
    .map(name => loadTraceFile(name))
    .filter(Boolean)
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

function loadTraceFile(name) {
  const path = join(tracesDir, name);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.warn(`Skipping invalid trace JSON ${path}: ${error.message}`);
    return null;
  }
}

function pct(value) {
  if (value === null || value === undefined) return 'N/A';
  return `${Math.round(value * 100)}%`;
}

function inc(map, key, amount = 1) {
  map.set(key || 'unknown', (map.get(key || 'unknown') || 0) + amount);
}

function dateKey(value) {
  return String(value || '').slice(0, 10) || 'unknown';
}

function sortedObjectFromMap(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function isOperationalLabel(label) {
  return label.reviewer !== 'calibration-author' && label.metadata?.purpose !== 'calibration';
}

const traces = loadTraces();
const labels = loadLabelsFromDir(labelsDir).filter(isOperationalLabel);
const allResults = traces.flatMap(trace =>
  (Array.isArray(trace.results) ? trace.results : []).map(result => ({ trace, result }))
);
const decisiveResults = allResults.filter(({ result }) => result.pass === true || result.pass === false);
const passRate = decisiveResults.length > 0
  ? decisiveResults.filter(({ result }) => result.pass === true).length / decisiveResults.length
  : null;

const byProvider = new Map();
const byEvalType = new Map();
for (const { result } of allResults) {
  inc(byProvider, `${result.provider}/${result.model}`);
  inc(byEvalType, result.evalType);
}

const failureModes = new Map();
for (const label of labels.filter(label => label.human_pass === false)) {
  inc(failureModes, label.failure_mode);
}

const avgLatency = allResults.length > 0
  ? allResults.reduce((sum, { result }) => sum + (result.latencyMs || 0), 0) / allResults.length
  : 0;
const totalCost = allResults.reduce((sum, { result }) => sum + (result.cost || 0), 0);

const byDay = new Map();
for (const { trace, result } of allResults) {
  const day = dateKey(result.timestamp || trace.completedAt || trace.startedAt);
  if (!byDay.has(day)) {
    byDay.set(day, {
      date: day,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      latencyMs: 0,
      cost: 0,
      providers: new Map(),
      judgeReplayTotal: 0,
      judgeReplayMatches: 0,
    });
  }
  const bucket = byDay.get(day);
  bucket.total++;
  if (result.pass === true) bucket.passed++;
  if (result.pass === false) bucket.failed++;
  if (result.pass === null) bucket.skipped++;
  bucket.latencyMs += result.latencyMs || 0;
  bucket.cost += result.cost || 0;
  inc(bucket.providers, `${result.provider}/${result.model}`);

  if (result.evalType === 'human_label_replay' && result.metadata?.expected_pass !== undefined && result.metadata?.judge_pass !== undefined) {
    bucket.judgeReplayTotal++;
    if (result.metadata.expected_pass === result.metadata.judge_pass) {
      bucket.judgeReplayMatches++;
    }
  }
}

const trend = [...byDay.values()]
  .sort((a, b) => a.date.localeCompare(b.date))
    .map(bucket => ({
    date: bucket.date,
    resultCount: bucket.total,
    passRate: bucket.passed + bucket.failed > 0 ? bucket.passed / (bucket.passed + bucket.failed) : null,
    failed: bucket.failed,
    skipped: bucket.skipped,
    avgLatencyMs: bucket.total > 0 ? Math.round(bucket.latencyMs / bucket.total) : 0,
    totalCost: bucket.cost,
    providers: sortedObjectFromMap(bucket.providers),
    judgeAgreement: bucket.judgeReplayTotal > 0 ? bucket.judgeReplayMatches / bucket.judgeReplayTotal : null,
  }));

const seenFailureModes = new Set();
const newFailureModes = [];
for (const label of labels
  .filter(label => label.human_pass === false)
  .sort((a, b) => String(a.reviewed_at).localeCompare(String(b.reviewed_at)))) {
  const mode = label.failure_mode || 'unknown';
  if (!seenFailureModes.has(mode)) {
    seenFailureModes.add(mode);
    newFailureModes.push({
      failureMode: mode,
      firstSeen: dateKey(label.reviewed_at),
      labelId: label.id,
    });
  }
}

const report = {
  traceCount: traces.length,
  resultCount: allResults.length,
  passRate,
  avgLatencyMs: Math.round(avgLatency),
  totalCost,
  byProvider: sortedObjectFromMap(byProvider),
  byEvalType: sortedObjectFromMap(byEvalType),
  labeledFailures: sortedObjectFromMap(failureModes),
  trend,
  newFailureModes,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('# Trace Monitor');
  console.log('');
  console.log(`- Traces: ${report.traceCount}`);
  console.log(`- Results: ${report.resultCount}`);
  console.log(`- Pass rate: ${pct(report.passRate)}`);
  console.log(`- Average latency: ${report.avgLatencyMs}ms`);
  console.log(`- Total cost: ${report.totalCost ? `$${report.totalCost.toFixed(4)}` : 'Free/N/A'}`);
  console.log('');
  console.log('## Trend');
  console.log('');
  if (report.trend.length === 0) {
    console.log('No trace trend data found.');
  } else {
    console.log('| Date | Results | Pass Rate | Failed | Skipped | Avg Latency | Cost | Judge Agreement |');
    console.log('|------|---------|-----------|--------|---------|-------------|------|-----------------|');
    for (const row of report.trend) {
      const judgeAgreement = row.judgeAgreement === null ? 'N/A' : pct(row.judgeAgreement);
      const cost = row.totalCost ? `$${row.totalCost.toFixed(4)}` : 'N/A';
      console.log(`| ${row.date} | ${row.resultCount} | ${pct(row.passRate)} | ${row.failed} | ${row.skipped} | ${row.avgLatencyMs}ms | ${cost} | ${judgeAgreement} |`);
    }
  }
  console.log('');
  console.log('## Top Labeled Failure Modes');
  console.log('');
  const failures = Object.entries(report.labeledFailures);
  if (failures.length === 0) {
    console.log('No labeled failures found.');
  } else {
    failures.slice(0, 10).forEach(([mode, count]) => console.log(`- ${mode}: ${count}`));
  }
  console.log('');
  console.log('## New Failure Modes');
  console.log('');
  if (report.newFailureModes.length === 0) {
    console.log('No labeled failure modes found.');
  } else {
    report.newFailureModes.slice(0, 10).forEach(item => {
      console.log(`- ${item.failureMode}: first seen ${item.firstSeen} (${item.labelId})`);
    });
  }
}
