/**
 * Evaluators Module
 * 
 * Provides scoring logic to evaluate LLM outputs against expected results
 */

import { getProvider } from '../providers/index.mjs';
import { semanticSimilarityEval } from '../similarity.mjs';
import { safetyEval } from '../safety.mjs';

/**
 * Strip thinking tags from model output (e.g., qwen3's <think> blocks)
 * Returns the cleaned response for evaluation
 */
function stripThinkingTags(response) {
  if (!response) return '';
  
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
      return toolCallMatch(testCase, cleanedResponse);
    case 'json_match':
      return jsonMatch(testCase, cleanedResponse);
    case 'llm_judge':
      return llmJudge(testCase, cleanedResponse, options);
    case 'semantic_similarity':
      return semanticSimilarityEval(testCase, cleanedResponse, options);
    case 'safety':
      return safetyEval(testCase, cleanedResponse);
    case 'custom':
      return customEval(testCase, cleanedResponse);
    default:
      // If no eval type and no expected, just check response exists
      if (!testCase.expected && !testCase.criteria) {
        return {
          pass: cleanedResponse && cleanedResponse.length > 0,
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

/**
 * Regex pattern match
 */
function regexMatch(testCase, response) {
  const pattern = testCase.expected_regex || testCase.expected;
  const flags = testCase.regex_flags || 'i';
  
  try {
    const regex = new RegExp(pattern, flags);
    const pass = regex.test(response || '');
    
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

/**
 * Tool call evaluation - checks if model selected correct tool with correct args
 */
function toolCallMatch(testCase, response) {
  const expectedTool = testCase.expected_tool;
  const expectedArgs = testCase.expected_args || [];
  
  // Parse tool call from response (supports formats: TOOL: name(args) or {"tool": "name", "args": []})
  const toolCallPatterns = [
    /TOOL:\s*(\w+)\s*\(([^)]*)\)/i,
    /tool[_\s]?call:\s*(\w+)\s*\(([^)]*)\)/i,
    /"tool"\s*:\s*"(\w+)".*"args"\s*:\s*\[([^\]]*)\]/is,
  ];
  
  let parsedTool = null;
  let parsedArgs = [];
  
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
  
  // Check for "none" or refusal
  if (!parsedTool) {
    if (/TOOL:\s*none/i.test(response) || /no tool/i.test(response)) {
      parsedTool = 'none';
    }
  }
  
  const toolMatch = parsedTool === expectedTool.toLowerCase();
  const argsMatch = expectedArgs.length === 0 || 
    expectedArgs.every(arg => 
      parsedArgs.some(pa => pa.toLowerCase().includes(arg.toString().toLowerCase()))
    );
  
  const pass = toolMatch && argsMatch;
  const score = (toolMatch ? 0.5 : 0) + (argsMatch ? 0.5 : 0);
  
  let reason;
  if (pass) {
    reason = `Correct tool: ${parsedTool}(${parsedArgs.join(', ')})`;
  } else if (!parsedTool) {
    reason = `Could not parse tool call from response`;
  } else if (!toolMatch) {
    reason = `Wrong tool: expected ${expectedTool}, got ${parsedTool}`;
  } else {
    reason = `Wrong args: expected ${expectedArgs.join(', ')}, got ${parsedArgs.join(', ')}`;
  }
  
  return {
    pass,
    score,
    reason,
    evalType: 'tool_call',
    parsed: { tool: parsedTool, args: parsedArgs }
  };
}

/**
 * JSON structure matching
 */
function jsonMatch(testCase, response) {
  const expectedJson = testCase.expected_json;
  
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
    
    const actualJson = JSON.parse(jsonMatch[0]);
    const expected = typeof expectedJson === 'string' 
      ? JSON.parse(expectedJson) 
      : expectedJson;
    
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
  } catch (error) {
    return {
      pass: false,
      score: 0,
      reason: `JSON parse error: ${error.message}`,
      evalType: 'json_match'
    };
  }
}

/**
 * LLM-as-judge evaluation
 * Uses a model to grade the response against criteria
 */
async function llmJudge(testCase, response, options = {}) {
  const judgeProvider = options.judgeProvider || await getDefaultJudgeProvider();
  const judgeModel = options.judgeModel || 'qwen3:8b';
  const criteria = testCase.criteria || ['relevance', 'accuracy'];
  const criteriaList = Array.isArray(criteria) ? criteria : [criteria];
  
  const judgePrompt = `You are an evaluation judge. Grade the following response based on these criteria: ${criteriaList.join(', ')}.

QUESTION/PROMPT:
${testCase.prompt}

RESPONSE TO EVALUATE:
${response}

${testCase.expected ? `EXPECTED/REFERENCE (if helpful):
${testCase.expected}` : ''}

Instructions:
1. Evaluate the response against each criterion
2. Give a score from 0-100
3. Provide brief reasoning

Respond in this exact format:
SCORE: [number 0-100]
PASS: [YES or NO]
REASON: [one sentence explanation]`;

  try {
    // Pass as messages array (not string) for proper API compatibility
    const messages = [
      { role: 'user', content: judgePrompt }
    ];
    
    const result = await judgeProvider.complete(messages, {
      model: judgeModel,
      temperature: 0.1,
      max_tokens: 200,
    });
    
    // Strip thinking tags from judge response too
    const judgeResponse = stripThinkingTags(result.text);
    
    // Parse judge response
    const scoreMatch = judgeResponse.match(/SCORE:\s*(\d+)/i);
    const passMatch = judgeResponse.match(/PASS:\s*(YES|NO)/i);
    const reasonMatch = judgeResponse.match(/REASON:\s*(.+?)(?:\n|$)/is);
    
    const score = scoreMatch ? parseInt(scoreMatch[1]) / 100 : 0.5;
    const pass = passMatch ? passMatch[1].toUpperCase() === 'YES' : score >= 0.7;
    const reason = reasonMatch ? reasonMatch[1].trim() : 'LLM judge evaluation';
    
    return {
      pass,
      score,
      reason,
      evalType: 'llm_judge',
      judgeResponse: judgeResponse.substring(0, 500)
    };
  } catch (error) {
    return {
      pass: false,
      score: 0,
      reason: `LLM judge error: ${error.message}`,
      evalType: 'llm_judge'
    };
  }
}

/**
 * Get default judge provider
 */
async function getDefaultJudgeProvider() {
  try {
    const { getProvider } = await import('../providers/index.mjs');
    const provider = getProvider(process.env.JUDGE_PROVIDER || process.env.DEFAULT_PROVIDER || 'ollama');
    return provider;
  } catch {
    throw new Error('No judge provider available');
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
