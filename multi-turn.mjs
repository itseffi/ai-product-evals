/**
 * Multi-Turn Conversation Testing
 * 
 * Test dialogue flows and conversation coherence
 */

import { getProvider } from './providers/index.mjs';
import { evaluate } from './evaluators/index.mjs';
import { calculateCost } from './costs.mjs';

/**
 * Run a multi-turn conversation test
 */
export async function runConversation(testCase, provider, options = {}) {
  const turns = testCase.turns || testCase.conversation || [];
  const results = [];
  const messages = [];
  const environment = {
    state: cloneJson(testCase.environment?.state || testCase.initial_state || {}),
    events: [],
  };
  
  // Add system prompt if provided
  if (testCase.system_prompt) {
    messages.push({ role: 'system', content: testCase.system_prompt });
  }
  
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const startTime = Date.now();
    applyEvents(environment, turn.before_events || turn.events_before);
    
    // Add user message
    const userContent = renderStateTemplate(turn.user_template || turn.user || turn.prompt || turn.input, environment.state);
    const userMessage = { role: 'user', content: userContent };
    messages.push(userMessage);
    
    try {
      if (turn.inject_failure || turn.inject_error) {
        const injected = turn.inject_failure || turn.inject_error;
        throw new Error(`Injected environment failure: ${typeof injected === 'string' ? injected : injected.message || 'failure'}`);
      }

      // Get model response
      options.callBudget?.consume('completion', {
        provider: provider.name,
        model: options.model,
        testCase: testCase.name,
        turn: i + 1,
      });
      enforceCallCostBefore(provider, options.model, messages, turn.max_tokens || options.max_tokens || 512, options.maxCallCostUsd);
      const response = await provider.complete(messages, {
        model: options.model,
        temperature: options.temperature ?? 0.7,
        max_tokens: turn.max_tokens || options.max_tokens || 512,
      });
      enforceCallCostAfter(provider, options.model, response, options.maxCallCostUsd);
      
      // Add assistant response to history
      messages.push({ role: 'assistant', content: response.text });
      applyEvents(environment, turn.after_events || turn.events_after);
      
      // Evaluate this turn if criteria provided
      let evalResult = { pass: null, score: null, reason: 'No evaluation', evalType: 'none' };
      
      if (turnHasEvaluation(turn)) {
        if (turnRequiresJudge(turn) && !options.judgeProvider && !options.judgePanel?.length) {
          evalResult = { pass: false, score: 0, reason: 'No judge provider available', evalType: 'llm_judge', evalError: true };
        } else {
          evalResult = await evaluate(turn, response.text, options);
        }
      }

      const stateEval = evaluateStateAssertions(turn, environment.state);
      if (stateEval?.pass === false) {
        evalResult = {
          pass: false,
          score: Math.min(evalResult.score ?? 1, stateEval.score),
          reason: evalResult.evalType === 'none' ? stateEval.reason : `${evalResult.reason}; ${stateEval.reason}`,
          evalType: evalResult.evalType === 'none' ? stateEval.evalType : `${evalResult.evalType}+environment`,
        };
      } else if (stateEval && evalResult.evalType === 'none') {
        evalResult = stateEval;
      } else if (stateEval) {
        evalResult = {
          ...evalResult,
          reason: `${evalResult.reason}; ${stateEval.reason}`,
          evalType: `${evalResult.evalType}+environment`,
        };
      }
      
      results.push({
        turn: i + 1,
        user: userContent,
        assistant: response.text,
        pass: evalResult.pass,
        score: evalResult.score,
        reason: evalResult.reason,
        evalType: evalResult.evalType,
        latencyMs: Date.now() - startTime,
        usage: response.usage,
        cost: response.cost,
        environment: cloneJson(environment),
      });
      
    } catch (error) {
      messages.pop();
      results.push({
        turn: i + 1,
        user: userContent,
        assistant: null,
        pass: false,
        score: 0,
        reason: `Error: ${error.message}`,
        evalType: 'error',
        latencyMs: Date.now() - startTime,
        environment: cloneJson(environment),
      });
      
      // Stop on error unless configured to continue
      if (!options.continueOnError) break;
    }
  }
  
  // Evaluate overall conversation if criteria provided
  let overallEval = null;
  if (testCase.overall_criteria) {
    const fullConversation = results
      .map(r => `User: ${r.user}\nAssistant: ${r.assistant || '[error]'}`)
      .join('\n\n');
    
    overallEval = options.judgeProvider || options.judgePanel?.length
      ? await evaluate(
          { ...testCase, criteria: testCase.overall_criteria, prompt: fullConversation },
          fullConversation,
          options
        )
      : { pass: false, score: 0, reason: 'No judge provider available', evalType: 'llm_judge', evalError: true };
  }
  
  return {
    testCase: testCase.name,
    turns: results,
    overallPass: overallEval?.pass ?? results.every(r => r.pass !== false),
    overallScore: overallEval?.score ?? (results.length > 0 ? results.reduce((s, r) => s + (r.score || 0), 0) / results.length : 0),
    overallReason: overallEval?.reason ?? 'Aggregated from turns',
    messages, // Full conversation history
    environment,
  };
}

function applyEvents(environment, events) {
  for (const event of Array.isArray(events) ? events : events ? [events] : []) {
    const op = event.op || event.type || 'set';
    const path = event.path || event.key;
    if (!path) continue;
    if (op === 'delete') {
      setPath(environment.state, path, undefined, { delete: true });
    } else if (op === 'increment') {
      const current = Number(getPath(environment.state, path) || 0);
      setPath(environment.state, path, current + Number(event.value ?? 1));
    } else if (op === 'append') {
      const current = getPath(environment.state, path);
      const next = Array.isArray(current) ? [...current, event.value] : [event.value];
      setPath(environment.state, path, next);
    } else {
      setPath(environment.state, path, event.value);
    }
    environment.events.push({ ...event, appliedAt: new Date().toISOString() });
  }
}

function evaluateStateAssertions(turn, state) {
  const assertions = [
    ...Object.entries(turn.expected_state || {}).map(([path, expected]) => ({ path, equals: expected })),
    ...(Array.isArray(turn.state_assertions) ? turn.state_assertions : []),
  ];
  if (assertions.length === 0) return null;

  const failures = [];
  for (const assertion of assertions) {
    const actual = getPath(state, assertion.path);
    if ('equals' in assertion && JSON.stringify(actual) !== JSON.stringify(assertion.equals)) {
      failures.push(`${assertion.path} expected ${JSON.stringify(assertion.equals)}, got ${JSON.stringify(actual)}`);
    }
    if ('exists' in assertion && Boolean(actual !== undefined) !== Boolean(assertion.exists)) {
      failures.push(`${assertion.path} existence expected ${assertion.exists}`);
    }
    if ('includes' in assertion && !String(actual || '').includes(String(assertion.includes))) {
      failures.push(`${assertion.path} does not include ${assertion.includes}`);
    }
  }

  return {
    pass: failures.length === 0,
    score: failures.length === 0 ? 1 : 0,
    reason: failures.length === 0 ? 'Environment assertions passed' : `Environment assertion failed: ${failures.join('; ')}`,
    evalType: 'environment_state',
  };
}

function renderStateTemplate(value, state) {
  return String(value || '').replace(/\{\{\s*state\.([^}]+?)\s*\}\}/g, (_, path) => {
    const resolved = getPath(state, path.trim());
    return resolved === undefined ? '' : String(resolved);
  });
}

function getPath(object, path) {
  return String(path || '').split('.').reduce((current, part) => current?.[part], object);
}

function setPath(object, path, value, options = {}) {
  const parts = String(path || '').split('.').filter(Boolean);
  let current = object;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = current[parts[i]] && typeof current[parts[i]] === 'object' ? current[parts[i]] : {};
    current = current[parts[i]];
  }
  if (parts.length === 0) return;
  if (options.delete) delete current[parts[parts.length - 1]];
  else current[parts[parts.length - 1]] = value;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function turnHasEvaluation(turn) {
  return Boolean(
    turn.expected
    || turn.expected_contains
    || turn.expected_regex
    || turn.expected_json
    || turn.expected_tool
    || turn.criteria
  );
}

function turnRequiresJudge(turn) {
  const evalType = turn.eval_type
    || (turn.expected_tool ? 'tool_call'
      : turn.expected_json ? 'json_match'
        : turn.expected_regex ? 'regex'
          : turn.expected_contains ? 'contains'
            : turn.expected ? 'exact_match'
              : turn.criteria ? 'llm_judge'
                : 'existence');
  return evalType === 'llm_judge' || /^rag_(?!retrieval)/.test(evalType);
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
 * Create a multi-turn test case from a conversation template
 */
export function createConversationTest(config) {
  return {
    name: config.name,
    description: config.description,
    system_prompt: config.system_prompt,
    turns: config.turns.map((turn, i) => ({
      user: turn.user || turn.prompt,
      expected: turn.expected,
      expected_contains: turn.expected_contains,
      criteria: turn.criteria,
      max_tokens: turn.max_tokens,
    })),
    overall_criteria: config.overall_criteria,
    metadata: config.metadata,
  };
}

/**
 * Example multi-turn test case
 */
export const EXAMPLE_CONVERSATION_TEST = {
  name: 'Customer Support Conversation',
  description: 'Test multi-turn customer support dialogue',
  system_prompt: 'You are a helpful customer support agent for a software company.',
  turns: [
    {
      user: 'I forgot my password',
      expected_contains: ['reset', 'password'],
      criteria: ['helpful', 'professional'],
    },
    {
      user: 'I tried that but the reset email never arrived',
      expected_contains: ['spam', 'check'],
      criteria: ['empathetic', 'solution-oriented'],
    },
    {
      user: 'Found it in spam! Thanks!',
      expected_contains: ['glad', 'welcome', 'help'],
      criteria: ['positive closing'],
    },
  ],
  overall_criteria: ['coherent conversation', 'resolved issue', 'professional tone'],
};
