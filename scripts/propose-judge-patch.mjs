#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

const JUDGE_TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9_-]+(?:\.md)?$/;

function parseArgs() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output');
  const templateIndex = args.indexOf('--judge-template');
  return {
    input: args.find(arg => !arg.startsWith('-')) || 'reports/evaluator-validation.json',
    judgeTemplate: templateIndex >= 0 ? args[templateIndex + 1] : null,
    output: outputIndex >= 0 ? args[outputIndex + 1] : 'reports/proposed-judge.patch',
    json: args.includes('--json'),
  };
}

const config = parseArgs();
const reportPath = resolve(process.cwd(), config.input);
if (!existsSync(reportPath)) {
  console.error(`Validation report not found: ${reportPath}`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const disagreements = collectDisagreements(report);
if (disagreements.length === 0) {
  const empty = {
    input: reportPath,
    disagreements: 0,
    suggestions: [],
    message: 'No disagreements found; no judge patch proposed.',
  };
  if (config.json) console.log(JSON.stringify(empty, null, 2));
  else console.log(empty.message);
  process.exit(0);
}

const templateName = config.judgeTemplate || inferTemplateName(report, disagreements);
let templatePath;
try {
  templatePath = resolveJudgeTemplatePath(templateName);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (!existsSync(templatePath)) {
  console.error(`Judge template not found: ${templatePath}`);
  process.exit(1);
}

const original = readFileSync(templatePath, 'utf8');
const suggestions = inferSuggestions(disagreements, original);
if (suggestions.length === 0) {
  const noPatch = {
    input: reportPath,
    judgeTemplate: templateName,
    disagreements: disagreements.length,
    suggestions: [],
    message: 'Disagreements found, but no deterministic rubric patch matched them. Inspect manually.',
  };
  if (config.json) console.log(JSON.stringify(noPatch, null, 2));
  else console.log(noPatch.message);
  process.exit(0);
}

const updated = insertSuggestions(original, suggestions);
const normalizedTemplateName = templateName.endsWith('.md') ? templateName.slice(0, -3) : templateName;
const patch = unifiedDiff(`judges/${normalizedTemplateName}.md`, original, updated);
const outputPath = resolve(process.cwd(), config.output);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, patch, 'utf8');

const result = {
  input: reportPath,
  judgeTemplate: templateName,
  templatePath,
  output: outputPath,
  disagreements: disagreements.length,
  suggestions,
};

if (config.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`# Proposed Judge Patch`);
  console.log('');
  console.log(`- Validation report: ${reportPath}`);
  console.log(`- Judge template: ${templatePath}`);
  console.log(`- Disagreements: ${disagreements.length}`);
  console.log(`- Patch: ${outputPath}`);
  console.log('');
  console.log('## Suggested rubric additions');
  for (const suggestion of suggestions) {
    console.log(`- ${suggestion}`);
  }
}

function collectDisagreements(report) {
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const explicit = Array.isArray(report.disagreements) ? report.disagreements : [];
  const byId = new Map();
  for (const row of rows.concat(explicit)) {
    if (row && (row.agreement === false || row.judgePass !== row.humanPass)) {
      byId.set(row.id || `${byId.size}`, row);
    }
  }
  return [...byId.values()];
}

function resolveJudgeTemplatePath(name) {
  if (!JUDGE_TEMPLATE_NAME_PATTERN.test(name || '')) {
    throw new Error(`Invalid judge template name: ${name}`);
  }
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  return resolve(process.cwd(), 'judges', filename);
}

function inferTemplateName(report, disagreements) {
  const templateFromRow = disagreements
    .map(row => row.judgeTemplate || row.metadata?.judge_template || row.attempts?.[0]?.judgeTemplate)
    .find(Boolean);
  if (templateFromRow) return templateFromRow;
  const hasRag = disagreements.some(row => /rag|context|ground|source|hallucinat/i.test([
    row.id,
    row.failureMode,
    row.reason,
    row.critique,
  ].join(' ')));
  return hasRag ? 'rag-quality' : 'general-product-quality';
}

function inferSuggestions(disagreements, original) {
  const text = disagreements.map(row => [
    row.id,
    row.reason,
    row.critique,
    row.failureMode,
  ].join(' ')).join('\n').toLowerCase();
  const suggestions = [];
  addIf(
    suggestions,
    original,
    text,
    /context|ground|unsupported|world knowledge|hallucinat/,
    'Facts that may be true in the world but are not supported by the supplied context must fail.',
    /world knowledge.*not supported|every factual claim.*supported/s
  );
  addIf(
    suggestions,
    original,
    text,
    /refus|insufficient|silent|not contain|missing context/,
    'A refusal or explicit insufficiency statement should pass when the context does not contain the answer.',
    /context is insufficient|refuses or flags the gap/s
  );
  addIf(
    suggestions,
    original,
    text,
    /concise|omits|unrequested|extra detail|scope/,
    'Do not penalize concise answers for omitting supported details that the user did not ask for.',
    /concise answers are accepted|unrequested context is not required/s
  );
  addIf(
    suggestions,
    original,
    text,
    /source|attribut|misattribut|document/,
    'When multiple sources are provided, claims must be attributed to the correct source.',
    /multiple sources.*attributed|misattributes source/s
  );
  addIf(
    suggestions,
    original,
    text,
    /format|parse|reason|rationale/,
    'The reason must cite the specific criterion that determined the verdict and one concrete response detail.',
    /reason must cite|specific criterion/s
  );
  return suggestions;
}

function addIf(suggestions, original, text, pattern, suggestion, existingPattern) {
  const lowerOriginal = original.toLowerCase();
  if (pattern.test(text) && !existingPattern.test(lowerOriginal) && !lowerOriginal.includes(suggestion.toLowerCase())) {
    suggestions.push(suggestion);
  }
}

function insertSuggestions(original, suggestions) {
  const block = [
    '',
    'Calibration additions from recent human-label disagreements:',
    ...suggestions.map(item => `- ${item}`),
    '',
  ].join('\n');
  const marker = '\nReturn exactly:';
  if (original.includes(marker)) {
    return original.replace(marker, `${block}${marker}`);
  }
  return `${original.trimEnd()}\n${block}\n`;
}

function unifiedDiff(path, before, after) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const beforeMarker = beforeLines.findIndex(line => line === 'Return exactly:');
  const afterMarker = afterLines.findIndex(line => line === 'Return exactly:');
  if (beforeMarker >= 0 && afterMarker >= 0) {
    const contextStart = Math.max(0, beforeMarker - 2);
    const beforeContext = beforeLines.slice(contextStart, beforeMarker);
    const inserted = afterLines.slice(contextStart + beforeContext.length, afterMarker);
    const afterContext = beforeLines.slice(beforeMarker, Math.min(beforeLines.length, beforeMarker + 4));
    return [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@`,
      ...beforeContext.map(line => ` ${line}`),
      ...inserted.map(line => `+${line}`),
      ...afterContext.map(line => ` ${line}`),
      '',
    ].join('\n');
  }

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@',
    ...before.split('\n').map(line => `-${line}`),
    ...after.split('\n').map(line => `+${line}`),
    '',
  ].join('\n');
}
