/**
 * Cost Tracking
 * 
 * Accurate per-provider pricing for LLM API calls
 * Prices as of Jan 2026 (update as needed)
 */

// Pricing per 1M tokens (input, output)
export const PRICING = {
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  
  // Anthropic
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  
  // Google
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-2.0-flash-exp': { input: 0.10, output: 0.40 },
  
  // OpenRouter (varies by model, these are common ones)
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'anthropic/claude-3.5-sonnet': { input: 3.00, output: 15.00 },
  'meta-llama/llama-3.1-70b-instruct': { input: 0.52, output: 0.75 },
  'meta-llama/llama-3.1-8b-instruct': { input: 0.055, output: 0.055 },
  'mistralai/mixtral-8x7b-instruct': { input: 0.24, output: 0.24 },
  'google/gemini-pro-1.5': { input: 1.25, output: 5.00 },
  
  // Ollama (free/local)
  'llama3.2': { input: 0, output: 0 },
  'llama3.1': { input: 0, output: 0 },
  'qwen3:8b': { input: 0, output: 0 },
  'mistral': { input: 0, output: 0 },
  'codellama': { input: 0, output: 0 },
};

/**
 * Calculate cost for a request
 */
export function calculateCost(model, usage) {
  if (!usage) return null;
  
  const pricing = PRICING[model] || PRICING[model.split(':')[0]] || null;
  
  if (!pricing) {
    return null; // Unknown model
  }
  
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;
  
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  
  return inputCost + outputCost;
}

/**
 * Get pricing info for a model
 */
export function getPricing(model) {
  return PRICING[model] || PRICING[model.split(':')[0]] || null;
}

/**
 * Format cost for display
 */
export function formatCost(cost) {
  if (cost === null || cost === undefined) return 'N/A';
  if (cost === 0) return 'Free';
  if (cost < 0.0001) return '<$0.0001';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Aggregate costs from results
 */
export function aggregateCosts(results) {
  const byProvider = {};
  const byModel = {};
  let total = 0;
  
  for (const r of results) {
    if (r.cost) {
      total += r.cost;
      
      byProvider[r.provider] = (byProvider[r.provider] || 0) + r.cost;
      
      const modelKey = `${r.provider}/${r.model}`;
      byModel[modelKey] = (byModel[modelKey] || 0) + r.cost;
    }
  }
  
  return { total, byProvider, byModel };
}

/**
 * Estimate cost for a batch of test cases
 */
export function estimateBatchCost(testCases, models) {
  let estimate = 0;
  
  for (const tc of testCases) {
    const promptTokens = estimateTokens(tc.prompt + (tc.system_prompt || ''));
    const maxOutputTokens = tc.max_tokens || 512;
    
    for (const model of models) {
      const pricing = getPricing(model.model);
      if (pricing) {
        estimate += (promptTokens / 1_000_000) * pricing.input;
        estimate += (maxOutputTokens / 1_000_000) * pricing.output;
      }
    }
  }
  
  return estimate;
}

/**
 * Rough token count estimation (4 chars per token on average)
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
