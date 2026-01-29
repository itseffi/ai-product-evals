/**
 * Multi-Turn Conversation Testing
 * 
 * Test dialogue flows and conversation coherence
 */

import { getProvider } from './providers/index.mjs';
import { evaluate } from './evaluators/index.mjs';

/**
 * Run a multi-turn conversation test
 */
export async function runConversation(testCase, provider, options = {}) {
  const turns = testCase.turns || testCase.conversation || [];
  const results = [];
  const messages = [];
  
  // Add system prompt if provided
  if (testCase.system_prompt) {
    messages.push({ role: 'system', content: testCase.system_prompt });
  }
  
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const startTime = Date.now();
    
    // Add user message
    messages.push({ role: 'user', content: turn.user || turn.prompt || turn.input });
    
    try {
      // Get model response
      const response = await provider.complete(messages, {
        model: options.model,
        temperature: options.temperature ?? 0.7,
        max_tokens: turn.max_tokens || options.max_tokens || 512,
      });
      
      // Add assistant response to history
      messages.push({ role: 'assistant', content: response.text });
      
      // Evaluate this turn if criteria provided
      let evalResult = { pass: null, score: null, reason: 'No evaluation', evalType: 'none' };
      
      if (turn.expected || turn.expected_contains || turn.criteria) {
        evalResult = await evaluate(turn, response.text, options);
      }
      
      results.push({
        turn: i + 1,
        user: turn.user || turn.prompt,
        assistant: response.text,
        pass: evalResult.pass,
        score: evalResult.score,
        reason: evalResult.reason,
        evalType: evalResult.evalType,
        latencyMs: Date.now() - startTime,
        usage: response.usage,
      });
      
    } catch (error) {
      results.push({
        turn: i + 1,
        user: turn.user || turn.prompt,
        assistant: null,
        pass: false,
        score: 0,
        reason: `Error: ${error.message}`,
        evalType: 'error',
        latencyMs: Date.now() - startTime,
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
    
    overallEval = await evaluate(
      { ...testCase, criteria: testCase.overall_criteria, prompt: fullConversation },
      fullConversation,
      options
    );
  }
  
  return {
    testCase: testCase.name,
    turns: results,
    overallPass: overallEval?.pass ?? results.every(r => r.pass !== false),
    overallScore: overallEval?.score ?? (results.reduce((s, r) => s + (r.score || 0), 0) / results.length),
    overallReason: overallEval?.reason ?? 'Aggregated from turns',
    messages, // Full conversation history
  };
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
