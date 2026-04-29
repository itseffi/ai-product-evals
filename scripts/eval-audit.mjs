#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const cwd = process.cwd();
const evalsDir = resolve(cwd, 'evals');
const skillsDir = resolve(cwd, 'skills');
const labelsDir = resolve(cwd, 'labels');
const judgesDir = resolve(cwd, 'judges');
const workflowPath = resolve(cwd, '.github/workflows/eval.yml');

function readJson(path) {
  try {
    return { data: JSON.parse(readFileSync(path, 'utf8')), error: null };
  } catch (error) {
    return { data: null, error: error.message };
  }
}

function getEvalFiles() {
  if (!existsSync(evalsDir)) return [];
  return readdirSync(evalsDir)
    .filter(name => name.endsWith('.json'))
    .map(name => join(evalsDir, name));
}

function audit() {
  const evalFiles = getEvalFiles();
  const findings = [];

  if (evalFiles.length === 0) {
    findings.push({ severity: 'high', area: 'coverage', issue: 'No JSON eval suites found in `evals/`.' });
    return findings;
  }

  let totalCases = 0;
  let llmJudgeCases = 0;
  let containsCases = 0;
  let regexCases = 0;
  let toolCases = 0;
  let pinnedModels = 0;

  for (const file of evalFiles) {
    const { data, error } = readJson(file);
    if (error) {
      findings.push({ severity: 'high', area: 'eval_parse', issue: `Invalid JSON in ${file}: ${error}` });
      continue;
    }
    const cases = data.test_cases || [];
    totalCases += cases.length;

    if (Array.isArray(data.models) && data.models.length > 0) {
      pinnedModels += 1;
    }

    for (const tc of cases) {
      if (tc.criteria || tc.eval_type === 'llm_judge') llmJudgeCases += 1;
      if (tc.expected_contains || tc.eval_type === 'contains') containsCases += 1;
      if (tc.expected_regex || tc.eval_type === 'regex') regexCases += 1;
      if (tc.expected_tool || tc.eval_type === 'tool_call') toolCases += 1;
    }
  }

  if (totalCases < 10) {
    findings.push({ severity: 'medium', area: 'coverage', issue: `Only ${totalCases} eval cases found. Coverage is likely thin.` });
  }

  if (containsCases > regexCases + toolCases + llmJudgeCases) {
    findings.push({ severity: 'medium', area: 'assertions', issue: 'Most checks are substring-based. Review whether `contains` checks are too weak.' });
  }

  if (llmJudgeCases > 0 && !existsSync(skillsDir)) {
    findings.push({ severity: 'medium', area: 'judge_eval', issue: 'Judge-based evals exist but there is no skill layer to validate evaluator quality.' });
  }

  if (llmJudgeCases > 0) {
    findings.push({ severity: 'info', area: 'judge_eval', issue: `${llmJudgeCases} cases use judge-like scoring. Validate evaluator quality periodically.` });
    if (!existsSync(labelsDir)) {
      findings.push({ severity: 'medium', area: 'judge_eval', issue: 'Judge-like scoring exists but no `labels/` directory was found for human validation data.' });
    }
    if (!existsSync(judgesDir)) {
      findings.push({ severity: 'medium', area: 'judge_eval', issue: 'Judge-like scoring exists but no `judges/` directory was found for suite-specific judge templates.' });
    }
  }

  if (toolCases === 0) {
    findings.push({ severity: 'info', area: 'tool_use', issue: 'No explicit tool-use eval cases detected.' });
  }

  if (pinnedModels > 0) {
    findings.push({ severity: 'medium', area: 'portability', issue: `${pinnedModels} eval files pin models directly. Prefer provider-agnostic eval definitions unless intentional.` });
  }

  if (!existsSync(workflowPath)) {
    findings.push({ severity: 'medium', area: 'ci', issue: 'No eval workflow found in `.github/workflows/eval.yml`.' });
  }

  if (existsSync(skillsDir)) {
    const skillFiles = readdirSync(skillsDir).filter(name => name.endsWith('.md'));
    if (skillFiles.length < 5) {
      findings.push({ severity: 'info', area: 'agent_support', issue: 'A partial skill layer exists. Expand it if agents are expected to improve the pipeline.' });
    }
  } else {
    findings.push({ severity: 'info', area: 'agent_support', issue: 'No `skills/` directory found. Agents will have to infer workflow from code.' });
  }

  return findings;
}

function toJson(findings) {
  return {
    findings,
    summary: {
      total: findings.length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      info: findings.filter(f => f.severity === 'info').length,
    },
  };
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const findings = audit();
if (jsonMode) {
  console.log(JSON.stringify(toJson(findings), null, 2));
} else {
  console.log('# Eval Audit');
  console.log('');

  if (findings.length === 0) {
    console.log('No obvious structural issues detected.');
    process.exit(0);
  }

  for (const finding of findings) {
    console.log(`- [${finding.severity}] ${finding.area}: ${finding.issue}`);
  }
}
