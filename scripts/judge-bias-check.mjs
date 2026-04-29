#!/usr/bin/env node

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { evaluate } from '../evaluators/index.mjs';
import { getProvider } from '../providers/index.mjs';

function parseArgs() {
  const args = process.argv.slice(2);
  const providerIndex = args.indexOf('--judge-provider');
  const modelIndex = args.indexOf('--judge-model');
  const panelIndex = args.indexOf('--judge-panel');
  return {
    input: args.find(arg => !arg.startsWith('-')) || 'evals/judge-bias-checks.json',
    json: args.includes('--json'),
    judgeProviderName: providerIndex >= 0 ? args[providerIndex + 1] : process.env.JUDGE_PROVIDER,
    judgeModel: modelIndex >= 0 ? args[modelIndex + 1] : process.env.JUDGE_MODEL,
    judgePanelSpec: panelIndex >= 0 ? args[panelIndex + 1] : process.env.JUDGE_PANEL,
  };
}

function parseJudgePanel(spec) {
  if (!spec) return [];
  return spec.split(',').map(member => {
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

const config = parseArgs();
const suite = JSON.parse(readFileSync(resolve(process.cwd(), config.input), 'utf8'));
const judgeProvider = config.judgeProviderName ? getProvider(config.judgeProviderName) : null;
const judgePanel = parseJudgePanel(config.judgePanelSpec);

if (!judgeProvider && judgePanel.length === 0) {
  console.error('Set JUDGE_PROVIDER or pass --judge-provider/--judge-panel to run judge bias checks.');
  process.exit(2);
}

const rows = [];
for (const testCase of suite.test_cases || []) {
  const result = await evaluate(testCase, '', {
    judgeProvider,
    judgeModel: config.judgeModel,
    judgePanel,
  });
  rows.push({
    id: testCase.name,
    biasCheck: testCase.metadata?.bias_check || 'unknown',
    pairId: testCase.metadata?.pair_id || testCase.name,
    variant: testCase.metadata?.variant || '',
    expectedWinner: testCase.expected_winner || testCase.expectedWinner,
    winner: result.winner || null,
    pass: result.pass,
    reason: result.reason,
    parseError: result.parseError || false,
    evalError: result.evalError || false,
  });
}

const groups = {};
for (const row of rows) {
  const key = `${row.biasCheck}:${row.pairId}`;
  groups[key] ||= [];
  groups[key].push(row);
}

const summary = {
  suite: suite.name,
  total: rows.length,
  passed: rows.filter(row => row.pass === true).length,
  failed: rows.filter(row => row.pass === false).length,
  parseErrors: rows.filter(row => row.parseError).length,
  evalErrors: rows.filter(row => row.evalError).length,
  groups: Object.fromEntries(Object.entries(groups).map(([key, items]) => [
    key,
    {
      consistent: items.every(item => item.winner === items[0].winner),
      winners: items.map(item => ({ variant: item.variant, winner: item.winner, pass: item.pass })),
    },
  ])),
  rows,
};

if (config.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`# Judge Bias Check: ${suite.name}`);
  console.log('');
  console.log(`- Total: ${summary.total}`);
  console.log(`- Passed: ${summary.passed}`);
  console.log(`- Failed: ${summary.failed}`);
  console.log(`- Parse/eval errors: ${summary.parseErrors}/${summary.evalErrors}`);
  console.log('');
  for (const row of rows) {
    const icon = row.pass ? 'PASS' : row.pass === false ? 'FAIL' : 'ERROR';
    console.log(`- ${icon} ${row.id}: winner=${row.winner || 'null'} expected=${row.expectedWinner || 'none'} reason=${row.reason}`);
  }
}

if (summary.failed > 0 || summary.parseErrors > 0 || summary.evalErrors > 0) {
  process.exit(1);
}
