#!/usr/bin/env node

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { loadLabels, labelToEvalCase, validateLabel } from '../labels/schema.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output') >= 0 ? args.indexOf('--output') : args.indexOf('-o');
  const nameIndex = args.indexOf('--name');
  const templateIndex = args.indexOf('--judge-template');
  return {
    input: args.find(arg => !arg.startsWith('-')),
    output: outputIndex >= 0 ? args[outputIndex + 1] : 'evals/promoted-from-labels.json',
    suiteName: nameIndex >= 0 ? args[nameIndex + 1] : 'Promoted Human Labels',
    judgeTemplate: templateIndex >= 0 ? args[templateIndex + 1] : 'general-product-quality',
    includeInvalid: args.includes('--include-invalid'),
  };
}

const config = parseArgs();
if (!config.input) {
  console.error('Usage: node scripts/promote-labels-to-eval.mjs <labels.json|jsonl|csv> [--output evals/file.json]');
  process.exit(2);
}

const labels = loadLabels(resolve(process.cwd(), config.input));
const valid = [];
const invalid = [];

for (const label of labels) {
  const errors = validateLabel(label);
  if (errors.length > 0) invalid.push({ label, errors });
  if (errors.length === 0 || config.includeInvalid) valid.push(label);
}

const evalConfig = {
  name: config.suiteName,
  description: 'Eval suite promoted from human-labeled review data.',
  test_cases: valid.map(label => labelToEvalCase(label, { judgeTemplate: config.judgeTemplate })),
};

const outputPath = resolve(process.cwd(), config.output);
writeFileSync(outputPath, JSON.stringify(evalConfig, null, 2), 'utf8');

console.log(`Promoted ${valid.length} labels to ${outputPath}`);
if (invalid.length > 0) {
  console.log(`Skipped ${invalid.length} invalid labels:`);
  for (const item of invalid.slice(0, 10)) {
    console.log(`- ${item.label.id}: ${item.errors.join('; ')}`);
  }
}
