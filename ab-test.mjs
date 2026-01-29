/**
 * A/B Testing
 * 
 * Compare prompt variants systematically
 */

import { getProvider, getDefaultProvider } from './providers/index.mjs';
import { evaluate } from './evaluators/index.mjs';
import { createTrace, addTraceResult, saveTrace } from './tracer.mjs';

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
  
  for (const testCase of testCases) {
    for (const modelConfig of models || [{ model: provider.defaultModel }]) {
      const model = modelConfig.model;
      
      // Run Variant A
      const resultA = await runVariant(
        testCase,
        variantA,
        provider,
        model,
        options
      );
      results.variantA.results.push(resultA);
      
      // Run Variant B
      const resultB = await runVariant(
        testCase,
        variantB,
        provider,
        model,
        options
      );
      results.variantB.results.push(resultB);
      
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
    const response = await provider.complete(messages, {
      model,
      temperature: variant.temperature ?? options.temperature ?? 0.7,
      max_tokens: variant.max_tokens ?? testCase.max_tokens ?? 512,
    });
    
    // Evaluate response
    const evalResult = await evaluate(testCase, response.text, options);
    
    return {
      testCase: testCase.name,
      model,
      prompt,
      response: response.text,
      pass: evalResult.pass,
      score: evalResult.score || 0,
      reason: evalResult.reason,
      latencyMs: Date.now() - startTime,
      cost: response.cost,
    };
  } catch (error) {
    return {
      testCase: testCase.name,
      model,
      prompt,
      response: null,
      pass: false,
      score: 0,
      reason: `Error: ${error.message}`,
      latencyMs: Date.now() - startTime,
      cost: null,
    };
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
  const avgScore = results.reduce((s, r) => s + (r.score || 0), 0) / total;
  const avgLatency = results.reduce((s, r) => s + (r.latencyMs || 0), 0) / total;
  const totalCost = results.reduce((s, r) => s + (r.cost || 0), 0);
  
  return {
    total,
    passed,
    passRate: passed / total,
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
      name: 'Simple Question',
      prompt: 'What is the capital of France?',
      expected_contains: ['Paris'],
    },
    {
      name: 'Math Problem',
      prompt: 'What is 15% of 80?',
      expected_contains: ['12'],
    },
  ],
  models: [
    { model: 'qwen3:8b' },
  ],
};
