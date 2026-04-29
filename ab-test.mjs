/**
 * A/B Testing
 * 
 * Compare prompt variants systematically
 */

import { getProvider, getDefaultProvider } from './providers/index.mjs';
import { evaluate } from './evaluators/index.mjs';
import { createTrace, addTraceResult, saveTrace } from './tracer.mjs';
import { calculateCost } from './costs.mjs';

function testCaseRequiresJudge(testCase) {
  const evalType = detectedEvalType(testCase);
  if (evalType === 'llm_judge') return true;
  if (evalType === 'pairwise_judge') return true;
  if (/^rag_(?!retrieval)/.test(evalType)) return true;
  return false;
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

function isEvaluatorInfrastructureFailure(evalResult) {
  return Boolean(evalResult?.evalError || evalResult?.parseError);
}

/**
 * Run A/B test comparing two prompt variants
 */
export async function runABTest(config, options = {}) {
  const {
    name,
    description,
    variantA,
    variantB,
    testCases,
    models,
  } = config;
  
  const provider = options.provider || await getDefaultProvider();
  const results = {
    name,
    description,
    variantA: { name: variantA.name || 'Variant A', results: [] },
    variantB: { name: variantB.name || 'Variant B', results: [] },
  };
  
  console.log(`\n🧪 A/B Test: ${name}`);
  console.log(`   Comparing: "${variantA.name || 'A'}" vs "${variantB.name || 'B'}"`);
  console.log(`   Test cases: ${testCases.length}`);
  console.log('');

  const executionModels = Array.isArray(options.models) && options.models.length > 0
    ? options.models
    : Array.isArray(models) && models.length > 0
      ? models
      : [{ model: options.model || provider.defaultModel }];
  
  for (const testCase of testCases) {
    for (const modelConfig of executionModels) {
      const model = modelConfig.model;
      const runProvider = modelConfig.provider ? getProvider(modelConfig.provider) : provider;
      
      // Run Variant A
      const resultA = await runVariant(
        testCase,
        variantA,
        runProvider,
        model,
        options
      );
      results.variantA.results.push(resultA);
      const limitAfterA = costLimitMessage(results, options.maxCostUsd);
      if (limitAfterA) {
        results.costLimitError = limitAfterA;
        results.summary = calculateSummary(results);
        return results;
      }
      
      // Run Variant B
      const resultB = await runVariant(
        testCase,
        variantB,
        runProvider,
        model,
        options
      );
      results.variantB.results.push(resultB);
      const limitAfterB = costLimitMessage(results, options.maxCostUsd);
      if (limitAfterB) {
        results.costLimitError = limitAfterB;
        results.summary = calculateSummary(results);
        return results;
      }
      
      // Print comparison
      const iconA = resultA.pass ? '✅' : '❌';
      const iconB = resultB.pass ? '✅' : '❌';
      console.log(`   ${testCase.name}: A${iconA} ${(resultA.score * 100).toFixed(0)}% | B${iconB} ${(resultB.score * 100).toFixed(0)}%`);
    }
  }
  
  // Calculate summary statistics
  results.summary = calculateSummary(results);
  
  return results;
}

function costLimitMessage(results, maxCostUsd) {
  if (maxCostUsd === null || maxCostUsd === undefined) return null;
  const allResults = results.variantA.results.concat(results.variantB.results);
  const unknownCost = allResults.find(result => result.costUnknown || result.metadata?.cost_unknown);
  if (unknownCost) {
    return `A/B test has unknown billable cost for ${unknownCost.provider || 'unknown'}/${unknownCost.model}; --max-cost requires known pricing`;
  }
  const total = allResults.reduce((sum, result) => sum + (result.cost || 0), 0);
  return total > maxCostUsd ? `A/B test cost $${total.toFixed(4)} exceeded --max-cost $${maxCostUsd.toFixed(4)}` : null;
}

/**
 * Run a single variant
 */
async function runVariant(testCase, variant, provider, model, options) {
  const startTime = Date.now();
  
  // Build prompt from variant template
  const prompt = applyTemplate(variant.prompt || variant.template, testCase);
  const systemPrompt = variant.system_prompt || testCase.system_prompt;
  
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  
  try {
    const maxTokens = variant.max_tokens ?? testCase.max_tokens ?? 512;
    options.callBudget?.consume('completion', {
      provider: provider.name,
      model,
      testCase: testCase.name,
      variant: variant.name,
    });
    enforceCallCostBefore(provider, model, messages, maxTokens, options.maxCallCostUsd);
    const response = await provider.complete(messages, {
      model,
      temperature: variant.temperature ?? options.temperature ?? 0.7,
      max_tokens: maxTokens,
      tools: testCase.tools || options.tools,
      tool_choice: testCase.tool_choice || options.tool_choice,
    });
    enforceCallCostAfter(provider, model, response, options.maxCallCostUsd);
    
    // Evaluate response
    const evalResult = testCaseRequiresJudge(testCase) && !options.judgeProvider && !options.judgePanel?.length
      ? {
          pass: null,
          score: null,
          reason: 'No judge provider available',
          evalType: testCase.eval_type === 'pairwise_judge' ? 'pairwise_judge' : 'llm_judge',
          evalError: true,
        }
      : await evaluate(testCase, response.text, {
          ...options,
          toolCalls: response.toolCalls || response.tool_calls || [],
          toolResults: response.toolResults || response.tool_results || [],
        });

    const totalCost = combineCosts(response.cost, evalResult.cost ?? evalResult.judgeCost);
    const costUnknown = Boolean((response.usage && response.cost == null) || evalResult.judgeCostUnknown);

    if (isEvaluatorInfrastructureFailure(evalResult)) {
      return {
        testCase: testCase.name,
        model,
        provider: provider.name,
        prompt,
        response: response.text,
        pass: false,
        score: 0,
        reason: evalResult.reason,
        evalType: evalResult.evalType,
        success: false,
        error: evalResult.reason,
        latencyMs: Date.now() - startTime,
        cost: totalCost,
        costUnknown,
        metadata: {
          ...(evalResult.metadata || {}),
          product_cost: response.cost,
          judge_cost: evalResult.judgeCost ?? evalResult.cost,
          cost_unknown: costUnknown,
        },
      };
    }
    
    return {
      testCase: testCase.name,
      model,
      provider: provider.name,
      prompt,
      response: response.text,
      pass: evalResult.pass,
      score: evalResult.score ?? 0,
      reason: evalResult.reason,
      evalType: evalResult.evalType,
      success: true,
      latencyMs: Date.now() - startTime,
      cost: totalCost,
      costUnknown,
      metadata: {
        ...(evalResult.metadata || {}),
        product_cost: response.cost,
        judge_cost: evalResult.judgeCost ?? evalResult.cost,
        cost_unknown: costUnknown,
      },
    };
  } catch (error) {
    return {
      testCase: testCase.name,
      model,
      provider: provider.name,
      prompt,
      response: null,
      pass: false,
      score: 0,
      reason: `Error: ${error.message}`,
      evalType: 'error',
      success: false,
      error: error.message,
      latencyMs: Date.now() - startTime,
      cost: null,
    };
  }
}

function combineCosts(...costs) {
  const known = costs.filter(cost => typeof cost === 'number');
  return known.length > 0 ? known.reduce((sum, cost) => sum + cost, 0) : null;
}

function enforceCallCostBefore(provider, model, messages, maxTokens, maxCallCostUsd) {
  if (maxCallCostUsd === null || maxCallCostUsd === undefined) return;
  if (provider.name === 'ollama' || provider.name === 'static') return;
  const promptTokens = messages.reduce((sum, message) => sum + Math.ceil(String(message.content || '').length / 4), 0);
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: maxTokens || 0,
    total_tokens: promptTokens + (maxTokens || 0),
  };
  const cost = typeof provider.calculateCost === 'function'
    ? provider.calculateCost(usage, model)
    : calculateCost(model, usage);
  if (cost === null || cost === undefined) {
    throw new Error(`completion call cost is unknown for ${provider.name}/${model}; --max-call-cost requires known pricing`);
  }
  if (cost > maxCallCostUsd) {
    throw new Error(`completion call estimated cost $${cost.toFixed(4)} exceeds --max-call-cost $${maxCallCostUsd.toFixed(4)}`);
  }
}

function enforceCallCostAfter(provider, model, response, maxCallCostUsd) {
  if (maxCallCostUsd === null || maxCallCostUsd === undefined) return;
  if (provider.name === 'ollama' || provider.name === 'static') return;
  if (response.usage && response.cost == null) {
    throw new Error(`completion call actual cost is unknown for ${provider.name}/${model}; --max-call-cost requires known pricing`);
  }
  if (typeof response.cost === 'number' && response.cost > maxCallCostUsd) {
    throw new Error(`completion call actual cost $${response.cost.toFixed(4)} exceeds --max-call-cost $${maxCallCostUsd.toFixed(4)}`);
  }
}

/**
 * Apply template variables to prompt
 */
function applyTemplate(template, testCase) {
  if (!template) return testCase.prompt;
  
  return template
    .replace(/\{\{prompt\}\}/g, testCase.prompt || '')
    .replace(/\{\{input\}\}/g, testCase.input || testCase.prompt || '')
    .replace(/\{\{context\}\}/g, testCase.context || '')
    .replace(/\{\{question\}\}/g, testCase.question || testCase.prompt || '');
}

/**
 * Calculate summary statistics
 */
function calculateSummary(results) {
  const statsA = calculateStats(results.variantA.results);
  const statsB = calculateStats(results.variantB.results);
  
  // Determine winner
  let winner = null;
  let confidence = 0;
  
  if (statsA.passRate > statsB.passRate + 0.1) {
    winner = 'A';
    confidence = (statsA.passRate - statsB.passRate) * 100;
  } else if (statsB.passRate > statsA.passRate + 0.1) {
    winner = 'B';
    confidence = (statsB.passRate - statsA.passRate) * 100;
  }
  
  return {
    variantA: statsA,
    variantB: statsB,
    winner,
    confidence: confidence.toFixed(1),
    recommendation: winner 
      ? `Use Variant ${winner} (${confidence.toFixed(0)}% better)`
      : 'No significant difference',
  };
}

/**
 * Calculate statistics for a variant
 */
function calculateStats(results) {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  const errors = results.filter(r => r.success === false).length;
  const avgScore = total > 0 ? results.reduce((s, r) => s + (r.score ?? 0), 0) / total : 0;
  const avgLatency = total > 0 ? results.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / total : 0;
  const totalCost = results.reduce((s, r) => s + (r.cost || 0), 0);
  
  return {
    total,
    passed,
    errors,
    passRate: total > 0 ? passed / total : 0,
    avgScore,
    avgLatency,
    totalCost,
  };
}

/**
 * Generate A/B test report
 */
export function generateABReport(results) {
  const lines = [];
  
  lines.push(`# A/B Test Results: ${results.name}`);
  lines.push('');
  lines.push(`> ${results.description || 'No description'}`);
  lines.push('');
  
  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | ${results.variantA.name} | ${results.variantB.name} |`);
  lines.push('|--------|----------|----------|');
  lines.push(`| Pass Rate | ${(results.summary.variantA.passRate * 100).toFixed(1)}% | ${(results.summary.variantB.passRate * 100).toFixed(1)}% |`);
  lines.push(`| Evaluator Errors | ${results.summary.variantA.errors} | ${results.summary.variantB.errors} |`);
  lines.push(`| Avg Score | ${(results.summary.variantA.avgScore * 100).toFixed(1)}% | ${(results.summary.variantB.avgScore * 100).toFixed(1)}% |`);
  lines.push(`| Avg Latency | ${results.summary.variantA.avgLatency.toFixed(0)}ms | ${results.summary.variantB.avgLatency.toFixed(0)}ms |`);
  lines.push('');
  
  // Winner
  lines.push(`**Recommendation:** ${results.summary.recommendation}`);
  lines.push('');
  
  // Detailed results
  lines.push('## Detailed Results');
  lines.push('');
  
  for (let i = 0; i < results.variantA.results.length; i++) {
    const a = results.variantA.results[i];
    const b = results.variantB.results[i];
    
    lines.push(`### ${a.testCase}`);
    lines.push('');
    lines.push(`| | ${results.variantA.name} | ${results.variantB.name} |`);
    lines.push('|--|----------|----------|');
    lines.push(`| Pass | ${a.pass ? '✅' : '❌'} | ${b.pass ? '✅' : '❌'} |`);
    lines.push(`| Score | ${(a.score * 100).toFixed(0)}% | ${(b.score * 100).toFixed(0)}% |`);
    lines.push(`| Latency | ${a.latencyMs}ms | ${b.latencyMs}ms |`);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Example A/B test configuration
 */
export const EXAMPLE_AB_TEST = {
  name: 'System Prompt Comparison',
  description: 'Compare concise vs detailed system prompts',
  variantA: {
    name: 'Concise',
    system_prompt: 'You are a helpful assistant. Be brief.',
  },
  variantB: {
    name: 'Detailed', 
    system_prompt: 'You are a helpful, harmless, and honest AI assistant. Provide clear, accurate, and well-structured responses. Think step by step when solving problems.',
  },
  testCases: [
    {
      name: 'Grounded Refusal',
      prompt: 'The context is empty. Should a RAG assistant answer from prior knowledge?',
      expected_contains: ['no'],
    },
    {
      name: 'Evaluator Failure Type',
      prompt: 'Name the error type where a failing answer is incorrectly marked passing.',
      expected_contains: ['false positive'],
    },
  ],
};
