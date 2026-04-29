#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve } from 'path';

function usage() {
  console.error('Usage: node scripts/check-eval-threshold.mjs <results.json> [--threshold 70]');
}

const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith('-'));
const thresholdIndex = args.indexOf('--threshold');
const threshold = thresholdIndex >= 0 ? Number(args[thresholdIndex + 1]) : Number(process.env.EVAL_PASS_THRESHOLD || 70);

if (!file || Number.isNaN(threshold)) {
  usage();
  process.exit(2);
}

const data = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
const summary = data.summary || {};
const total = Number(summary.total ?? data.results?.length ?? 0);
const passed = Number(summary.passed ?? data.results?.filter(r => r.pass === true).length ?? 0);
const failed = Number(summary.failed ?? data.results?.filter(r => r.pass === false || !r.success).length ?? 0);
const skipped = Number(summary.skipped ?? data.results?.filter(r => r.pass === null).length ?? 0);

if (total === 0) {
  console.error('No eval results found.');
  process.exit(1);
}

const rate = Math.round((passed / total) * 10000) / 100;
console.log(`Eval pass rate: ${rate}% (${passed}/${total}, failed ${failed}, skipped ${skipped})`);

if (rate < threshold) {
  console.error(`Pass rate ${rate}% is below threshold ${threshold}%`);
  process.exit(1);
}
