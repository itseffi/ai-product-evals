/**
 * Trace Logger
 * 
 * Logs every eval run with full request/response data for later analysis
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const TRACES_DIR = resolve(process.cwd(), 'traces');

// Ensure traces directory exists
if (!existsSync(TRACES_DIR)) {
  mkdirSync(TRACES_DIR, { recursive: true });
}

/**
 * Create a new trace for an eval run
 */
export function createTrace(evalConfig) {
  const traceId = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const trace = {
    id: traceId,
    evalName: evalConfig.name,
    startedAt: new Date().toISOString(),
    completedAt: null,
    config: evalConfig,
    results: [],
    summary: null,
  };
  return trace;
}

/**
 * Add a result to the trace
 */
export function addTraceResult(trace, result) {
  trace.results.push({
    timestamp: new Date().toISOString(),
    testCase: result.testCase,
    scenario: result.scenario || null,
    model: result.model,
    provider: result.provider,
    success: result.success,
    pass: result.pass,
    score: result.score,
    evalType: result.evalType,
    evalReason: result.evalReason,
    latencyMs: result.latencyMs,
    cost: result.cost,
    usage: result.usage,
    // Full request/response for debugging
    request: {
      prompt: result.prompt,
      systemPrompt: result.systemPrompt,
    },
    response: {
      text: result.text,
      error: result.error,
    },
  });
}

/**
 * Complete and save the trace
 */
export function saveTrace(trace, summary) {
  trace.completedAt = new Date().toISOString();
  trace.summary = summary;
  
  const filename = `${trace.id}.json`;
  const filepath = join(TRACES_DIR, filename);
  
  writeFileSync(filepath, JSON.stringify(trace, null, 2), 'utf8');
  
  return filepath;
}

/**
 * Load a trace by ID
 */
export function loadTrace(traceId) {
  const filepath = join(TRACES_DIR, `${traceId}.json`);
  if (!existsSync(filepath)) {
    throw new Error(`Trace not found: ${traceId}`);
  }
  return JSON.parse(readFileSync(filepath, 'utf8'));
}

/**
 * List all traces
 */
export function listTraces() {
  if (!existsSync(TRACES_DIR)) {
    return [];
  }
  
  const files = readdirSync(TRACES_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse(); // Most recent first
  
  return files.map(f => {
    try {
      const trace = JSON.parse(readFileSync(join(TRACES_DIR, f), 'utf8'));
      return {
        id: trace.id,
        evalName: trace.evalName,
        startedAt: trace.startedAt,
        completedAt: trace.completedAt,
        passed: trace.summary?.passed || 0,
        failed: trace.summary?.failed || 0,
        total: trace.results?.length || 0,
      };
    } catch {
      return { id: f.replace('.json', ''), error: 'Failed to parse' };
    }
  });
}

/**
 * Get recent traces for an eval (for comparison)
 */
export function getRecentTraces(evalName, limit = 10) {
  const traces = listTraces()
    .filter(t => t.evalName === evalName)
    .slice(0, limit);
  return traces;
}

/**
 * Compare two traces and find regressions
 */
export function compareTraces(oldTraceId, newTraceId) {
  const oldTrace = loadTrace(oldTraceId);
  const newTrace = loadTrace(newTraceId);
  
  const regressions = [];
  const improvements = [];
  
  // Build lookup for old results
  const oldResults = {};
  for (const r of oldTrace.results) {
    const key = `${r.testCase}|${r.provider}/${r.model}`;
    oldResults[key] = r;
  }
  
  // Compare with new results
  for (const newResult of newTrace.results) {
    const key = `${newResult.testCase}|${newResult.provider}/${newResult.model}`;
    const oldResult = oldResults[key];
    
    if (oldResult) {
      if (oldResult.pass && !newResult.pass) {
        regressions.push({
          testCase: newResult.testCase,
          model: `${newResult.provider}/${newResult.model}`,
          was: 'PASS',
          now: 'FAIL',
          reason: newResult.evalReason,
        });
      } else if (!oldResult.pass && newResult.pass) {
        improvements.push({
          testCase: newResult.testCase,
          model: `${newResult.provider}/${newResult.model}`,
          was: 'FAIL',
          now: 'PASS',
        });
      }
    }
  }
  
  return { regressions, improvements };
}

/**
 * Format trace summary for display
 */
export function formatTraceSummary(traces) {
  if (traces.length === 0) {
    return 'No traces found.';
  }
  
  const lines = ['Recent Eval Runs:', ''];
  lines.push('| Date | Eval | Passed | Failed | Total |');
  lines.push('|------|------|--------|--------|-------|');
  
  for (const t of traces.slice(0, 10)) {
    const date = new Date(t.startedAt).toLocaleDateString();
    lines.push(`| ${date} | ${t.evalName} | ${t.passed} | ${t.failed} | ${t.total} |`);
  }
  
  return lines.join('\n');
}
