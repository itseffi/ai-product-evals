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
import { readFileSync, writeFileSync, existsSync } from 'fs';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2', 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '1000', 10);
const PARALLEL_LIMIT = parseInt(process.env.PARALLEL_LIMIT || '3', 10);
const USE_CACHE = process.env.USE_CACHE !== 'false';

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    evalFile: null,
    provider: null,
    output: 'eval-results.md',
    outputFormat: 'md', // md, csv, json
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
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--provider' || arg === '-p') {
      config.provider = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      config.output = args[++i];
    } else if (arg === '--format' || arg === '-f') {
      config.outputFormat = args[++i];
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
  --output, -o <file>     Output file for results (default: eval-results.md)
  --format, -f <type>     Output format: md, csv, json (default: md)
  --verbose, -v           Enable verbose logging
  --skip-judge            Skip LLM-as-judge evaluation (faster, no scoring)
  --list-providers, -l    List available providers and exit
  --history, -H           Show eval run history
  --compare, -c <id>      Compare current run against a previous trace ID
  --parallel, -P          Run test cases in parallel (faster)
  --no-cache              Disable response caching
  --clear-cache           Clear response cache and exit
  --ab-test, -A           Run as A/B test (config file should have variantA/variantB)
  --multi-turn, -M        Run as multi-turn conversation test
  --help, -h              Show this help message

Examples:
  node run-eval.mjs                                    # Run default eval
  node run-eval.mjs evals/llm-comparison.json          # Run specific eval
  node run-eval.mjs dataset.csv                        # Run from CSV dataset
  node run-eval.mjs --provider openai                  # Override provider
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    if (result.error?.includes('API key') || result.error?.includes('not configured')) {
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
  
  try {
    // Build messages
    const messages = [];
    
    if (testCase.system_prompt) {
      messages.push({ role: 'system', content: testCase.system_prompt });
    }
    
    messages.push({ role: 'user', content: testCase.prompt });

    const completionOptions = {
      model,
      temperature: testCase.temperature ?? modelConfig.temperature ?? 0.7,
      max_tokens: testCase.max_tokens ?? modelConfig.max_tokens ?? 2048,
    };

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

    // Evaluate the response
    let evalResult = { pass: null, score: null, reason: 'Evaluation skipped', evalType: 'none' };
    
    if (!options.skipJudge) {
      evalResult = await evaluate(testCase, result.text, {
        judgeProvider: options.judgeProvider,
        judgeModel: options.judgeModel,
      });
    }

    return {
      success: true,
      testCase: testCase.name,
      model,
      provider: provider.name,
      text: result.text,
      usage: result.usage,
      latencyMs: result.latencyMs,
      cost: result.cost,
      error: null,
      pass: evalResult.pass,
      score: evalResult.score,
      evalReason: evalResult.reason,
      evalType: evalResult.evalType,
      fromCache,
      // For tracing
      prompt: testCase.prompt,
      systemPrompt: testCase.system_prompt,
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
    };
  }
}

async function runEval(evalConfig, cliConfig) {
  const results = [];
  const testCases = evalConfig.test_cases || [];
  const models = evalConfig.models || [];
  
  // Create trace for this run
  const trace = createTrace(evalConfig);
  
  // Get judge provider for LLM-as-judge evaluations
  let judgeProvider = null;
  let judgeModel = process.env.JUDGE_MODEL || 'qwen3:8b';
  
  if (!cliConfig.skipJudge) {
    try {
      judgeProvider = getProvider(process.env.JUDGE_PROVIDER || 'ollama');
    } catch {
      console.warn('   ⚠️  No judge provider available, skipping LLM-based scoring');
    }
  }

  console.log(`\n📋 Running eval: ${evalConfig.name}`);
  console.log(`   ${evalConfig.description || ''}`);
  console.log(`   Test cases: ${testCases.length}`);
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
      const batch = runs.slice(i, i + PARALLEL_LIMIT);
      
      const batchResults = await Promise.all(
        batch.map(async ({ testCase, modelConfig }) => {
          let provider;
          if (cliConfig.provider) {
            provider = getProvider(cliConfig.provider);
          } else if (modelConfig.provider) {
            provider = getProvider(modelConfig.provider);
          } else {
            provider = await getDefaultProvider();
          }

          return runTestCaseWithRetry(testCase, modelConfig, provider, {
            skipJudge: cliConfig.skipJudge,
            judgeProvider,
            judgeModel,
            verbose: cliConfig.verbose,
            noCache: cliConfig.noCache,
          });
        })
      );
      
      for (const result of batchResults) {
        results.push(result);
        addTraceResult(trace, result);
        
        const passIcon = result.pass === null ? '⚪' : (result.pass ? '✅' : '❌');
        const scoreStr = result.score !== null ? ` ${formatScore(result.score)}` : '';
        const cacheStr = result.fromCache ? ' (cached)' : '';
        console.log(`   ${passIcon} ${result.testCase} | ${result.provider}/${result.model}${scoreStr}${cacheStr}`);
      }
    }
  } else {
    // Sequential execution
    for (const testCase of testCases) {
      console.log(`\n🧪 Test: ${testCase.name}`);
      
      if (testCase.expected || testCase.expected_tool || testCase.expected_contains) {
        const expected = testCase.expected || testCase.expected_tool || testCase.expected_contains;
        console.log(`   Expected: ${truncateText(JSON.stringify(expected), 50)}`);
      }

      for (const modelConfig of models) {
        let provider;
        if (cliConfig.provider) {
          provider = getProvider(cliConfig.provider);
        } else if (modelConfig.provider) {
          provider = getProvider(modelConfig.provider);
        } else {
          provider = await getDefaultProvider();
        }

        const model = modelConfig.model;
        process.stdout.write(`   ⏳ ${provider.name}/${model}... `);

        const result = await runTestCaseWithRetry(testCase, modelConfig, provider, {
          skipJudge: cliConfig.skipJudge,
          judgeProvider,
          judgeModel,
          verbose: cliConfig.verbose,
          noCache: cliConfig.noCache,
        });
        
        results.push(result);
        addTraceResult(trace, result);

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
      }
    }
  }

  // Save trace
  const summary = {
    passed: results.filter(r => r.pass === true).length,
    failed: results.filter(r => r.pass === false).length,
    errors: results.filter(r => !r.success).length,
    total: results.length,
  };
  const tracePath = saveTrace(trace, summary);
  console.log(`\n📊 Trace saved: ${tracePath}`);

  return { results, traceId: trace.id };
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
  lines.push('');

  return lines.join('\n');
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
      console.log(`\n📄 Loaded dataset: ${evalPath} (${evalConfig.test_cases.length} test cases)`);
      
      // If no models specified, use default
      if (!evalConfig.models || evalConfig.models.length === 0) {
        const defaultProvider = await getDefaultProvider();
        evalConfig.models = [{ provider: defaultProvider.name, model: defaultProvider.defaultModel }];
        console.log(`   Using default model: ${defaultProvider.name}/${defaultProvider.defaultModel}`);
      }
    } else {
      // Standard JSON config
      const content = readFileSync(evalPath, 'utf8');
      evalConfig = JSON.parse(content);
      console.log(`\n📄 Loaded: ${evalPath}`);
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

  // Check providers
  console.log('\n🔌 Checking providers...');
  const providers = await getAvailableProviders();
  const available = providers.filter(p => p.available);
  
  if (available.length === 0) {
    console.error('\n❌ No providers available!');
    console.error('   Configure at least one provider in .env file');
    console.error('   See .env.example for configuration options\n');
    process.exit(1);
  }

  console.log(`   Available: ${available.map(p => p.name).join(', ')}`);

  // A/B Test mode
  if (config.abTest) {
    console.log('\n🧪 Running A/B Test...');
    const provider = config.provider ? await getProvider(config.provider) : await getDefaultProvider();
    const abResults = await runABTest(evalConfig, { provider });
    const report = generateABReport(abResults);
    
    console.log('\n' + report);
    
    if (config.output) {
      writeFileSync(config.output, report, 'utf8');
      console.log(`\n📝 A/B Test report saved to: ${config.output}`);
    }
    process.exit(0);
  }

  // Multi-turn mode
  if (config.multiTurn) {
    console.log('\n💬 Running Multi-Turn Conversation Test...');
    const provider = config.provider ? await getProvider(config.provider) : await getDefaultProvider();
    
    // Process each test case as a conversation
    const testCases = evalConfig.test_cases || evalConfig.conversations || [evalConfig];
    let allResults = [];
    
    for (const testCase of testCases) {
      console.log(`\n  Testing: ${testCase.name || 'Conversation'}`);
      const convResult = await runConversation(testCase, provider, {
        model: evalConfig.models?.[0]?.model,
        verbose: config.verbose,
      });
      allResults.push({ testCase: testCase.name, results: convResult });
      
      // Print turn results
      convResult.forEach(turn => {
        const icon = turn.pass === true ? '✅' : turn.pass === false ? '❌' : '⏭️';
        console.log(`    Turn ${turn.turn}: ${icon} ${turn.reason || ''}`);
      });
    }
    
    console.log('\n✅ Multi-turn test complete');
    process.exit(0);
  }

  // Run eval
  const startTime = Date.now();
  const { results, traceId } = await runEval(evalConfig, config);
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
        content = JSON.stringify({
          evalName: evalConfig.name,
          traceId,
          timestamp: new Date().toISOString(),
          summary: {
            passed: results.filter(r => r.pass === true).length,
            failed: results.filter(r => r.pass === false).length,
            total: results.length,
          },
          results,
        }, null, 2);
        break;
      default:
        content = generateMarkdownReport(evalConfig, results, traceId);
    }
    
    writeFileSync(outputPath, content, 'utf8');
    console.log(`\n📝 Results saved to: ${outputPath} (${format})\n`);
  } catch (error) {
    console.error(`\n⚠️  Failed to save results: ${error.message}\n`);
  }

  // Exit with error code if any failures
  const hasFailures = results.some(r => r.pass === false || !r.success);
  process.exit(hasFailures ? 1 : 0);
}

main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});
