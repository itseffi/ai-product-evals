#!/usr/bin/env node

/**
 * AI Product Eval Runner
 * 
 * Runs evaluations with:
 * - Real scoring logic (pass/fail with reasons)
 * - Trace logging for every run
 * - Auto-retry on failures
 * - History tracking and regression detection
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { getProvider, getDefaultProvider, getAvailableProviders } from './providers/index.mjs';
import { evaluate } from './evaluators/index.mjs';
import { createTrace, addTraceResult, saveTrace, listTraces, getRecentTraces, compareTraces, formatTraceSummary } from './tracer.mjs';
import { getCacheKey, getCachedResponse, setCachedResponse } from './cache.mjs';
import { withRateLimit } from './rate-limiter.mjs';
import { loadDataset, exportResultsToCsv } from './dataset.mjs';
import { calculateCost, formatCost as formatCostUtil } from './costs.mjs';
import { runABTest, generateABReport } from './ab-test.mjs';
import { runConversation, createConversationTest } from './multi-turn.mjs';
import { parseBoolean } from './labels/schema.mjs';
import { parseEnvInteger } from './env-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config
const MAX_RETRIES = parseEnvInteger(process.env.MAX_RETRIES, 2, { min: 0, max: 10 });
const RETRY_DELAY_MS = parseEnvInteger(process.env.RETRY_DELAY_MS, 1000, { min: 0, max: 60000 });
const PARALLEL_LIMIT = parseEnvInteger(process.env.PARALLEL_LIMIT, 3, { min: 1, max: 100 });
const USE_CACHE = parseBoolean(process.env.USE_CACHE) !== false;

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    evalFile: null,
    provider: null,
    model: null,
    output: 'eval-results.md',
    outputFormat: 'md', // md, csv, json
    markdownOutput: null,
    verbose: false,
    listProviders: false,
    skipJudge: false,
    listHistory: false,
    abTest: false,
    multiTurn: false,
    compare: null,
    parallel: false,
    noCache: false,
    clearCache: false,
    allowFailures: false,
    dryRun: false,
    maxCalls: parseOptionalInteger(process.env.MAX_CALLS),
    repeat: parseOptionalInteger(process.env.EVAL_REPEAT) || 1,
    judgePanel: process.env.JUDGE_PANEL || null,
    maxCostUsd: parseOptionalNumber(process.env.MAX_COST_PER_RUN_USD),
    maxCallCostUsd: parseOptionalNumber(process.env.MAX_COST_PER_CALL_USD),
    streamJsonl: false,
    streamJsonlPath: process.env.STREAM_JSONL_OUTPUT || null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--provider' || arg === '-p') {
      config.provider = args[++i];
    } else if (arg === '--model' || arg === '-m') {
      config.model = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      config.output = args[++i];
    } else if (arg === '--format' || arg === '-f') {
      config.outputFormat = args[++i];
    } else if (arg === '--markdown-output') {
      config.markdownOutput = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg === '--list-providers' || arg === '-l') {
      config.listProviders = true;
    } else if (arg === '--skip-judge') {
      config.skipJudge = true;
    } else if (arg === '--history' || arg === '-H') {
      config.listHistory = true;
    } else if (arg === '--compare' || arg === '-c') {
      config.compare = args[++i];
    } else if (arg === '--parallel' || arg === '-P') {
      config.parallel = true;
    } else if (arg === '--no-cache') {
      config.noCache = true;
    } else if (arg === '--clear-cache') {
      config.clearCache = true;
    } else if (arg === '--allow-failures') {
      config.allowFailures = true;
    } else if (arg === '--dry-run') {
      config.dryRun = true;
    } else if (arg === '--max-calls') {
      config.maxCalls = parseOptionalInteger(args[++i]);
    } else if (arg === '--repeat') {
      config.repeat = parseOptionalInteger(args[++i]) || 1;
    } else if (arg === '--judge-panel') {
      config.judgePanel = args[++i];
    } else if (arg === '--max-cost') {
      config.maxCostUsd = parseOptionalNumber(args[++i]);
    } else if (arg === '--max-call-cost') {
      config.maxCallCostUsd = parseOptionalNumber(args[++i]);
    } else if (arg === '--stream-jsonl') {
      config.streamJsonl = true;
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        config.streamJsonlPath = args[++i];
      }
    } else if (arg === '--ab-test' || arg === '-A') {
      config.abTest = true;
    } else if (arg === '--multi-turn' || arg === '-M') {
      config.multiTurn = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      config.evalFile = arg;
    }
  }

  return config;
}

function printHelp() {
  console.log(`
AI Product Eval Runner

Usage:
  node run-eval.mjs [eval-config.json|.csv|.jsonl] [options]

Options:
  --provider, -p <name>   Override provider (ollama, openrouter, openai, anthropic, google)
  --model, -m <name>      Override model name for the selected provider
  --output, -o <file>     Output file for results (default: eval-results.md)
  --format, -f <type>     Output format: md, csv, json, jsonl (default: md)
  --markdown-output <file> Also write a markdown report from the same run
  --verbose, -v           Enable verbose logging
  --skip-judge            Skip LLM-as-judge evaluation (faster, no scoring)
  --list-providers, -l    List available providers and exit
  --history, -H           Show eval run history
  --compare, -c <id>      Compare current run against a previous trace ID
  --parallel, -P          Run test cases in parallel (faster)
  --no-cache              Disable response caching
  --clear-cache           Clear response cache and exit
  --allow-failures        Write reports but exit 0 when eval cases fail
  --dry-run               Show planned calls/cost estimates without calling providers
  --max-calls <n>         Stop after N provider calls, including judge calls
  --repeat <n>            Run each test case N times for pass@K and consistency metrics
  --judge-panel <list>    Judge with multiple providers, e.g. openai:gpt-5.5,anthropic:claude-haiku-4-5
  --max-cost <usd>        Stop the run after known cost exceeds this USD ceiling
  --max-call-cost <usd>   Fail a provider call whose estimated or actual cost exceeds this ceiling
  --stream-jsonl [file]   Emit per-event JSONL progress to stderr, or append to file if provided
  --ab-test, -A           Run as A/B test (config file should have variantA/variantB)
  --multi-turn, -M        Run as multi-turn conversation test
  --help, -h              Show this help message

Examples:
  node run-eval.mjs                                    # Run default eval
  node run-eval.mjs evals/llm-comparison.json          # Run specific eval
  node run-eval.mjs dataset.csv                        # Run from CSV dataset
  node run-eval.mjs --provider openai                  # Override provider
  node run-eval.mjs --provider openai --model gpt-4o-mini
  node run-eval.mjs --parallel evals/quick-test.json   # Run in parallel
  node run-eval.mjs --format csv -o results.csv        # Export to CSV
  node run-eval.mjs --history                          # View past runs
  node run-eval.mjs --compare 1706500000-abc123        # Compare against past run
`);
}

// =============================================================================
// Utility Functions
// =============================================================================

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatCost(cost) {
  if (cost === null || cost === undefined) return 'N/A';
  if (cost === 0) return 'Free';
  if (cost < 0.0001) return '<$0.0001';
  return `$${cost.toFixed(4)}`;
}

function formatScore(score) {
  if (score === null || score === undefined) return 'N/A';
  return `${Math.round(score * 100)}%`;
}

function truncateText(text, maxLength = 100) {
  if (!text) return '';
  if (typeof text !== 'string') {
    text = JSON.stringify(text);
  }
  text = text.replace(/\n/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) {
    throw new Error(`Numeric option must be non-negative: ${value}`);
  }
  return parsed;
}

function parseOptionalInteger(value) {
  const parsed = parseOptionalNumber(value);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) {
    throw new Error(`Numeric option must be an integer: ${value}`);
  }
  return parsed;
}

function totalKnownCost(results) {
  return results.reduce((sum, result) => sum + (result.cost || 0), 0);
}

function costLimitMessage(results, maxCostUsd) {
  if (maxCostUsd === null || maxCostUsd === undefined) return null;
  const unknownCost = results.find(result => result.costUnknown || result.metadata?.cost_unknown);
  if (unknownCost) {
    return `Run has unknown billable cost for ${unknownCost.provider}/${unknownCost.model}; MAX_COST_PER_RUN_USD/--max-cost requires known pricing`;
  }
  const total = totalKnownCost(results);
  return total > maxCostUsd
    ? `Run cost ${formatCost(total)} exceeded MAX_COST_PER_RUN_USD/--max-cost limit ${formatCost(maxCostUsd)}`
    : null;
}

function calculateReliabilityMetrics(results) {
  const groups = new Map();
  for (const result of results) {
    const key = [
      result.testCase,
      result.provider,
      result.model,
      result.metadata?.paraphrase_index ? 'paraphrase' : 'base',
    ].join('::');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }

  const perCase = [];
  let weightedFailureTotal = 0;
  let unauthorizedFailures = 0;
  let recoveryEligible = 0;
  let recovered = 0;

  for (const groupResults of groups.values()) {
    const first = groupResults[0];
    const passed = groupResults.filter(result => result.pass === true).length;
    const failed = groupResults.filter(result => result.pass === false).length;
    const verdicts = groupResults.map(result => result.pass);
    const stable = new Set(verdicts.map(String)).size <= 1;
    const failureWeight = Number(first.metadata?.safety_weight ?? first.metadata?.failure_weight ?? 1);
    weightedFailureTotal += failed * (Number.isFinite(failureWeight) ? failureWeight : 1);
    unauthorizedFailures += groupResults.filter(result =>
      result.metadata?.unauthorized_action === true
      || /unauthorized action/i.test(result.evalReason || '')
    ).length;
    recoveryEligible += groupResults.filter(result => result.metadata?.recovery_expected).length;
    recovered += groupResults.filter(result => result.metadata?.recovery_expected && result.pass === true).length;

    perCase.push({
      testCase: first.testCase,
      provider: first.provider,
      model: first.model,
      runs: groupResults.length,
      passAtK: passed > 0,
      passRate: groupResults.length > 0 ? passed / groupResults.length : 0,
      consistency: stable ? 1 : 0,
      failures: failed,
      paraphraseIndex: first.metadata?.paraphrase_index ?? null,
    });
  }

  const consistency = perCase.length > 0
    ? perCase.reduce((sum, item) => sum + item.consistency, 0) / perCase.length
    : 0;
  const passAtK = perCase.length > 0
    ? perCase.filter(item => item.passAtK).length / perCase.length
    : 0;

  return {
    passAtK,
    consistency,
    caseCount: perCase.length,
    unauthorizedFailures,
    safetyWeightedFailures: weightedFailureTotal,
    recoveryRate: recoveryEligible > 0 ? recovered / recoveryEligible : null,
    perCase,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveExecutionModels(evalConfig, cliConfig) {
  const configuredModels = Array.isArray(evalConfig.models) ? evalConfig.models.filter(Boolean) : [];
  if (!evalConfigRequiresModelProvider(evalConfig)) {
    return [{
      provider: 'static',
      model: 'static-response',
    }];
  }

  if (configuredModels.length === 0) {
    const provider = cliConfig.provider
      ? getProvider(cliConfig.provider)
      : await getDefaultProvider();

    return [{
      provider: provider.name,
      model: cliConfig.model || provider.defaultModel,
    }];
  }

  const resolvedModels = [];

  for (const configuredModel of configuredModels) {
    const provider = cliConfig.provider
      ? getProvider(cliConfig.provider)
      : configuredModel.provider
        ? getProvider(configuredModel.provider)
        : await getDefaultProvider();

    resolvedModels.push({
      ...configuredModel,
      provider: provider.name,
      model: cliConfig.model || configuredModel.model || provider.defaultModel,
    });
  }

  return resolvedModels;
}

function resolveDryRunModels(evalConfig, cliConfig) {
  const configuredModels = Array.isArray(evalConfig.models) ? evalConfig.models.filter(Boolean) : [];
  if (!evalConfigRequiresModelProvider(evalConfig)) {
    return [{ provider: 'static', model: 'static-response' }];
  }
  if (configuredModels.length === 0) {
    return [{
      provider: cliConfig.provider || process.env.DEFAULT_PROVIDER || 'default-provider',
      model: cliConfig.model || 'default-model',
    }];
  }
  return configuredModels.map(configuredModel => ({
    ...configuredModel,
    provider: cliConfig.provider || configuredModel.provider || process.env.DEFAULT_PROVIDER || 'default-provider',
    model: cliConfig.model || configuredModel.model || 'default-model',
  }));
}

function testCaseUsesStaticResponse(testCase) {
  return testCase.static_response !== undefined
    || testCase.staticResponse !== undefined
    || testCase.eval_type === 'pairwise_judge'
    || testCase.response_a !== undefined
    || testCase.responseA !== undefined
    || testCase.candidate_a !== undefined
    || testCase.candidateA !== undefined;
}

function testCaseRequiresModelProvider(testCase) {
  if (testCaseUsesStaticResponse(testCase)) return false;
  const evalType = detectedEvalType(testCase);
  return !['rag_retrieval', 'personalization_context', 'context_surface'].includes(evalType);
}

function detectedEvalType(testCase) {
  if (testCase.eval_type) return testCase.eval_type;
  if (testCase.expected_tool) return 'tool_call';
  if (testCase.expected_json) return 'json_match';
  if (testCase.expected_regex) return 'regex';
  if (testCase.expected_contains) return 'contains';
  if (testCase.expected_semantic) return 'semantic_similarity';
  if (testCase.safety_check) return 'safety';
  if (testCase.unauthorized_patterns || testCase.forbidden_actions) return 'unauthorized_action';
  if (testCase.expected_confidence !== undefined || testCase.confidence_tolerance !== undefined) return 'confidence_calibration';
  if (testCase.response_surface || testCase.required_response_facts || testCase.forbidden_response_facts) return 'personalization_response';
  if (testCase.context_surface || testCase.required_context_facts || testCase.irrelevant_context_facts) return 'personalization_context';
  if (testCase.response_a || testCase.response_b || testCase.candidate_a || testCase.candidate_b) return 'pairwise_judge';
  if (testCase.retrieved_context_ids && testCase.expected_relevant_context_ids) return 'rag_retrieval';
  if (testCase.expected) return 'exact_match';
  if (testCase.criteria) return 'llm_judge';
  return 'existence';
}

function evalConfigRequiresModelProvider(evalConfig) {
  const testCases = evalConfig.test_cases || evalConfig.conversations || [evalConfig];
  return testCases.some(testCaseRequiresModelProvider);
}

function evalConfigRequiresJudge(evalConfig) {
  const testCases = evalConfig.test_cases || evalConfig.conversations || [evalConfig];
  return testCases.some(testCase => {
    if (testCaseRequiresJudge(testCase)) return true;
    const turns = testCase.turns || testCase.conversation || [];
    return Boolean(testCase.overall_criteria || turns.some(turn => turn.criteria && !turn.expected && !turn.expected_contains));
  });
}

function testCaseRequiresJudge(testCase) {
  const evalType = detectedEvalType(testCase);
  if (evalType === 'llm_judge') return true;
  if (evalType === 'pairwise_judge') return true;
  if (/^rag_(?!retrieval)/.test(evalType)) return true;
  return false;
}

function testCaseMetadata(testCase) {
  return {
    ...(testCase.metadata || {}),
    ...(testCase.safety_weight !== undefined ? { safety_weight: testCase.safety_weight } : {}),
    ...(testCase.failure_weight !== undefined ? { failure_weight: testCase.failure_weight } : {}),
    ...(testCase.recovery_expected !== undefined ? { recovery_expected: testCase.recovery_expected } : {}),
  };
}

function buildDryRunPlan(evalConfig, cliConfig) {
  const testCases = expandTestCases(evalConfig.test_cases || evalConfig.conversations || [evalConfig], cliConfig.repeat);
  const models = resolveDryRunModels(evalConfig, cliConfig);
  const judgePanelMembers = cliConfig.judgePanel
    ? cliConfig.judgePanel.split(',').map(member => member.trim()).filter(Boolean).length
    : 0;
  const judgeCallsPerJudgeCase = cliConfig.skipJudge ? 0 : Math.max(judgePanelMembers, evalConfigRequiresJudge(evalConfig) ? 1 : 0);
  const plannedRuns = [];
  let productCalls = 0;
  let judgeCalls = 0;
  let deterministicCases = 0;
  let estimatedCost = 0;
  let costUnknown = false;

  for (const testCase of testCases) {
    for (const modelConfig of models) {
      const requiresModel = testCaseRequiresModelProvider(testCase);
      const requiresJudge = testCaseRequiresJudge(testCase);
      const productCallCount = requiresModel ? 1 : 0;
      const judgeCallCount = requiresJudge ? judgeCallsPerJudgeCase : 0;
      productCalls += productCallCount;
      judgeCalls += judgeCallCount;
      if (productCallCount === 0 && judgeCallCount === 0) deterministicCases += 1;

      const maxTokens = testCase.max_tokens ?? modelConfig.max_tokens ?? 2048;
      const messages = [
        ...(testCase.system_prompt ? [{ role: 'system', content: testCase.system_prompt }] : []),
        { role: 'user', content: testCase.prompt || testCase.question || '' },
      ];
      const providerEstimate = requiresModel
        ? calculateCost(modelConfig.model, {
            prompt_tokens: estimateMessagesTokens(messages),
            completion_tokens: maxTokens,
            total_tokens: estimateMessagesTokens(messages) + maxTokens,
          })
        : 0;
      if (providerEstimate === null || providerEstimate === undefined) {
        if (isBillableProvider(modelConfig.provider)) costUnknown = true;
      } else {
        estimatedCost += providerEstimate;
      }

      plannedRuns.push({
        testCase: testCase.name || testCase.id || 'Unnamed',
        provider: modelConfig.provider,
        model: modelConfig.model,
        productCalls: productCallCount,
        judgeCalls: judgeCallCount,
        evalType: testCase.eval_type || detectDryRunEvalType(testCase),
      });
    }
  }

  const totalProviderCalls = productCalls + judgeCalls;
  const limitedRuns = cliConfig.maxCalls === null || cliConfig.maxCalls === undefined
    ? plannedRuns
    : plannedRuns.slice(0, Math.max(cliConfig.maxCalls, 0));

  return {
    evalName: evalConfig.name || 'Unnamed eval',
    testCases: testCases.length,
    models: models.length,
    plannedRuns: plannedRuns.length,
    productCalls,
    judgeCalls,
    deterministicCases,
    totalProviderCalls,
    maxCalls: cliConfig.maxCalls,
    maxCostUsd: cliConfig.maxCostUsd,
    maxCallCostUsd: cliConfig.maxCallCostUsd,
    estimatedKnownCostUsd: estimatedCost,
    costUnknown,
    runsPreview: limitedRuns,
  };
}

function expandTestCases(testCases, repeat = 1) {
  const repeatCount = Math.max(1, repeat || 1);
  const expanded = [];

  for (const testCase of testCases) {
    const promptVariants = [{ prompt: testCase.prompt, paraphraseIndex: null }];
    const paraphrases = Array.isArray(testCase.paraphrases) ? testCase.paraphrases : [];
    for (let i = 0; i < paraphrases.length; i++) {
      promptVariants.push({ prompt: paraphrases[i], paraphraseIndex: i + 1 });
    }

    for (const variant of promptVariants) {
      for (let repeatIndex = 1; repeatIndex <= repeatCount; repeatIndex++) {
        expanded.push({
          ...testCase,
          prompt: variant.prompt ?? testCase.prompt,
          metadata: {
            ...(testCase.metadata || {}),
            repeat_index: repeatIndex,
            repeat_count: repeatCount,
            paraphrase_index: variant.paraphraseIndex,
            original_prompt: variant.paraphraseIndex ? testCase.prompt : undefined,
          },
        });
      }
    }
  }

  return expanded;
}

function detectDryRunEvalType(testCase) {
  if (testCase.expected_tool) return 'tool_call';
  if (testCase.expected_contains) return 'contains';
  if (testCase.expected_regex) return 'regex';
  if (testCase.expected) return 'exact_match';
  if (testCase.criteria) return 'llm_judge';
  return 'existence';
}

function isEvaluatorInfrastructureFailure(evalResult) {
  return Boolean(evalResult?.evalError || evalResult?.parseError);
}

function judgeMetadata(testCase, evalResult = {}) {
  return {
    judge_template: evalResult.judgeTemplate || testCase.judge_template || testCase.metadata?.judge_template,
    judge_template_hash: evalResult.judgeTemplateHash,
    judge_prompt_hash: evalResult.judgePromptHash,
    panelResults: evalResult.panelResults,
    winner: evalResult.winner,
    expectedWinner: evalResult.expectedWinner,
    shownWinner: evalResult.shownWinner,
    order: evalResult.order,
    judge_cost: evalResult.judgeCost ?? evalResult.cost,
    judge_usage: evalResult.judgeUsage,
    judge_latency_ms: evalResult.judgeLatencyMs,
    judge_cost_unknown: Boolean(evalResult.judgeCostUnknown),
  };
}

function combineCosts(...costs) {
  const known = costs.filter(cost => typeof cost === 'number');
  return known.length > 0 ? known.reduce((sum, cost) => sum + cost, 0) : null;
}

function isBillableProvider(providerName) {
  return providerName !== 'ollama' && providerName !== 'static';
}

function productCostUnknown(providerName, result = {}) {
  return Boolean(isBillableProvider(providerName) && result.usage && result.cost == null);
}

function resultCostUnknown(providerName, result = {}, evalResult = {}) {
  return productCostUnknown(providerName, result) || Boolean(evalResult.costUnknown || evalResult.judgeCostUnknown);
}

function estimateTextTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function estimateMessagesTokens(messages) {
  const normalized = Array.isArray(messages) ? messages : [{ role: 'user', content: messages }];
  return normalized.reduce((sum, message) => sum + estimateTextTokens(message.content || ''), 0);
}

function estimateProviderCost(provider, model, messages, maxTokens) {
  const usage = {
    prompt_tokens: estimateMessagesTokens(messages),
    completion_tokens: maxTokens || 0,
  };
  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
  if (provider && typeof provider.calculateCost === 'function') {
    const providerCost = provider.calculateCost(usage, model);
    if (providerCost !== null && providerCost !== undefined) return providerCost;
  }
  return calculateCost(model, usage);
}

function enforcePreflightCallCost({ provider, model, messages, maxTokens, maxCallCostUsd, kind }) {
  if (maxCallCostUsd === null || maxCallCostUsd === undefined) return;
  if (!isBillableProvider(provider.name)) return;
  const estimatedCost = estimateProviderCost(provider, model, messages, maxTokens);
  if (estimatedCost === null || estimatedCost === undefined) {
    throw new Error(`${kind} call cost is unknown for ${provider.name}/${model}; --max-call-cost requires known pricing`);
  }
  if (estimatedCost > maxCallCostUsd) {
    throw new Error(`${kind} call estimated cost ${formatCost(estimatedCost)} exceeds --max-call-cost ${formatCost(maxCallCostUsd)}`);
  }
}

function enforceActualCallCost({ provider, model, result, maxCallCostUsd, kind }) {
  if (maxCallCostUsd === null || maxCallCostUsd === undefined) return;
  if (!isBillableProvider(provider.name)) return;
  if (result?.usage && result.cost == null) {
    throw new Error(`${kind} call actual cost is unknown for ${provider.name}/${model}; --max-call-cost requires known pricing`);
  }
  if (typeof result?.cost === 'number' && result.cost > maxCallCostUsd) {
    throw new Error(`${kind} call actual cost ${formatCost(result.cost)} exceeds --max-call-cost ${formatCost(maxCallCostUsd)}`);
  }
}

function createCallBudget(maxCalls) {
  return {
    maxCalls,
    used: 0,
    blocked: false,
    consume(kind, details = {}) {
      if (maxCalls === null || maxCalls === undefined) return null;
      if (this.used >= maxCalls) {
        this.blocked = true;
        throw new Error(`Max calls exceeded before ${kind} call (${this.used}/${maxCalls})`);
      }
      this.used += 1;
      return { index: this.used, max: maxCalls, kind, ...details };
    },
    exhausted() {
      return maxCalls !== null && maxCalls !== undefined && this.used >= maxCalls;
    },
  };
}

function emitJsonlEvent(cliConfig, event) {
  if (!cliConfig.streamJsonl) return;
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n';
  if (cliConfig.streamJsonlPath) {
    const streamPath = resolve(process.cwd(), cliConfig.streamJsonlPath);
    mkdirSync(dirname(streamPath), { recursive: true });
    writeFileSync(streamPath, line, { flag: 'a' });
  } else {
    process.stderr.write(line);
  }
}

function initJsonlStream(cliConfig) {
  if (cliConfig.streamJsonl && cliConfig.streamJsonlPath) {
    const streamPath = resolve(process.cwd(), cliConfig.streamJsonlPath);
    mkdirSync(dirname(streamPath), { recursive: true });
    writeFileSync(streamPath, '', 'utf8');
  }
}

function getRunProvider(modelConfig) {
  if (modelConfig.provider === 'static') {
    return {
      name: 'static',
      defaultModel: modelConfig.model,
      async complete() {
        throw new Error('Static eval cases do not call a model provider');
      },
    };
  }
  return getProvider(modelConfig.provider);
}

async function resolveJudgeProvider(cliConfig) {
  const explicitProviderName = process.env.JUDGE_PROVIDER || cliConfig.provider || process.env.DEFAULT_PROVIDER;
  if (!explicitProviderName) {
    return resolveDefaultRemoteJudgeProvider();
  }

  const judgeProviderName = explicitProviderName;
  if (judgeProviderName === 'ollama' && parseBoolean(process.env.ALLOW_LOCAL_JUDGE) !== true) {
    throw new Error('Local Ollama judge requires ALLOW_LOCAL_JUDGE=true');
  }
  const judgeProvider = getProvider(judgeProviderName);
  if (typeof judgeProvider.isAvailable === 'function' && !(await judgeProvider.isAvailable())) {
    throw new Error(`Judge provider "${judgeProviderName}" is not available`);
  }
  return judgeProvider;
}

async function resolveDefaultRemoteJudgeProvider() {
  const available = await getAvailableProviders();
  const remoteOrder = ['openai', 'anthropic', 'google', 'openrouter'];
  for (const name of remoteOrder) {
    const match = available.find(provider => provider.name === name && provider.available);
    if (match) return match.provider;
  }

  const local = available.find(provider => provider.name === 'ollama' && provider.available);
  if (local && parseBoolean(process.env.ALLOW_LOCAL_JUDGE) === true) {
    return local.provider;
  }

  throw new Error('No remote judge provider available; set JUDGE_PROVIDER or ALLOW_LOCAL_JUDGE=true for Ollama');
}

async function resolveJudgePanel(panelSpec) {
  if (!panelSpec) return [];
  const members = panelSpec.split(',').map(item => item.trim()).filter(Boolean);
  const panel = [];

  for (const member of members) {
    const separator = member.indexOf(':');
    const providerName = separator >= 0 ? member.slice(0, separator) : member;
    const model = separator >= 0 ? member.slice(separator + 1) : undefined;
    const provider = getProvider(providerName);
    if (providerName === 'ollama' && parseBoolean(process.env.ALLOW_LOCAL_JUDGE) !== true) {
      throw new Error('Local Ollama judge requires ALLOW_LOCAL_JUDGE=true');
    }
    if (typeof provider.isAvailable === 'function' && !(await provider.isAvailable())) {
      throw new Error(`Judge panel provider "${providerName}" is not available`);
    }
    panel.push({ providerName, provider, model: model || provider.defaultModel });
  }

  return panel;
}

// =============================================================================
// Eval Execution with Retry
// =============================================================================

async function runTestCaseWithRetry(testCase, modelConfig, provider, options = {}) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const result = await runTestCase(testCase, modelConfig, provider, options);
    
    if (result.success) {
      if (attempt > 1) {
        result.retries = attempt - 1;
      }
      return result;
    }
    
    lastError = result.error;
    
    // Don't retry on certain errors
    if (
      result.error?.includes('API key')
      || result.error?.includes('not configured')
      || result.error?.includes('No judge provider available')
      || result.evalType === 'llm_judge'
      || result.evalType === 'pairwise_judge'
    ) {
      return result;
    }
    
    if (attempt <= MAX_RETRIES) {
      if (options.verbose) {
        console.log(`\n      ⟳ Retry ${attempt}/${MAX_RETRIES}...`);
      }
      await sleep(RETRY_DELAY_MS * attempt); // Exponential backoff
    }
  }
  
  return {
    success: false,
    testCase: testCase.name,
    model: modelConfig.model,
    provider: provider.name,
    text: null,
    usage: null,
    latencyMs: 0,
    cost: null,
    error: lastError,
    pass: false,
    score: 0,
    evalReason: `Failed after ${MAX_RETRIES} retries: ${lastError}`,
    evalType: 'error',
    retries: MAX_RETRIES,
  };
}

async function runTestCase(testCase, modelConfig, provider, options = {}) {
  const startTime = Date.now();
  const model = modelConfig.model;
  let messages = [];
  
  try {
    if (testCaseUsesStaticResponse(testCase)) {
      const staticResponse = testCase.static_response ?? testCase.staticResponse ?? '';
      let evalResult;

      if (options.skipJudge && testCaseRequiresJudge(testCase)) {
        evalResult = {
          pass: null,
          score: null,
          reason: 'Skipped judge-based evaluation',
          evalType: 'skipped_judge',
        };
      } else if (testCaseRequiresJudge(testCase) && !options.judgeProvider && !options.judgePanel?.length) {
        evalResult = {
          pass: false,
          score: 0,
          reason: 'No judge provider available',
          evalType: testCase.eval_type === 'pairwise_judge' ? 'pairwise_judge' : 'llm_judge',
          evalError: true,
        };
      } else {
        evalResult = await evaluate(testCase, staticResponse, {
          judgeProvider: options.judgeProvider,
          judgeModel: options.judgeModel,
          judgePanel: options.judgePanel,
          timeoutMs: options.timeoutMs,
          callBudget: options.callBudget,
          maxCallCostUsd: options.maxCallCostUsd,
        });
      }

      if (isEvaluatorInfrastructureFailure(evalResult)) {
        return {
          success: false,
          testCase: testCase.name,
          model,
          provider: provider.name,
          text: staticResponse,
          usage: null,
          latencyMs: Date.now() - startTime,
          cost: evalResult.cost ?? evalResult.judgeCost ?? null,
          costUnknown: Boolean(evalResult.judgeCostUnknown),
          error: evalResult.reason,
          pass: false,
          score: 0,
          evalReason: evalResult.reason,
          evalType: evalResult.evalType || 'evaluator_error',
          prompt: testCase.prompt || testCase.question,
          systemPrompt: testCase.system_prompt,
          promptVersion: testCase.prompt_version || testCase.metadata?.prompt_version || null,
          metadata: {
            ...testCaseMetadata(testCase),
            ...(evalResult.metadata || {}),
            ...judgeMetadata(testCase, evalResult),
            expected_pass: testCase.expected_pass ?? testCase.expectedPass,
            judge_error: true,
            cost_unknown: Boolean(evalResult.judgeCostUnknown),
            metrics: evalResult.metrics,
          },
        };
      }

      const hasExpectedPass = testCase.expected_pass !== undefined || testCase.expectedPass !== undefined;
      const expectedPass = testCase.expected_pass ?? testCase.expectedPass;
      const replayPass = hasExpectedPass && evalResult.pass !== null
        ? evalResult.pass === expectedPass
        : evalResult.pass;
      const replayScore = hasExpectedPass && evalResult.pass !== null
        ? (replayPass ? 1 : 0)
        : evalResult.score;
      const replayReason = hasExpectedPass && evalResult.pass !== null
        ? `Judge ${replayPass ? 'matched' : 'mismatched'} human label (${expectedPass ? 'pass' : 'fail'}): ${evalResult.reason}`
        : evalResult.reason;

      return {
        success: true,
        testCase: testCase.name,
        model,
        provider: provider.name,
        text: staticResponse,
        usage: null,
        latencyMs: Date.now() - startTime,
        cost: evalResult.cost ?? evalResult.judgeCost ?? null,
        costUnknown: Boolean(evalResult.judgeCostUnknown),
        error: null,
        pass: replayPass,
        score: replayScore,
        evalReason: replayReason,
        evalType: hasExpectedPass ? 'human_label_replay' : evalResult.evalType,
        prompt: testCase.prompt || testCase.question,
        systemPrompt: testCase.system_prompt,
        promptVersion: testCase.prompt_version || testCase.metadata?.prompt_version || null,
        metadata: {
          ...testCaseMetadata(testCase),
          ...(evalResult.metadata || {}),
          ...judgeMetadata(testCase, evalResult),
          expected_pass: hasExpectedPass ? expectedPass : undefined,
          judge_pass: evalResult.pass,
          judge_score: evalResult.score,
          judge_eval_type: evalResult.evalType,
          cost_unknown: Boolean(evalResult.judgeCostUnknown),
          metrics: evalResult.metrics,
        },
      };
    }

    if (['rag_retrieval', 'personalization_context', 'context_surface'].includes(detectedEvalType(testCase))) {
      const evalResult = await evaluate(testCase, testCase.answer || '', {
        judgeProvider: options.judgeProvider,
        judgeModel: options.judgeModel,
        judgePanel: options.judgePanel,
        callBudget: options.callBudget,
        maxCallCostUsd: options.maxCallCostUsd,
      });

      return {
        success: true,
        testCase: testCase.name,
        model,
        provider: provider.name,
        text: testCase.answer || '',
        usage: null,
        latencyMs: Date.now() - startTime,
        cost: null,
        error: null,
        pass: evalResult.pass,
        score: evalResult.score,
        evalReason: evalResult.reason,
        evalType: evalResult.evalType,
        prompt: testCase.prompt || testCase.question,
        systemPrompt: testCase.system_prompt,
        promptVersion: testCase.prompt_version || testCase.metadata?.prompt_version || null,
        metadata: {
          ...testCaseMetadata(testCase),
          ...(evalResult.metadata || {}),
          ...judgeMetadata(testCase, evalResult),
          metrics: evalResult.metrics,
        },
      };
    }

    // Build messages
    messages = [];
    
    if (testCase.system_prompt) {
      messages.push({ role: 'system', content: testCase.system_prompt });
    }
    
    messages.push({ role: 'user', content: testCase.prompt });

    const completionOptions = {
      model,
      temperature: testCase.temperature ?? modelConfig.temperature ?? 0.7,
      max_tokens: testCase.max_tokens ?? modelConfig.max_tokens ?? 2048,
    };
    if (testCase.tools || options.tools) completionOptions.tools = testCase.tools || options.tools;
    if (testCase.tool_choice || options.tool_choice) completionOptions.tool_choice = testCase.tool_choice || options.tool_choice;

    // Check cache first (unless disabled)
    let result;
    let fromCache = false;
    const cacheKey = getCacheKey(provider.name, model, messages, completionOptions);
    
    if (USE_CACHE && !options.noCache) {
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        result = cached;
        result.latencyMs = 0; // Instant from cache
        fromCache = true;
      }
    }

    // Run completion with rate limiting
    if (!result) {
      options.callBudget?.consume('completion', {
        provider: provider.name,
        model,
        testCase: testCase.name,
      });
      enforcePreflightCallCost({
        provider,
        model,
        messages,
        maxTokens: completionOptions.max_tokens,
        maxCallCostUsd: options.maxCallCostUsd,
        kind: 'completion',
      });
      result = await withRateLimit(provider.name, async () => {
        return provider.complete(messages, completionOptions);
      });
      
      // Cache the result
      if (USE_CACHE && !options.noCache) {
        setCachedResponse(cacheKey, result);
      }
    }
    
    // Calculate accurate cost
    if (result.usage && !result.cost) {
      result.cost = calculateCost(model, result.usage);
    }
    enforceActualCallCost({
      provider,
      model,
      result,
      maxCallCostUsd: options.maxCallCostUsd,
      kind: 'completion',
    });

    // Evaluate the response
    const evalResult = options.skipJudge && testCaseRequiresJudge(testCase)
      ? {
          pass: null,
          score: null,
          reason: 'Skipped judge-based evaluation',
          evalType: 'skipped_judge',
        }
      : testCaseRequiresJudge(testCase) && !options.judgeProvider && !options.judgePanel?.length
        ? {
            pass: false,
            score: 0,
            reason: 'No judge provider available',
            evalType: 'llm_judge',
            evalError: true,
          }
      : await evaluate(testCase, result.text, {
          judgeProvider: options.judgeProvider,
          judgeModel: options.judgeModel,
          judgePanel: options.judgePanel,
          toolCalls: result.toolCalls || result.tool_calls || [],
          toolResults: result.toolResults || result.tool_results || [],
          timeoutMs: options.timeoutMs,
          callBudget: options.callBudget,
          maxCallCostUsd: options.maxCallCostUsd,
        });
    const totalCost = combineCosts(result.cost, evalResult.cost ?? evalResult.judgeCost);
    const costUnknown = resultCostUnknown(provider.name, result, evalResult);

    if (isEvaluatorInfrastructureFailure(evalResult)) {
      return {
        success: false,
        testCase: testCase.name,
        model,
        provider: provider.name,
        text: result.text,
        usage: result.usage,
        latencyMs: result.latencyMs,
        cost: totalCost,
        costUnknown,
        error: evalResult.reason,
        pass: false,
        score: 0,
        evalReason: evalResult.reason,
        evalType: evalResult.evalType || 'evaluator_error',
        fromCache,
        prompt: testCase.prompt,
        systemPrompt: testCase.system_prompt,
        promptVersion: testCase.prompt_version || testCase.metadata?.prompt_version || null,
        metadata: { ...testCaseMetadata(testCase), ...(evalResult.metadata || {}), ...judgeMetadata(testCase, evalResult), product_cost: result.cost, cost_unknown: costUnknown, judge_error: true, metrics: evalResult.metrics },
        messages,
        transcript: testCase.transcript || null,
        toolCalls: result.toolCalls || result.tool_calls || null,
        toolResults: result.toolResults || result.tool_results || null,
      };
    }

    return {
      success: true,
      testCase: testCase.name,
      model,
      provider: provider.name,
      text: result.text,
      usage: result.usage,
      latencyMs: result.latencyMs,
      cost: totalCost,
      costUnknown,
      error: null,
      pass: evalResult.pass,
      score: evalResult.score,
      evalReason: evalResult.reason,
      evalType: evalResult.evalType,
      fromCache,
      // For tracing
      prompt: testCase.prompt,
      systemPrompt: testCase.system_prompt,
      promptVersion: testCase.prompt_version || testCase.metadata?.prompt_version || null,
      metadata: { ...testCaseMetadata(testCase), ...(evalResult.metadata || {}), ...judgeMetadata(testCase, evalResult), product_cost: result.cost, cost_unknown: costUnknown, metrics: evalResult.metrics },
      messages,
      transcript: testCase.transcript || null,
      toolCalls: result.toolCalls || result.tool_calls || null,
      toolResults: result.toolResults || result.tool_results || null,
    };
  } catch (error) {
    return {
      success: false,
      testCase: testCase.name,
      model,
      provider: provider.name,
      text: null,
      usage: null,
      latencyMs: Date.now() - startTime,
      cost: null,
      error: error.message,
      pass: false,
      score: 0,
      evalReason: `Error: ${error.message}`,
      evalType: 'error',
      prompt: testCase.prompt,
      systemPrompt: testCase.system_prompt,
      promptVersion: testCase.prompt_version || testCase.metadata?.prompt_version || null,
      metadata: testCaseMetadata(testCase),
      messages,
    };
  }
}

async function runEval(evalConfig, cliConfig) {
  const results = [];
  const testCases = expandTestCases(evalConfig.test_cases || [], cliConfig.repeat);
  const models = await resolveExecutionModels(evalConfig, cliConfig);
  const callBudget = createCallBudget(cliConfig.maxCalls);
  
  // Create trace for this run
  const trace = createTrace(evalConfig);
  
  // Get judge provider for LLM-as-judge evaluations
  let judgeProvider = null;
  let judgePanel = [];
  let judgeModel = process.env.JUDGE_MODEL || null;
  let costLimitError = null;
  
  if (!cliConfig.skipJudge && evalConfigRequiresJudge(evalConfig)) {
    try {
      judgePanel = await resolveJudgePanel(cliConfig.judgePanel);
      if (judgePanel.length === 0) {
        judgeProvider = await resolveJudgeProvider(cliConfig);
        judgeModel = judgeModel || judgeProvider.defaultModel;
      }
    } catch (error) {
      console.warn(`   ⚠️  No judge provider available: ${error.message}`);
    }
  }

  console.log(`\n📋 Running eval: ${evalConfig.name}`);
  console.log(`   ${evalConfig.description || ''}`);
  console.log(`   Test cases: ${testCases.length}`);
  if (cliConfig.repeat > 1) console.log(`   Repeats: ${cliConfig.repeat}`);
  console.log(`   Models: ${models.length}`);
  console.log(`   Scoring: ${cliConfig.skipJudge ? 'Disabled' : 'Enabled'}`);
  console.log(`   Parallel: ${cliConfig.parallel ? `Yes (${PARALLEL_LIMIT} concurrent)` : 'No'}`);
  console.log(`   Caching: ${cliConfig.noCache ? 'Disabled' : 'Enabled'}`);
  console.log(`   Auto-retry: ${MAX_RETRIES} attempts\n`);

  // Build list of all test runs
  const runs = [];
  for (const testCase of testCases) {
    for (const modelConfig of models) {
      runs.push({ testCase, modelConfig });
    }
  }

  // Run tests (parallel or sequential)
  if (cliConfig.parallel) {
    console.log(`   Running ${runs.length} tests in parallel...\n`);
    
    // Process in batches
    for (let i = 0; i < runs.length; i += PARALLEL_LIMIT) {
      if (costLimitError) break;
      const batch = runs.slice(i, i + PARALLEL_LIMIT);
      const callsBeforeBatch = callBudget.used;
      
      const batchResults = await Promise.all(
        batch.map(async ({ testCase, modelConfig }) => {
          const provider = getRunProvider(modelConfig);

          return runTestCaseWithRetry(testCase, modelConfig, provider, {
            skipJudge: cliConfig.skipJudge,
            judgeProvider,
            judgeModel,
            judgePanel,
            verbose: cliConfig.verbose,
            noCache: cliConfig.noCache,
            tools: evalConfig.tools,
            tool_choice: evalConfig.tool_choice,
            callBudget,
            maxCallCostUsd: cliConfig.maxCallCostUsd,
          });
        })
      );
      
      for (const result of batchResults) {
        results.push(result);
        addTraceResult(trace, result);
        emitJsonlEvent(cliConfig, { type: 'result', result });
        
        const passIcon = result.pass === null ? '⚪' : (result.pass ? '✅' : '❌');
        const scoreStr = result.score !== null ? ` ${formatScore(result.score)}` : '';
        const cacheStr = result.fromCache ? ' (cached)' : '';
        console.log(`   ${passIcon} ${result.testCase} | ${result.provider}/${result.model}${scoreStr}${cacheStr}`);
      }
      costLimitError = costLimitMessage(results, cliConfig.maxCostUsd);
      if (costLimitError) {
        console.error(`\n❌ ${costLimitError}`);
      } else if ((callBudget.used > callsBeforeBatch && callBudget.exhausted()) || callBudget.blocked) {
        costLimitError = `Max calls reached (${callBudget.used}/${callBudget.maxCalls})`;
        console.error(`\n⏹️  ${costLimitError}`);
      }
    }
  } else {
    // Sequential execution
    for (const testCase of testCases) {
      if (costLimitError) break;
      console.log(`\n🧪 Test: ${testCase.name}`);
      
      if (testCase.expected || testCase.expected_tool || testCase.expected_contains) {
        const expected = testCase.expected || testCase.expected_tool || testCase.expected_contains;
        console.log(`   Expected: ${truncateText(JSON.stringify(expected), 50)}`);
      }

      for (const modelConfig of models) {
        if (costLimitError) break;
        const provider = getRunProvider(modelConfig);

        const model = modelConfig.model;
        process.stdout.write(`   ⏳ ${provider.name}/${model}... `);
        const callsBeforeRun = callBudget.used;

        const result = await runTestCaseWithRetry(testCase, modelConfig, provider, {
          skipJudge: cliConfig.skipJudge,
          judgeProvider,
          judgeModel,
          judgePanel,
          verbose: cliConfig.verbose,
          noCache: cliConfig.noCache,
          tools: evalConfig.tools,
          tool_choice: evalConfig.tool_choice,
          callBudget,
          maxCallCostUsd: cliConfig.maxCallCostUsd,
        });
        
        results.push(result);
        addTraceResult(trace, result);
        emitJsonlEvent(cliConfig, { type: 'result', result });

        if (result.success) {
          const passIcon = result.pass === null ? '⚪' : (result.pass ? '✅' : '❌');
          const scoreStr = result.score !== null ? ` ${formatScore(result.score)}` : '';
          const retryStr = result.retries ? ` (${result.retries} retries)` : '';
          const cacheStr = result.fromCache ? ' (cached)' : '';
          console.log(`${passIcon}${scoreStr} | ${formatDuration(result.latencyMs)} | ${formatCost(result.cost)}${retryStr}${cacheStr}`);
          
          if (cliConfig.verbose && result.evalReason) {
            console.log(`      └─ ${result.evalReason}`);
          }
        } else {
          console.log(`❌ Error: ${truncateText(result.error, 50)}`);
        }
        costLimitError = costLimitMessage(results, cliConfig.maxCostUsd);
        if (costLimitError) {
          console.error(`\n❌ ${costLimitError}`);
        } else if ((callBudget.used > callsBeforeRun && callBudget.exhausted()) || callBudget.blocked) {
          costLimitError = `Max calls reached (${callBudget.used}/${callBudget.maxCalls})`;
          console.error(`\n⏹️  ${costLimitError}`);
        }
      }
    }
  }

  // Save trace
  const summary = {
    passed: results.filter(r => r.pass === true).length,
    failed: results.filter(r => r.pass === false).length,
    errors: results.filter(r => !r.success).length,
    total: results.length,
    costLimitExceeded: Boolean(costLimitError),
    costLimitError,
    callsUsed: callBudget.used,
    maxCalls: callBudget.maxCalls,
    reliability: calculateReliabilityMetrics(results),
  };
  const tracePath = saveTrace(trace, summary);
  console.log(`\n📊 Trace saved: ${tracePath}`);
  emitJsonlEvent(cliConfig, { type: 'summary', summary: { ...summary, traceId: trace.id } });

  return { results, traceId: trace.id, costLimitError };
}

// =============================================================================
// Results Formatting
// =============================================================================

function generateMarkdownReport(evalConfig, results, traceId) {
  const lines = [];
  
  lines.push(`# Eval Results: ${evalConfig.name}`);
  lines.push('');
  lines.push(`> ${evalConfig.description || 'No description'}`);
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString()}`);
  lines.push(`**Trace ID:** ${traceId}`);
  lines.push('');

  const passCount = results.filter(r => r.pass === true).length;
  const failCount = results.filter(r => r.pass === false).length;
  const skipCount = results.filter(r => r.pass === null).length;
  const avgScore = results.filter(r => r.score !== null).reduce((sum, r) => sum + r.score, 0) / 
    Math.max(results.filter(r => r.score !== null).length, 1);
  
  lines.push('## Overall Results');
  lines.push('');
  lines.push(`- **Pass:** ${passCount}/${results.length}`);
  lines.push(`- **Fail:** ${failCount}/${results.length}`);
  lines.push(`- **Skipped:** ${skipCount}/${results.length}`);
  lines.push(`- **Avg Score:** ${formatScore(avgScore)}`);
  lines.push('');

  lines.push('## Summary by Model');
  lines.push('');
  lines.push('| Model | Provider | Pass Rate | Avg Score | Avg Latency | Total Cost |');
  lines.push('|-------|----------|-----------|-----------|-------------|------------|');

  const byModel = {};
  for (const r of results) {
    const key = `${r.provider}/${r.model}`;
    if (!byModel[key]) {
      byModel[key] = { results: [], model: r.model, provider: r.provider };
    }
    byModel[key].results.push(r);
  }

  for (const [key, data] of Object.entries(byModel)) {
    const successful = data.results.filter(r => r.success);
    const passed = data.results.filter(r => r.pass === true).length;
    const total = data.results.length;
    const passRate = `${passed}/${total} (${Math.round(passed/total*100)}%)`;
    
    const scores = data.results.filter(r => r.score !== null);
    const avgScore = scores.length > 0 
      ? formatScore(scores.reduce((sum, r) => sum + r.score, 0) / scores.length)
      : 'N/A';
    
    const avgLatency = successful.length > 0
      ? formatDuration(successful.reduce((sum, r) => sum + r.latencyMs, 0) / successful.length)
      : 'N/A';
    
    const totalCost = formatCost(successful.reduce((sum, r) => sum + (r.cost || 0), 0));

    lines.push(`| ${data.model} | ${data.provider} | ${passRate} | ${avgScore} | ${avgLatency} | ${totalCost} |`);
  }
  lines.push('');

  lines.push('## Detailed Results');
  lines.push('');

  const testCases = [...new Set(results.map(r => r.testCase))];
  
  for (const testCase of testCases) {
    lines.push(`### ${testCase}`);
    lines.push('');
    
    const testResults = results.filter(r => r.testCase === testCase);
    
    for (const r of testResults) {
      const passIcon = r.pass === null ? '⚪' : (r.pass ? '✅' : '❌');
      lines.push(`#### ${passIcon} ${r.provider}/${r.model}`);
      lines.push('');
      lines.push(`- **Status:** ${r.success ? (r.pass ? 'Pass' : 'Fail') : 'Error'}`);
      lines.push(`- **Score:** ${formatScore(r.score)}`);
      lines.push(`- **Eval Type:** ${r.evalType || 'N/A'}`);
      lines.push(`- **Reason:** ${r.evalReason || 'N/A'}`);
      lines.push(`- **Latency:** ${formatDuration(r.latencyMs)}`);
      lines.push(`- **Cost:** ${formatCost(r.cost)}`);
      
      if (r.usage) {
        lines.push(`- **Tokens:** ${r.usage.prompt_tokens} in / ${r.usage.completion_tokens} out`);
      }
      
      if (r.retries) {
        lines.push(`- **Retries:** ${r.retries}`);
      }
      
      if (r.error) {
        lines.push(`- **Error:** ${r.error}`);
      }
      
      // Always show response for debugging (even if empty or failed)
      lines.push('');
      lines.push('<details>');
      lines.push(`<summary>Response${r.text ? '' : ' (empty)'}</summary>`);
      lines.push('');
      lines.push('```');
      lines.push(r.text ? r.text.trim() : '(no response content)');
      lines.push('```');
      lines.push('</details>');
      lines.push('');
    }
  }

  const totalCost = results.reduce((sum, r) => sum + (r.cost || 0), 0);
  const totalTokens = results.reduce((sum, r) => sum + (r.usage?.total_tokens || 0), 0);
  
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total Cost:** ${formatCost(totalCost)}`);
  lines.push(`- **Total Tokens:** ${totalTokens.toLocaleString()}`);
  lines.push(`- **Total Requests:** ${results.length}`);
  lines.push(`- **Passed:** ${passCount}`);
  lines.push(`- **Failed:** ${failCount}`);
  const reliability = calculateReliabilityMetrics(results);
  if (reliability.caseCount > 0) {
    lines.push(`- **Pass@K:** ${formatScore(reliability.passAtK)}`);
    lines.push(`- **Consistency:** ${formatScore(reliability.consistency)}`);
    lines.push(`- **Unauthorized Failures:** ${reliability.unauthorizedFailures}`);
    lines.push(`- **Safety-Weighted Failures:** ${reliability.safetyWeightedFailures}`);
  }
  lines.push('');

  return lines.join('\n');
}

function generateJsonReport(evalConfig, results, traceId) {
  return JSON.stringify({
    evalName: evalConfig.name,
    traceId,
    timestamp: new Date().toISOString(),
    summary: {
      passed: results.filter(r => r.pass === true).length,
      failed: results.filter(r => r.pass === false).length,
      skipped: results.filter(r => r.pass === null).length,
      errors: results.filter(r => !r.success).length,
      total: results.length,
      passRate: results.length > 0
        ? results.filter(r => r.pass === true).length / results.length
        : 0,
      reliability: calculateReliabilityMetrics(results),
    },
    results,
  }, null, 2);
}

function generateJsonlReport(evalConfig, results, traceId) {
  const lines = results.map(result => JSON.stringify({
    type: 'result',
    evalName: evalConfig.name,
    traceId,
    result,
  }));
  lines.push(JSON.stringify({
    type: 'summary',
    evalName: evalConfig.name,
    traceId,
    timestamp: new Date().toISOString(),
    total: results.length,
    passed: results.filter(r => r.pass === true).length,
    failed: results.filter(r => r.pass === false).length,
    skipped: results.filter(r => r.pass === null).length,
    errors: results.filter(r => !r.success).length,
  }));
  return lines.join('\n') + '\n';
}

function printResultsSummary(results) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTS SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.pass === true).length;
  const failed = results.filter(r => r.pass === false).length;
  const errors = results.filter(r => !r.success).length;
  
  const scores = results.filter(r => r.score !== null);
  const avgScore = scores.length > 0 
    ? scores.reduce((sum, r) => sum + r.score, 0) / scores.length
    : null;
  
  const successful = results.filter(r => r.success);
  const avgLatency = successful.length > 0
    ? successful.reduce((sum, r) => sum + r.latencyMs, 0) / successful.length
    : 0;
  const totalCost = successful.reduce((sum, r) => sum + (r.cost || 0), 0);

  console.log(`\n  Total Tests: ${results.length}`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⚠️  Errors: ${errors}`);
  console.log(`  📈 Avg Score: ${avgScore !== null ? formatScore(avgScore) : 'N/A'}`);
  console.log(`  ⏱️  Avg Latency: ${formatDuration(avgLatency)}`);
  console.log(`  💰 Total Cost: ${formatCost(totalCost)}`);
  console.log('');
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const config = parseArgs();

  // Clear cache mode
  if (config.clearCache) {
    const { clearCache } = await import('./cache.mjs');
    const count = clearCache();
    console.log(`\n🗑️  Cleared ${count} cached responses\n`);
    process.exit(0);
  }

  initJsonlStream(config);

  // List providers mode
  if (config.listProviders) {
    console.log('\n📦 Available Providers:\n');
    const providers = await getAvailableProviders();
    for (const { name, available } of providers) {
      const status = available ? '✅' : '❌';
      console.log(`  ${status} ${name}`);
    }
    console.log('\nConfigure providers in .env file\n');
    process.exit(0);
  }

  // List history mode
  if (config.listHistory) {
    console.log('\n📜 Eval Run History:\n');
    const traces = listTraces();
    if (traces.length === 0) {
      console.log('  No traces found. Run an eval first.\n');
    } else {
      console.log('| Date | Eval | Passed | Failed | Total | Trace ID |');
      console.log('|------|------|--------|--------|-------|----------|');
      for (const t of traces.slice(0, 20)) {
        const date = new Date(t.startedAt).toLocaleDateString();
        console.log(`| ${date} | ${t.evalName || 'N/A'} | ${t.passed || 0} | ${t.failed || 0} | ${t.total || 0} | ${t.id} |`);
      }
      console.log('');
    }
    process.exit(0);
  }

  // Load eval config (supports JSON, JSONL, CSV)
  const evalFile = config.evalFile || 'evals/llm-comparison.json';
  const evalPath = resolve(process.cwd(), evalFile);
  const ext = extname(evalFile).toLowerCase();
  
  let evalConfig;
  try {
    if (ext === '.csv' || ext === '.jsonl') {
      // Use dataset loader for CSV/JSONL
      evalConfig = loadDataset(evalPath);
      if (!shouldSuppressLoadLog(config)) {
        console.log(`\n📄 Loaded dataset: ${evalPath} (${evalConfig.test_cases.length} test cases)`);
      }
      
    } else {
      // Standard JSON config
      const content = readFileSync(evalPath, 'utf8');
      evalConfig = JSON.parse(content);
      if (!shouldSuppressLoadLog(config)) {
        console.log(`\n📄 Loaded: ${evalPath}`);
      }
    }
  } catch (error) {
    console.error(`\n❌ Error loading eval config: ${evalFile}`);
    console.error(`   ${error.message}`);
    console.error(`\nSupported formats: .json, .jsonl, .csv`);
    console.error(`\nAvailable evals:`);
    console.error(`   evals/llm-comparison.json`);
    console.error(`   evals/prompt-variants.json`);
    console.error(`   evals/code-generation.json`);
    console.error(`   evals/rag-pipeline.json`);
    console.error(`   evals/agent-tools.json`);
    process.exit(1);
  }

  if (config.dryRun) {
    const plan = buildDryRunPlan(evalConfig, config);
    if (config.outputFormat === 'json' || config.output.endsWith('.json')) {
      console.log(JSON.stringify(plan, null, 2));
    } else if (config.outputFormat === 'jsonl' || config.output.endsWith('.jsonl')) {
      for (const run of plan.runsPreview) {
        console.log(JSON.stringify({ type: 'planned_run', ...run }));
      }
      console.log(JSON.stringify({ type: 'summary', ...plan, runsPreview: undefined }));
    } else {
      console.log('\n# Dry Run Plan\n');
      console.log(`- Eval: ${plan.evalName}`);
      console.log(`- Test cases: ${plan.testCases}`);
      console.log(`- Models: ${plan.models}`);
      console.log(`- Planned run rows: ${plan.plannedRuns}`);
      console.log(`- Product calls: ${plan.productCalls}`);
      console.log(`- Judge calls: ${plan.judgeCalls}`);
      console.log(`- Total provider calls: ${plan.totalProviderCalls}`);
      console.log(`- Estimated known cost: ${formatCost(plan.estimatedKnownCostUsd)}`);
      console.log(`- Cost unknown: ${plan.costUnknown ? 'yes' : 'no'}`);
      if (plan.maxCalls !== null && plan.maxCalls !== undefined) {
        console.log(`- Max calls: ${plan.maxCalls}`);
      }
      if (plan.maxCostUsd !== null && plan.maxCostUsd !== undefined) {
        console.log(`- Max run cost: ${formatCost(plan.maxCostUsd)}`);
      }
      if (plan.maxCallCostUsd !== null && plan.maxCallCostUsd !== undefined) {
        console.log(`- Max call cost: ${formatCost(plan.maxCallCostUsd)}`);
      }
    }
    process.exit(0);
  }

  const needsModelProvider = evalConfigRequiresModelProvider(evalConfig);
  let available = [];

  if (needsModelProvider) {
    console.log('\n🔌 Checking providers...');
    const providers = await getAvailableProviders();
    available = providers.filter(p => p.available);
    
    if (available.length === 0) {
      console.error('\n❌ No providers available!');
      console.error('   Configure at least one provider in .env file');
      console.error('   See .env.example for configuration options\n');
      process.exit(1);
    }

    console.log(`   Available: ${available.map(p => p.name).join(', ')}`);
  } else {
    console.log('\n🔌 Model provider not required for this eval');
  }

  const executionModels = await resolveExecutionModels(evalConfig, config);
  const unavailableTargets = needsModelProvider ? executionModels.filter(modelConfig =>
    !available.some(provider => provider.name === modelConfig.provider)
  ) : [];

  if (unavailableTargets.length > 0) {
    console.error(`\n❌ Selected provider(s) are not available: ${unavailableTargets.map(m => m.provider).join(', ')}`);
    console.error('   Configure the matching API key/service, or choose a different provider with --provider\n');
    process.exit(1);
  }

  console.log(`   Running with: ${executionModels.map(m => `${m.provider}/${m.model}`).join(', ')}`);

  // A/B Test mode
  if (config.abTest) {
    console.log('\n🧪 Running A/B Test...');
    const [executionModel] = executionModels;
    const provider = getRunProvider(executionModel);
    let judgeProvider = null;
    let judgePanel = [];
    let judgeModel = process.env.JUDGE_MODEL || null;
    if (!config.skipJudge && evalConfigRequiresJudge({
      test_cases: evalConfig.testCases || evalConfig.test_cases || [],
    })) {
      try {
        judgePanel = await resolveJudgePanel(config.judgePanel);
        if (judgePanel.length === 0) {
          judgeProvider = await resolveJudgeProvider(config);
          judgeModel = judgeModel || judgeProvider.defaultModel;
        }
      } catch (error) {
        console.warn(`   ⚠️  No judge provider available: ${error.message}`);
      }
    }
    const callBudget = createCallBudget(config.maxCalls);
    const abResults = await runABTest(evalConfig, {
      provider,
      model: executionModel.model,
      models: executionModels,
      judgeProvider,
      judgeModel,
      judgePanel,
      tools: evalConfig.tools,
      tool_choice: evalConfig.tool_choice,
      maxCostUsd: config.maxCostUsd,
      maxCallCostUsd: config.maxCallCostUsd,
      callBudget,
    });
    const report = generateABReport(abResults);
    const abFlatResults = abResults.variantA.results.concat(abResults.variantB.results);
    const abCostLimitError = abResults.costLimitError || costLimitMessage(abFlatResults, config.maxCostUsd);
    
    console.log('\n' + report);
    if (abCostLimitError) {
      console.error(`\n❌ ${abCostLimitError}`);
    }
    emitJsonlEvent(config, { type: 'summary', summary: { ...abResults.summary, callsUsed: callBudget.used, maxCalls: callBudget.maxCalls, costLimitError: abCostLimitError } });
    
    if (config.output) {
      writeFileSync(config.output, report, 'utf8');
      console.log(`\n📝 A/B Test report saved to: ${config.output}`);
    }
    const hasFailures = abFlatResults
      .some(result => result.pass === false || result.success === false) || Boolean(abCostLimitError);
    process.exit(hasFailures && !config.allowFailures ? 1 : 0);
  }

  // Multi-turn mode
  if (config.multiTurn) {
    console.log('\n💬 Running Multi-Turn Conversation Test...');
    const [executionModel] = executionModels;
    const provider = getRunProvider(executionModel);
    let judgeProvider = null;
    let judgePanel = [];
    let judgeModel = process.env.JUDGE_MODEL || null;
    if (!config.skipJudge && evalConfigRequiresJudge(evalConfig)) {
      try {
        judgePanel = await resolveJudgePanel(config.judgePanel);
        if (judgePanel.length === 0) {
          judgeProvider = await resolveJudgeProvider(config);
          judgeModel = judgeModel || judgeProvider.defaultModel;
        }
      } catch (error) {
        console.warn(`   ⚠️  No judge provider available: ${error.message}`);
      }
    }
    const trace = createTrace(evalConfig);
    const results = [];
    const callBudget = createCallBudget(config.maxCalls);
    
    // Process each test case as a conversation
    const testCases = evalConfig.test_cases || evalConfig.conversations || [evalConfig];
    
    for (const testCase of testCases) {
      const existingCostLimitError = costLimitMessage(results, config.maxCostUsd);
      if (existingCostLimitError) {
        console.error(`\n❌ ${existingCostLimitError}`);
        break;
      }
      console.log(`\n  Testing: ${testCase.name || 'Conversation'}`);
      const convResult = await runConversation(testCase, provider, {
        model: executionModel.model,
        verbose: config.verbose,
        judgeProvider,
        judgeModel,
        judgePanel,
        callBudget,
        maxCallCostUsd: config.maxCallCostUsd,
      });

      const result = {
        success: convResult.turns.every(turn => turn.evalType !== 'error'),
        testCase: testCase.name || 'Conversation',
        model: executionModel.model,
        provider: provider.name,
        text: convResult.turns.map(turn => turn.assistant || '').join('\n\n'),
        usage: null,
        latencyMs: convResult.turns.reduce((sum, turn) => sum + (turn.latencyMs || 0), 0),
        cost: convResult.turns.reduce((sum, turn) => sum + (turn.cost || 0), 0),
        error: convResult.turns.find(turn => turn.evalType === 'error')?.reason || null,
        pass: convResult.overallPass,
        score: convResult.overallScore,
        evalReason: convResult.overallReason,
        evalType: 'multi_turn',
        prompt: testCase.turns?.[0]?.user || testCase.turns?.[0]?.prompt || '',
        systemPrompt: testCase.system_prompt,
        promptVersion: testCase.prompt_version || testCase.metadata?.prompt_version || null,
        metadata: testCaseMetadata(testCase),
        messages: convResult.messages,
        transcript: convResult.turns,
      };
      results.push(result);
      addTraceResult(trace, result);
      emitJsonlEvent(config, { type: 'result', result });
      
      // Print turn results
      convResult.turns.forEach(turn => {
        const icon = turn.pass === true ? '✅' : turn.pass === false ? '❌' : '⏭️';
        console.log(`    Turn ${turn.turn}: ${icon} ${turn.reason || ''}`);
      });
    }

    const summary = {
      passed: results.filter(r => r.pass === true).length,
      failed: results.filter(r => r.pass === false).length,
      errors: results.filter(r => !r.success).length,
      total: results.length,
      costLimitExceeded: Boolean(costLimitMessage(results, config.maxCostUsd)),
      costLimitError: costLimitMessage(results, config.maxCostUsd),
    };
    const tracePath = saveTrace(trace, summary);
    console.log(`\n📊 Trace saved: ${tracePath}`);
    emitJsonlEvent(config, { type: 'summary', summary: { ...summary, traceId: trace.id, callsUsed: callBudget.used, maxCalls: callBudget.maxCalls } });
    printResultsSummary(results);

    const outputPath = resolve(process.cwd(), config.output);
    let format = config.outputFormat;
    if (config.output.endsWith('.csv')) format = 'csv';
    else if (config.output.endsWith('.json')) format = 'json';
    else if (config.output.endsWith('.jsonl')) format = 'jsonl';

    const content = format === 'json'
      ? generateJsonReport(evalConfig, results, trace.id)
      : format === 'csv'
        ? exportResultsToCsv(results)
        : generateMarkdownReport(evalConfig, results, trace.id);
    writeFileSync(outputPath, content, 'utf8');
    if (config.markdownOutput) {
      writeFileSync(resolve(process.cwd(), config.markdownOutput), generateMarkdownReport(evalConfig, results, trace.id), 'utf8');
    }
    
    console.log('\n✅ Multi-turn test complete');
    const multiTurnCostLimitError = costLimitMessage(results, config.maxCostUsd);
    process.exit((results.some(r => r.pass === false || !r.success) || Boolean(multiTurnCostLimitError)) && !config.allowFailures ? 1 : 0);
  }

  // Run eval
  const startTime = Date.now();
  const { results, traceId, costLimitError } = await runEval(evalConfig, config);
  const totalTime = Date.now() - startTime;

  // Print summary
  printResultsSummary(results);
  console.log(`  ⏱️  Total Time: ${formatDuration(totalTime)}`);

  // Compare with previous run if requested
  if (config.compare) {
    console.log(`\n📊 Comparing with trace: ${config.compare}`);
    try {
      const { regressions, improvements } = compareTraces(config.compare, traceId);
      
      if (regressions.length > 0) {
        console.log('\n  ❌ REGRESSIONS:');
        for (const r of regressions) {
          console.log(`     - ${r.testCase} (${r.model}): ${r.was} → ${r.now}`);
        }
      }
      
      if (improvements.length > 0) {
        console.log('\n  ✅ IMPROVEMENTS:');
        for (const i of improvements) {
          console.log(`     - ${i.testCase} (${i.model}): ${i.was} → ${i.now}`);
        }
      }
      
      if (regressions.length === 0 && improvements.length === 0) {
        console.log('  No changes detected.');
      }
    } catch (error) {
      console.error(`  ⚠️  Failed to compare: ${error.message}`);
    }
  }

  // Save results in requested format
  const outputPath = resolve(process.cwd(), config.output);
  
  try {
    let content;
    let format = config.outputFormat;
    
    // Auto-detect format from extension if not specified
    if (config.output.endsWith('.csv')) format = 'csv';
    else if (config.output.endsWith('.json')) format = 'json';
    
    switch (format) {
      case 'csv':
        content = exportResultsToCsv(results);
        break;
      case 'json':
        content = generateJsonReport(evalConfig, results, traceId);
        break;
      case 'jsonl':
        content = generateJsonlReport(evalConfig, results, traceId);
        break;
      default:
        content = generateMarkdownReport(evalConfig, results, traceId);
    }
    
    writeFileSync(outputPath, content, 'utf8');
    console.log(`\n📝 Results saved to: ${outputPath} (${format})\n`);

    if (config.markdownOutput) {
      const markdownPath = resolve(process.cwd(), config.markdownOutput);
      writeFileSync(markdownPath, generateMarkdownReport(evalConfig, results, traceId), 'utf8');
      console.log(`📝 Markdown report saved to: ${markdownPath}\n`);
    }
  } catch (error) {
    console.error(`\n⚠️  Failed to save results: ${error.message}\n`);
  }

  // Exit with error code if any failures
  const hasFailures = results.some(r => r.pass === false || !r.success) || Boolean(costLimitError);
  process.exit(hasFailures && !config.allowFailures ? 1 : 0);
}

function shouldSuppressLoadLog(config) {
  return config.dryRun && (config.outputFormat === 'json' || config.outputFormat === 'jsonl');
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  if (parseBoolean(process.env.DEBUG) === true) {
    console.error(error.stack);
  }
  process.exit(1);
});
