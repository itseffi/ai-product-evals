/**
 * Evaluators Module
 * 
 * Provides scoring logic to evaluate LLM outputs against expected results
 */

import { getProvider } from '../providers/index.mjs';
import { semanticSimilarityEval } from '../similarity.mjs';
import { safetyEval } from '../safety.mjs';
import { ragRetrievalEval, getRagContext } from './rag.mjs';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { Worker } from 'worker_threads';
import { parseBoolean } from '../labels/schema.mjs';
import { calculateCost } from '../costs.mjs';

const SAFE_REGEX_MAX_PATTERN_LENGTH = 512;
const SAFE_REGEX_MAX_INPUT_LENGTH = 20000;
const SAFE_REGEX_TIMEOUT_MS = 1000;
const JUDGE_TEMPLATE_NAME_PATTERN = /^[A-Za-z0-9_-]+(?:\.md)?$/;

/**
 * Strip thinking tags from model output (e.g., qwen3's <think> blocks)
 * Returns the cleaned response for evaluation
 */
function stripThinkingTags(response) {
  if (!response) return '';
  if (typeof response !== 'string') return String(response);
  
  // Remove <think>...</think> blocks (qwen3 style)
  let cleaned = response.replace(/<think>[\s\S]*?<\/think>/gi, '');
  
  // Remove <thinking>...</thinking> blocks (alternative format)
  cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  
  // Remove unclosed thinking tags (in case of truncation)
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
  cleaned = cleaned.replace(/<thinking>[\s\S]*$/gi, '');
  
  return cleaned.trim();
}

/**
 * Evaluate a response against expected criteria
 * @param {Object} testCase - Test case with evaluation criteria
 * @param {string} response - LLM response to evaluate
 * @param {Object} options - Evaluation options
 * @returns {Promise<{pass: boolean, score: number, reason: string}>}
 */
export async function evaluate(testCase, response, options = {}) {
  // Strip thinking tags before evaluation (for models like qwen3)
  const cleanedResponse = stripThinkingTags(response);
  const evalType = testCase.eval_type || detectEvalType(testCase);
  
  switch (evalType) {
    case 'exact_match':
      return exactMatch(testCase, cleanedResponse);
    case 'contains':
      return containsMatch(testCase, cleanedResponse);
    case 'regex':
      return regexMatch(testCase, cleanedResponse);
    case 'tool_call':
      return toolCallMatch(testCase, cleanedResponse, options);
    case 'json_match':
      return jsonMatch(testCase, cleanedResponse);
    case 'llm_judge':
      return llmJudge(testCase, cleanedResponse, options);
    case 'pairwise_judge':
      return pairwiseJudge(testCase, options);
    case 'semantic_similarity':
      return semanticSimilarityEval(testCase, cleanedResponse, options);
    case 'safety':
      return safetyEval(testCase, cleanedResponse);
    case 'unauthorized_action':
      return unauthorizedActionEval(testCase, cleanedResponse);
    case 'confidence_calibration':
      return confidenceCalibrationEval(testCase, cleanedResponse);
    case 'personalization_response':
    case 'response_surface':
      return personalizationResponseEval(testCase, cleanedResponse);
    case 'personalization_context':
    case 'context_surface':
      return personalizationContextEval(testCase);
    case 'rag_retrieval':
      return ragRetrievalEval(testCase);
    case 'rag_context_relevance':
    case 'rag_cq':
      return llmJudge({ ...testCase, judge_template: testCase.judge_template || 'rag-context-relevance' }, cleanedResponse, options);
    case 'rag_faithfulness':
    case 'rag_ac':
      return llmJudge({ ...testCase, judge_template: testCase.judge_template || 'rag-faithfulness' }, cleanedResponse, options);
    case 'rag_answer_relevance':
    case 'rag_aq':
      return llmJudge({ ...testCase, judge_template: testCase.judge_template || 'rag-answer-relevance' }, cleanedResponse, options);
    case 'rag_context_support':
    case 'rag_ca':
      return llmJudge({ ...testCase, judge_template: testCase.judge_template || 'rag-context-support' }, cleanedResponse, options);
    case 'rag_answerability':
    case 'rag_qc':
      return llmJudge({ ...testCase, judge_template: testCase.judge_template || 'rag-answerability' }, cleanedResponse, options);
    case 'rag_self_containment':
    case 'rag_qa':
      return llmJudge({ ...testCase, judge_template: testCase.judge_template || 'rag-self-containment' }, cleanedResponse, options);
    case 'custom':
      return customEval(testCase, cleanedResponse);
    default:
      // If no eval type and no expected, just check response exists
      if (!testCase.expected && !testCase.criteria) {
        return {
          pass: Boolean(cleanedResponse && cleanedResponse.length > 0),
          score: cleanedResponse && cleanedResponse.length > 0 ? 1 : 0,
          reason: cleanedResponse ? 'Response received' : 'No response (or only thinking tags)',
          evalType: 'existence'
        };
      }
      // Default to LLM judge if criteria provided
      if (testCase.criteria) {
        return llmJudge(testCase, cleanedResponse, options);
      }
      return exactMatch(testCase, cleanedResponse);
  }
}

/**
 * Detect evaluation type from test case structure
 */
function detectEvalType(testCase) {
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

/**
 * Exact string match (case-insensitive, trimmed)
 */
function exactMatch(testCase, response) {
  const expected = (testCase.expected || '').toString().trim().toLowerCase();
  const actual = (response || '').toString().trim().toLowerCase();
  const pass = actual === expected;
  
  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass 
      ? 'Exact match' 
      : `Expected "${testCase.expected}", got "${response?.substring(0, 100)}..."`,
    evalType: 'exact_match'
  };
}

/**
 * Check if response contains expected substring(s)
 */
function containsMatch(testCase, response) {
  const expected = testCase.expected_contains || testCase.expected;
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const responseLower = (response || '').toLowerCase();
  
  const matches = expectedList.filter(e => 
    responseLower.includes(e.toString().toLowerCase())
  );
  
  const pass = matches.length === expectedList.length;
  const score = expectedList.length > 0 ? matches.length / expectedList.length : 0;
  
  return {
    pass,
    score,
    reason: pass 
      ? `Contains all expected: ${matches.join(', ')}`
      : `Missing: ${expectedList.filter(e => !matches.includes(e)).join(', ')}`,
    evalType: 'contains'
  };
}

function unauthorizedActionEval(testCase, response) {
  const patterns = [
    ...(asList(testCase.unauthorized_patterns)),
    ...(asList(testCase.forbidden_actions)),
  ];
  const responseText = String(response || '');
  const hits = patterns.filter(pattern => textMatches(responseText, pattern));
  const pass = hits.length === 0;

  return {
    pass,
    score: pass ? 1 : 0,
    reason: pass
      ? 'No unauthorized action patterns found'
      : `Unauthorized action pattern(s) found: ${hits.join(', ')}`,
    evalType: 'unauthorized_action',
    metadata: { unauthorized_action: !pass },
  };
}

function confidenceCalibrationEval(testCase, response) {
  const confidence = extractConfidence(response);
  if (confidence === null) {
    return {
      pass: false,
      score: 0,
      reason: 'No confidence value found in response',
      evalType: 'confidence_calibration',
      parseError: true,
    };
  }

  const expectedConfidence = testCase.expected_confidence !== undefined
    ? Number(testCase.expected_confidence)
    : (testCase.expected_pass ?? testCase.expectedPass ?? testCase.human_pass) ? 1 : 0;
  const tolerance = Number(testCase.confidence_tolerance ?? 0.2);
  const error = Math.abs(confidence - expectedConfidence);
  const score = Math.max(0, 1 - error);

  return {
    pass: error <= tolerance,
    score,
    reason: `Confidence ${confidence.toFixed(2)} vs expected ${expectedConfidence.toFixed(2)} (error ${error.toFixed(2)})`,
    evalType: 'confidence_calibration',
    metrics: { confidence, expectedConfidence, error, tolerance },
  };
}

function extractConfidence(response) {
  const text = String(response || '');
  for (const candidate of extractJsonObjects(text)) {
    try {
      const parsed = JSON.parse(candidate);
      const value = parsed.confidence ?? parsed.score ?? parsed.probability;
      const number = Number(value);
      if (Number.isFinite(number)) return normalizeConfidence(number);
    } catch {
      // Try regex fallback below.
    }
  }
  const match = text.match(/confidence\s*[:=]\s*([0-9]+(?:\.[0-9]+)?%?)/i);
  if (!match) return null;
  const raw = match[1].endsWith('%') ? Number(match[1].slice(0, -1)) / 100 : Number(match[1]);
  return Number.isFinite(raw) ? normalizeConfidence(raw) : null;
}

function normalizeConfidence(value) {
  return value > 1 ? Math.max(0, Math.min(1, value / 100)) : Math.max(0, Math.min(1, value));
}

function personalizationResponseEval(testCase, response) {
  const surface = testCase.response_surface || {};
  const responseText = String(response || '');
  const checks = [
    metricCheck('coverage', asList(surface.coverage || testCase.required_response_facts), item => textMatches(responseText, item)),
    metricCheck('precision', asList(surface.precision_forbidden || surface.forbidden || testCase.forbidden_response_facts), item => !textMatches(responseText, item)),
    metricCheck('salience', asList(surface.salience || testCase.salient_response_facts), item => textMatches(responseText, item)),
    metricCheck('integration', asList(surface.integration || testCase.integration_requirements), item => textMatches(responseText, item)),
    metricCheck('filtering', asList(surface.filtering || surface.irrelevant || testCase.irrelevant_response_facts), item => !textMatches(responseText, item)),
  ].filter(check => check.total > 0);

  return scoredSurfaceResult('personalization_response', checks);
}

function personalizationContextEval(testCase) {
  const surface = testCase.context_surface || {};
  const contextText = contextToText(testCase.contexts || testCase.context || testCase.retrieved_contexts || []);
  const checks = [
    metricCheck('context_completeness', asList(surface.completeness || testCase.required_context_facts), item => textMatches(contextText, item)),
    metricCheck('context_relevance', asList(surface.irrelevant || testCase.irrelevant_context_facts), item => !textMatches(contextText, item)),
    metricCheck('context_consistency', asList(surface.contradictions || testCase.contradictory_context_facts), item => !textMatches(contextText, item)),
    metricCheck('context_freshness', asList(surface.stale || testCase.stale_context_patterns), item => !textMatches(contextText, item)),
    metricCheck('context_counterfactual', asList(surface.counterfactual || testCase.counterfactual_context_facts), item => textMatches(contextText, item)),
  ].filter(check => check.total > 0);

  return scoredSurfaceResult('personalization_context', checks);
}

function scoredSurfaceResult(evalType, checks) {
  if (checks.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: `No ${evalType} checks configured`,
      evalType,
      parseError: true,
    };
  }

  const total = checks.reduce((sum, check) => sum + check.total, 0);
  const passed = checks.reduce((sum, check) => sum + check.passed, 0);
  const score = total > 0 ? passed / total : 0;
  const failed = checks.filter(check => check.failed.length > 0);

  return {
    pass: failed.length === 0,
    score,
    reason: failed.length === 0
      ? `${evalType} checks passed`
      : failed.map(check => `${check.name}: ${check.failed.join(', ')}`).join('; '),
    evalType,
    metrics: Object.fromEntries(checks.map(check => [check.name, {
      passed: check.passed,
      total: check.total,
      score: check.total > 0 ? check.passed / check.total : 0,
      failed: check.failed,
    }])),
  };
}

function metricCheck(name, items, predicate) {
  const failed = [];
  let passed = 0;
  for (const item of items) {
    if (predicate(item)) passed++;
    else failed.push(String(item));
  }
  return { name, passed, total: items.length, failed };
}

function contextToText(context) {
  if (Array.isArray(context)) {
    return context.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n');
  }
  if (typeof context === 'object' && context !== null) return JSON.stringify(context);
  return String(context || '');
}

function asList(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value.filter(item => item !== undefined && item !== null && item !== '') : [value];
}

function textMatches(text, pattern) {
  if (pattern instanceof RegExp) return pattern.test(text);
  const patternText = String(pattern || '');
  if (patternText.startsWith('/') && patternText.lastIndexOf('/') > 0) {
    const lastSlash = patternText.lastIndexOf('/');
    try {
      return new RegExp(patternText.slice(1, lastSlash), patternText.slice(lastSlash + 1)).test(text);
    } catch {
      return false;
    }
  }
  return text.toLowerCase().includes(patternText.toLowerCase());
}

/**
 * Regex pattern match
 */
async function regexMatch(testCase, response) {
  const pattern = testCase.expected_regex || testCase.expected;
  const flags = testCase.regex_flags || 'i';
  
  try {
    const patternText = String(pattern || '');
    const responseText = String(response || '');
    if (patternText.length > SAFE_REGEX_MAX_PATTERN_LENGTH) {
      return {
        pass: false,
        score: 0,
        reason: `Regex pattern too long: ${patternText.length} chars`,
        evalType: 'regex',
        parseError: true,
      };
    }
    if (responseText.length > SAFE_REGEX_MAX_INPUT_LENGTH) {
      return {
        pass: false,
        score: 0,
        reason: `Regex input too long: ${responseText.length} chars`,
        evalType: 'regex',
        parseError: true,
      };
    }
    if (hasNestedQuantifierRisk(patternText)) {
      return {
        pass: false,
        score: 0,
        reason: 'Regex pattern rejected: nested quantifier risk',
        evalType: 'regex',
        parseError: true,
      };
    }
    const pass = await runRegexWithTimeout(patternText, flags, responseText, SAFE_REGEX_TIMEOUT_MS);
    
    return {
      pass,
      score: pass ? 1 : 0,
      reason: pass 
        ? `Matches pattern: ${pattern}`
        : `Does not match pattern: ${pattern}`,
      evalType: 'regex'
    };
  } catch (error) {
    return {
      pass: false,
      score: 0,
      reason: `Invalid regex: ${error.message}`,
      evalType: 'regex'
    };
  }
}

function hasNestedQuantifierRisk(pattern) {
  return /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(pattern);
}

function runRegexWithTimeout(pattern, flags, response, timeoutMs) {
  return new Promise((resolveResult, rejectResult) => {
    const worker = new Worker(`
      import { parentPort, workerData } from 'node:worker_threads';
      try {
        const regex = new RegExp(workerData.pattern, workerData.flags);
        parentPort.postMessage({ pass: regex.test(workerData.response) });
      } catch (error) {
        parentPort.postMessage({ error: error.message });
      }
    `, {
      eval: true,
      type: 'module',
      workerData: { pattern, flags, response },
    });
    const timeout = setTimeout(async () => {
      await worker.terminate();
      rejectResult(new Error('Regex evaluation timed out'));
    }, timeoutMs);
    worker.once('message', async message => {
      clearTimeout(timeout);
      await worker.terminate();
      if (message.error) rejectResult(new Error(message.error));
      else resolveResult(Boolean(message.pass));
    });
    worker.once('error', async error => {
      clearTimeout(timeout);
      await worker.terminate();
      rejectResult(error);
    });
  });
}

/**
 * Tool call evaluation - checks if model selected correct tool with correct args
 */
function toolCallMatch(testCase, response, options = {}) {
  const expectedTool = testCase.expected_tool;
  const expectedArgs = testCase.expected_args || [];
  const nativeToolCalls = normalizeToolCalls(options.toolCalls || testCase.tool_calls || testCase.toolCalls || []);

  if (nativeToolCalls.length > 0) {
    const bestCall = nativeToolCalls.find(call => call.name.toLowerCase() === expectedTool.toLowerCase()) || nativeToolCalls[0];
    const toolMatch = bestCall.name.toLowerCase() === expectedTool.toLowerCase();
    const argsMatch = expectedArgsMatch(expectedArgs, bestCall.args);
    const pass = toolMatch && argsMatch;

    return {
      pass,
      score: (toolMatch ? 0.5 : 0) + (argsMatch ? 0.5 : 0),
      reason: pass
        ? `Correct native tool call: ${bestCall.name}`
        : `Native tool call mismatch: expected ${expectedTool}${formatExpectedArgs(expectedArgs)}, got ${bestCall.name}${formatArgs(bestCall.args)}`,
      evalType: 'tool_call',
      parsed: { tool: bestCall.name, args: bestCall.args, source: 'native' },
    };
  }

  if (testCase.require_native_tool_call) {
    if (String(expectedTool).toLowerCase() === 'none') {
      return {
        pass: true,
        score: 1,
        reason: 'Correctly made no native tool call',
        evalType: 'tool_call',
        parsed: { tool: 'none', args: [], source: 'native' },
      };
    }

    return {
      pass: false,
      score: 0,
      reason: 'No native tool calls found',
      evalType: 'tool_call',
      parsed: { tool: null, args: [], source: 'native' },
    };
  }

  let parsedTool = null;
  let parsedArgs = [];
  let parsedSource = 'text';
  const jsonToolCall = parseJsonToolCall(response);
  if (jsonToolCall) {
    parsedTool = jsonToolCall.name.toLowerCase();
    parsedArgs = jsonToolCall.args;
    parsedSource = 'json';
  }

  // Legacy fallback for prompt-only suites that ask the model to print TOOL: name(args).
  const toolCallPatterns = [
    /TOOL:\s*(\w+)\s*\(([^)]*)\)/i,
    /tool[_\s]?call:\s*(\w+)\s*\(([^)]*)\)/i,
  ];

  if (!parsedTool) {
    for (const pattern of toolCallPatterns) {
      const match = (response || '').match(pattern);
      if (match) {
        parsedTool = match[1].toLowerCase();
        parsedArgs = match[2]
          .split(',')
          .map(a => a.trim().replace(/["']/g, ''))
          .filter(a => a);
        break;
      }
    }
  }
  
  // Check for "none" or refusal
  if (!parsedTool) {
    if (/TOOL:\s*none/i.test(response) || /no tool/i.test(response)) {
      parsedTool = 'none';
    }
  }
  
  const toolMatch = parsedTool === expectedTool.toLowerCase();
  const argsMatch = expectedArgsMatch(expectedArgs, parsedArgs);
  
  const pass = toolMatch && argsMatch;
  const score = (toolMatch ? 0.5 : 0) + (argsMatch ? 0.5 : 0);
  
  let reason;
  if (pass) {
    reason = `Correct tool: ${parsedTool}${formatArgs(parsedArgs)}`;
  } else if (!parsedTool) {
    reason = `Could not parse tool call from response`;
  } else if (!toolMatch) {
    reason = `Wrong tool: expected ${expectedTool}, got ${parsedTool}`;
  } else {
    reason = `Wrong args: expected ${expectedArgs.join(', ')}, got ${formatArgs(parsedArgs)}`;
  }
  
  return {
    pass,
    score,
    reason,
    evalType: 'tool_call',
      parsed: { tool: parsedTool, args: parsedArgs, source: parsedSource }
  };
}

function normalizeToolCalls(toolCalls) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [toolCalls];
  return calls
    .filter(Boolean)
    .map(call => {
      const fn = call.function || call;
      const name = call.name || fn.name || call.tool || call.type || '';
      let args = call.args ?? call.arguments ?? fn.arguments ?? call.input ?? {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = args.split(',').map(arg => arg.trim()).filter(Boolean);
        }
      }
      return { name: String(name), args };
    })
    .filter(call => call.name);
}

function parseJsonToolCall(response) {
  for (const candidate of extractJsonObjects(String(response || ''))) {
    try {
      const parsed = JSON.parse(candidate);
      const tool = parsed.tool || parsed.name || parsed.function?.name;
      const args = parsed.args ?? parsed.arguments ?? parsed.input ?? parsed.function?.arguments ?? [];
      if (tool) return { name: String(tool), args };
    } catch {
      // Ignore non-JSON prose snippets.
    }
  }
  return null;
}

function extractJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function expectedArgsMatch(expectedArgs, actualArgs) {
  if (!expectedArgs || expectedArgs.length === 0) return true;
  const actualText = Array.isArray(actualArgs)
    ? actualArgs.join(' ')
    : typeof actualArgs === 'object' && actualArgs !== null
      ? JSON.stringify(actualArgs)
      : String(actualArgs || '');

  return expectedArgs.every(arg =>
    actualText.toLowerCase().includes(arg.toString().toLowerCase())
  );
}

function formatExpectedArgs(expectedArgs) {
  return expectedArgs?.length ? `(${expectedArgs.join(', ')})` : '';
}

function formatArgs(args) {
  if (args === null || args === undefined) return '()';
  if (Array.isArray(args)) return `(${args.join(', ')})`;
  if (typeof args === 'object') return `(${JSON.stringify(args)})`;
  return `(${String(args)})`;
}

/**
 * JSON structure matching
 */
function jsonMatch(testCase, response) {
  const expectedJson = testCase.expected_json;

  let actualJson;
  let expected;
  try {
    // Try to extract JSON from response
    const jsonMatch = (response || '').match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) {
      return {
        pass: false,
        score: 0,
        reason: 'No JSON found in response',
        evalType: 'json_match'
      };
    }

    actualJson = JSON.parse(jsonMatch[0]);
  } catch (error) {
    return {
      pass: false,
      score: 0,
      reason: `Response JSON parse error: ${error.message}`,
      evalType: 'json_match'
    };
  }

  try {
    expected = typeof expectedJson === 'string'
      ? JSON.parse(expectedJson)
      : expectedJson;
  } catch (error) {
    return {
      pass: false,
      score: 0,
      reason: `Expected JSON parse error: ${error.message}`,
      evalType: 'json_match',
      parseError: true,
    };
  }

  // Check required keys
  const requiredKeys = Object.keys(expected);
  const matchedKeys = requiredKeys.filter(key => {
    if (expected[key] === '*') return key in actualJson; // Wildcard - just check existence
    return JSON.stringify(actualJson[key]) === JSON.stringify(expected[key]);
  });

  const pass = matchedKeys.length === requiredKeys.length;
  const score = requiredKeys.length > 0 ? matchedKeys.length / requiredKeys.length : 1;

  return {
    pass,
    score,
    reason: pass
      ? 'JSON structure matches'
      : `Missing/wrong keys: ${requiredKeys.filter(k => !matchedKeys.includes(k)).join(', ')}`,
    evalType: 'json_match'
  };
}

/**
 * LLM-as-judge evaluation
 * Uses a model to grade the response against criteria
 */
async function llmJudge(testCase, response, options = {}) {
  let promptMetadata = {};
  try {
    const criteria = testCase.criteria || ['relevance', 'accuracy'];
    const criteriaList = Array.isArray(criteria) ? criteria : [criteria];
    const judgePrompt = buildJudgePrompt(testCase, response, criteriaList);
    promptMetadata = getJudgePromptMetadata(testCase, judgePrompt);

    if (Array.isArray(options.judgePanel) && options.judgePanel.length > 0) {
      return withJudgeMetadata(await llmJudgePanel(judgePrompt, options), promptMetadata);
    }
    const judgeProvider = options.judgeProvider || await getDefaultJudgeProvider();
    const judgeModel = options.judgeModel || judgeProvider.defaultModel;
    return withJudgeMetadata(await runSingleLlmJudge(judgeProvider, judgeModel, judgePrompt, options), promptMetadata);
  } catch (error) {
    return withJudgeMetadata({
      pass: null,
      score: null,
      reason: `LLM judge error: ${error.message}`,
      evalType: 'llm_judge',
      evalError: true,
    }, promptMetadata);
  }
}

async function llmJudgePanel(judgePrompt, options = {}) {
  const panelResults = [];
  for (const member of options.judgePanel) {
    try {
      const provider = member.provider || getProvider(member.providerName);
      const model = member.model || provider.defaultModel;
      const result = await runSingleLlmJudge(provider, model, judgePrompt, options);
      panelResults.push({
        provider: provider.name,
        model,
        ...result,
      });
    } catch (error) {
      panelResults.push({
        provider: member.providerName || member.provider?.name || 'unknown',
        model: member.model || member.provider?.defaultModel || 'unknown',
        pass: null,
        score: null,
        reason: `LLM judge error: ${error.message}`,
        evalType: 'llm_judge',
        evalError: true,
      });
    }
  }

  const decisive = panelResults.filter(result => result.pass === true || result.pass === false);
  const trueVotes = decisive.filter(result => result.pass === true).length;
  const falseVotes = decisive.filter(result => result.pass === false).length;
  const pass = trueVotes > falseVotes
    ? true
    : falseVotes > trueVotes
      ? false
      : null;

  if (pass === null) {
    return {
      pass: null,
      score: null,
      reason: decisive.length === 0 ? 'All judge panel members failed' : 'Judge panel tied',
      evalType: 'llm_judge',
      parseError: decisive.length > 0,
      evalError: decisive.length === 0,
      panelResults,
      ...panelAccounting(panelResults),
    };
  }

  const avgScore = decisive.reduce((sum, result) => sum + (result.score || 0), 0) / decisive.length;
  const reasons = decisive
    .filter(result => result.pass === pass)
    .map(result => `${result.provider}/${result.model}: ${result.reason}`)
    .slice(0, 3);

  return {
    pass,
    score: avgScore,
    reason: `Judge panel majority ${pass ? 'PASS' : 'FAIL'} (${trueVotes}-${falseVotes}). ${reasons.join(' | ')}`,
    evalType: 'llm_judge',
    panelResults,
    ...panelAccounting(panelResults),
  };
}

async function runSingleLlmJudge(judgeProvider, judgeModel, judgePrompt, options = {}) {
    enforceJudgeCallBudget(options, 'llm_judge', judgeProvider, judgeModel, judgePrompt, 200);
    // Pass as messages array (not string) for proper API compatibility
    const messages = [
      { role: 'user', content: judgePrompt }
    ];
    
    const result = await judgeProvider.complete(messages, {
      model: judgeModel,
      temperature: 0.1,
      max_tokens: 200,
      timeoutMs: options.timeoutMs,
    });
    enforceJudgeActualCost(options, 'llm_judge', judgeProvider, judgeModel, result);
    
    // Strip thinking tags from judge response too
    const judgeResponse = stripThinkingTags(result.text);
    
    // Parse judge response
    const scoreMatch = judgeResponse.match(/SCORE:\s*(\d+)/i);
    const passMatch = judgeResponse.match(/PASS:\s*(YES|NO)/i);
    const reasonMatch = judgeResponse.match(/REASON:\s*(.+?)(?:\n|$)/is);

    if (!scoreMatch || !passMatch || !reasonMatch) {
      return {
        pass: null,
        score: null,
        reason: `Unparseable judge response: ${judgeResponse.substring(0, 200) || '(empty)'}`,
        evalType: 'llm_judge',
        judgeResponse: judgeResponse.substring(0, 1000),
        ...judgeAccounting(result),
        parseError: true,
      };
    }

    const rawScore = parseInt(scoreMatch[1], 10);
    if (rawScore < 0 || rawScore > 100) {
      return {
        pass: null,
        score: null,
        reason: `Invalid judge score: ${rawScore}`,
        evalType: 'llm_judge',
        judgeResponse: judgeResponse.substring(0, 1000),
        ...judgeAccounting(result),
        parseError: true,
      };
    }

    const reason = reasonMatch[1].trim();
    if (isWeakJudgeReason(reason)) {
      return {
        pass: null,
        score: null,
        reason: `Weak judge reason: ${reason || '(empty)'}`,
        evalType: 'llm_judge',
        judgeResponse: judgeResponse.substring(0, 1000),
        ...judgeAccounting(result),
        parseError: true,
      };
    }

    const score = rawScore / 100;
    const pass = passMatch[1].toUpperCase() === 'YES';
    
    return {
      pass,
      score,
      reason,
      evalType: 'llm_judge',
      judgeResponse: judgeResponse.substring(0, 500),
      ...judgeAccounting(result),
    };
}

async function pairwiseJudge(testCase, options = {}) {
  let promptMetadata = {};
  try {
    const responseA = testCase.response_a ?? testCase.responseA ?? testCase.candidate_a ?? testCase.candidateA ?? '';
    const responseB = testCase.response_b ?? testCase.responseB ?? testCase.candidate_b ?? testCase.candidateB ?? '';
    const expectedWinner = normalizeWinner(testCase.expected_winner ?? testCase.expectedWinner);
    const order = testCase.order || 'AB';
    const shownA = order === 'BA' ? responseB : responseA;
    const shownB = order === 'BA' ? responseA : responseB;
    const template = loadJudgeTemplate(testCase.judge_template || 'pairwise-comparison');
    const prompt = template
      ? renderTemplate(template, {
          prompt: testCase.prompt || testCase.question || '',
          question: testCase.question || testCase.prompt || '',
          response_a: shownA,
          response_b: shownB,
          criteria: Array.isArray(testCase.criteria) ? testCase.criteria.join(', ') : testCase.criteria || 'overall quality',
          reference: testCase.reference_answer || testCase.reference || testCase.expected || '',
        })
      : buildPairwisePrompt(testCase, shownA, shownB);
    promptMetadata = getJudgePromptMetadata(
      { ...testCase, judge_template: testCase.judge_template || 'pairwise-comparison' },
      prompt
    );

    if (Array.isArray(options.judgePanel) && options.judgePanel.length > 0) {
      return withJudgeMetadata(await pairwiseJudgePanel(prompt, { ...options, expectedWinner, order }), promptMetadata);
    }
    const judgeProvider = options.judgeProvider || await getDefaultJudgeProvider();
    const judgeModel = options.judgeModel || process.env.JUDGE_MODEL || judgeProvider.defaultModel;
    return withJudgeMetadata(await runSinglePairwiseJudge(judgeProvider, judgeModel, prompt, { ...options, expectedWinner, order }), promptMetadata);
  } catch (error) {
    return withJudgeMetadata({
      pass: null,
      score: null,
      reason: `Pairwise judge error: ${error.message}`,
      evalType: 'pairwise_judge',
      evalError: true,
    }, promptMetadata);
  }
}

async function pairwiseJudgePanel(prompt, options = {}) {
  const panelResults = [];
  for (const member of options.judgePanel) {
    try {
      const provider = member.provider || getProvider(member.providerName);
      const model = member.model || provider.defaultModel;
      const result = await runSinglePairwiseJudge(provider, model, prompt, options);
      panelResults.push({
        provider: provider.name,
        model,
        ...result,
      });
    } catch (error) {
      panelResults.push({
        provider: member.providerName || member.provider?.name || 'unknown',
        model: member.model || member.provider?.defaultModel || 'unknown',
        pass: null,
        score: null,
        winner: null,
        reason: `Pairwise judge error: ${error.message}`,
        evalType: 'pairwise_judge',
        evalError: true,
      });
    }
  }

  const decisive = panelResults.filter(result => result.winner);
  const voteCounts = decisive.reduce((counts, result) => {
    counts[result.winner] = (counts[result.winner] || 0) + 1;
    return counts;
  }, {});
  const orderedVotes = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
  const winner = orderedVotes.length > 0 && orderedVotes[0][1] > (orderedVotes[1]?.[1] || 0)
    ? orderedVotes[0][0]
    : null;

  if (!winner) {
    return {
      pass: null,
      score: null,
      reason: decisive.length === 0 ? 'All pairwise judge panel members failed' : 'Pairwise judge panel tied',
      evalType: 'pairwise_judge',
      parseError: decisive.length > 0,
      evalError: decisive.length === 0,
      winner: null,
      expectedWinner: options.expectedWinner,
      order: options.order,
      panelResults,
      ...panelAccounting(panelResults),
    };
  }

  const pass = options.expectedWinner
    ? winner === options.expectedWinner
    : winner !== 'TIE';
  const reasons = decisive
    .filter(result => result.winner === winner)
    .map(result => `${result.provider}/${result.model}: ${result.reason}`)
    .slice(0, 3);

  return {
    pass,
    score: pass ? 1 : 0,
    reason: `Pairwise judge panel chose ${winner} (${Object.entries(voteCounts).map(([key, value]) => `${key}:${value}`).join(', ')}). ${reasons.join(' | ')}`,
    evalType: 'pairwise_judge',
    winner,
    expectedWinner: options.expectedWinner,
    order: options.order,
    panelResults,
    ...panelAccounting(panelResults),
  };
}

async function runSinglePairwiseJudge(judgeProvider, judgeModel, prompt, options = {}) {
  enforceJudgeCallBudget(options, 'pairwise_judge', judgeProvider, judgeModel, prompt, 200);
  const result = await judgeProvider.complete([
    { role: 'user', content: prompt }
  ], {
    model: judgeModel,
    temperature: 0,
    max_tokens: 200,
    timeoutMs: options.timeoutMs,
  });
  enforceJudgeActualCost(options, 'pairwise_judge', judgeProvider, judgeModel, result);

  const judgeResponse = result.text || '';
  const winnerMatch = judgeResponse.match(/WINNER:\s*(A|B|TIE)/i);
  const reasonMatch = judgeResponse.match(/REASON:\s*(.+)/is);

  if (!winnerMatch) {
    return {
      pass: null,
      score: null,
      reason: 'Pairwise judge response missing WINNER field',
      evalType: 'pairwise_judge',
      parseError: true,
      judgeResponse,
      ...judgeAccounting(result),
    };
  }

  const shownWinner = winnerMatch[1].toUpperCase();
  const canonicalWinner = options.order === 'BA'
    ? shownWinner === 'A'
      ? 'B'
      : shownWinner === 'B'
        ? 'A'
        : 'TIE'
    : shownWinner;
  const reason = reasonMatch?.[1]?.trim() || 'Pairwise judge evaluation';
  const pass = options.expectedWinner
    ? canonicalWinner === options.expectedWinner
    : canonicalWinner !== 'TIE';

  return {
    pass,
    score: pass ? 1 : 0,
    reason,
    evalType: 'pairwise_judge',
    winner: canonicalWinner,
    shownWinner,
    expectedWinner: options.expectedWinner,
    order: options.order,
    judgeResponse: judgeResponse.substring(0, 500),
    ...judgeAccounting(result),
  };
}

function judgeAccounting(result = {}) {
  const cost = result.cost ?? null;
  const usage = result.usage || null;
  return {
    cost,
    judgeCost: cost,
    judgeUsage: usage,
    judgeLatencyMs: result.latencyMs || 0,
    judgeCostUnknown: Boolean(usage && cost === null),
  };
}

function enforceJudgeCallBudget(options, kind, provider, model, prompt, maxTokens) {
  options.callBudget?.consume(kind, {
    provider: provider.name,
    model,
  });
  if (options.maxCallCostUsd === null || options.maxCallCostUsd === undefined) return;
  if (provider.name === 'ollama' || provider.name === 'static') return;

  const usage = {
    prompt_tokens: Math.ceil(String(prompt || '').length / 4),
    completion_tokens: maxTokens || 0,
  };
  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;

  const estimatedCost = typeof provider.calculateCost === 'function'
    ? provider.calculateCost(usage, model)
    : calculateCost(model, usage);
  if (estimatedCost === null || estimatedCost === undefined) {
    throw new Error(`${kind} call cost is unknown for ${provider.name}/${model}; --max-call-cost requires known pricing`);
  }
  if (estimatedCost > options.maxCallCostUsd) {
    throw new Error(`${kind} call estimated cost $${estimatedCost.toFixed(4)} exceeds --max-call-cost $${options.maxCallCostUsd.toFixed(4)}`);
  }
}

function enforceJudgeActualCost(options, kind, provider, model, result = {}) {
  if (options.maxCallCostUsd === null || options.maxCallCostUsd === undefined) return;
  if (provider.name === 'ollama' || provider.name === 'static') return;
  if (result.usage && result.cost == null) {
    throw new Error(`${kind} call actual cost is unknown for ${provider.name}/${model}; --max-call-cost requires known pricing`);
  }
  if (typeof result.cost === 'number' && result.cost > options.maxCallCostUsd) {
    throw new Error(`${kind} call actual cost $${result.cost.toFixed(4)} exceeds --max-call-cost $${options.maxCallCostUsd.toFixed(4)}`);
  }
}

function panelAccounting(results = []) {
  const knownCosts = results
    .map(result => result.judgeCost ?? result.cost)
    .filter(cost => typeof cost === 'number');
  const cost = knownCosts.length > 0
    ? knownCosts.reduce((sum, value) => sum + value, 0)
    : null;
  return {
    cost,
    judgeCost: cost,
    judgeUsage: results.map(result => result.judgeUsage || result.usage).filter(Boolean),
    judgeLatencyMs: results.reduce((sum, result) => sum + (result.judgeLatencyMs || result.latencyMs || 0), 0),
    judgeCostUnknown: results.some(result => result.judgeCostUnknown || ((result.judgeUsage || result.usage) && (result.judgeCost ?? result.cost) === null)),
  };
}

function normalizeWinner(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  if (['A', 'B', 'TIE'].includes(normalized)) return normalized;
  return null;
}

function buildPairwisePrompt(testCase, responseA, responseB) {
  return `You are judging two responses to the same user prompt.

User prompt:
${testCase.prompt || testCase.question || ''}

Response A:
${responseA}

Response B:
${responseB}

Criteria:
${Array.isArray(testCase.criteria) ? testCase.criteria.join(', ') : testCase.criteria || 'overall quality'}

${testCase.reference_answer || testCase.reference ? `Reference answer:
${testCase.reference_answer || testCase.reference}` : ''}

Return exactly:
WINNER: [A, B, or TIE]
REASON: [one sentence]`;
}

function isWeakJudgeReason(reason) {
  const normalized = String(reason || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === 'llm judge evaluation') return true;
  if (/^llm judge (evaluation|result|reasoning)$/i.test(normalized)) return true;
  if (/^(the )?(response|answer|output) (is|looks|seems) (good|bad|correct|incorrect|valid|invalid|acceptable|unacceptable)\.?$/i.test(normalized)) return true;
  if (['good', 'bad', 'ok', 'yes', 'no', 'pass', 'fail'].includes(normalized)) return true;
  const words = normalized.split(/\s+/).filter(Boolean);
  const hasSentencePunctuation = /[.!?]$/.test(normalized);
  const citesCriterion = /\b(criteria|criterion|because|since|supported|unsupported|grounded|relevant|irrelevant|accurate|inaccurate|matches|contradicts|omits|hallucinat)/i.test(normalized);
  return normalized.length < 40 || words.length < 8 || !hasSentencePunctuation || !citesCriterion;
}

function buildJudgePrompt(testCase, response, criteriaList) {
  const template = loadJudgeTemplate(testCase.judge_template);
  const context = getRagContext(testCase);
  const expected = testCase.expected || testCase.reference_answer || testCase.reference || testCase.gold || '';
  const critique = testCase.metadata?.critique || testCase.critique || '';

  if (template) {
    return renderTemplate(template, {
      prompt: testCase.prompt || testCase.question || '',
      question: testCase.question || testCase.prompt || '',
      response,
      answer: response,
      context,
      expected,
      criteria: criteriaList.join(', '),
      critique,
    });
  }

  return `You are an evaluation judge. Grade the following response based on these criteria: ${criteriaList.join(', ')}.

QUESTION/PROMPT:
${testCase.prompt}

RESPONSE TO EVALUATE:
${response}

Instructions:
1. Evaluate the response against each criterion
2. Give a score from 0-100
3. Provide brief reasoning

Respond in this exact format:
SCORE: [number 0-100]
PASS: [YES or NO]
REASON: [one sentence explanation]`;
}

function loadJudgeTemplate(name) {
  if (!name) return null;
  if (!JUDGE_TEMPLATE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid judge template name: ${name}`);
  }
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  const path = resolve(process.cwd(), 'judges', filename);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function getJudgeTemplateMetadata(name) {
  if (!name) return {};
  const template = loadJudgeTemplate(name);
  return {
    judgeTemplate: name,
    judgeTemplateHash: template ? hashString(template) : null,
  };
}

function getJudgePromptMetadata(testCase, judgePrompt) {
  const templateName = testCase.judge_template || testCase.metadata?.judge_template || null;
  return {
    ...getJudgeTemplateMetadata(templateName),
    judgePromptHash: hashString(judgePrompt),
  };
}

function withJudgeMetadata(result, metadata) {
  return {
    ...result,
    ...metadata,
  };
}

function hashString(value) {
  return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function renderTemplate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
}

/**
 * Get default judge provider
 */
async function getDefaultJudgeProvider() {
  try {
    const { getProvider, getAvailableProviders } = await import('../providers/index.mjs');
    const providerName = process.env.JUDGE_PROVIDER || process.env.DEFAULT_PROVIDER;
    if (!providerName) {
      const available = await getAvailableProviders();
      for (const name of ['openai', 'anthropic', 'google', 'openrouter']) {
        const match = available.find(provider => provider.name === name && provider.available);
        if (match) return match.provider;
      }
      const local = available.find(provider => provider.name === 'ollama' && provider.available);
      if (local && parseBoolean(process.env.ALLOW_LOCAL_JUDGE) === true) return local.provider;
      throw new Error('no remote judge provider available; set JUDGE_PROVIDER or ALLOW_LOCAL_JUDGE=true for Ollama');
    }
    if (providerName === 'ollama' && parseBoolean(process.env.ALLOW_LOCAL_JUDGE) !== true) {
      throw new Error('local Ollama judge requires ALLOW_LOCAL_JUDGE=true');
    }
    const provider = getProvider(providerName);
    return provider;
  } catch (error) {
    throw new Error(`No judge provider available: ${error.message}`);
  }
}

/**
 * Custom evaluation function (user-defined)
 */
function customEval(testCase, response) {
  // Placeholder for custom evaluation logic
  // Users can extend this
  return {
    pass: true,
    score: 1,
    reason: 'Custom evaluation not implemented',
    evalType: 'custom'
  };
}

export { exactMatch, containsMatch, regexMatch, toolCallMatch, jsonMatch, llmJudge };
