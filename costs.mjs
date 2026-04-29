/**
 * Cost Tracking
 * 
 * Accurate per-provider pricing for LLM API calls
 * Prices as of Apr 2026 (update as needed)
 */

// Pricing per 1M tokens. `input`/`cachedInput`/`output` are Standard short-context rates.
// `longContext` contains Standard long-context rates when published.
export const PRICING = {
  // OpenAI
  'gpt-5.5': {
    input: 5.00,
    cachedInput: 0.50,
    output: 30.00,
    longContext: { input: 10.00, cachedInput: 1.00, output: 45.00 },
  },
  'gpt-5.5-pro': {
    input: 30.00,
    cachedInput: null,
    output: 180.00,
    longContext: { input: 60.00, cachedInput: null, output: 270.00 },
  },
  'gpt-5.4': {
    input: 2.50,
    cachedInput: 0.25,
    output: 15.00,
    longContext: { input: 5.00, cachedInput: 0.50, output: 22.50 },
  },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.50 },
  'gpt-5.4-nano': { input: 0.20, cachedInput: 0.02, output: 1.25 },
  'gpt-5.3-codex': { input: 1.75, output: 14.00 },
  'gpt-5.2': { input: 1.75, output: 14.00 },
  'gpt-5': { input: 1.25, output: 10.00 },
  'gpt-5-mini': { input: 0.25, output: 2.00 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'o1': { input: 15.00, output: 60.00 },
  'o1-mini': { input: 3.00, output: 12.00 },
  
  // Anthropic
  'claude-opus-4-7': { input: 5.00, output: 25.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
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
  
  const pricing = getPricing(model);
  
  if (!pricing) {
    return null; // Unknown model
  }
  
  const rate = selectPricingRate(pricing, usage);
  const totalInputTokens = usage.prompt_tokens || usage.input_tokens || 0;
  const cachedInputTokens = getCachedInputTokens(usage);
  const billableInputTokens = Math.max(0, totalInputTokens - cachedInputTokens);
  const outputTokens = usage.completion_tokens || usage.output_tokens || 0;
  
  const inputCost = (billableInputTokens / 1_000_000) * rate.input;
  const cachedInputRate = rate.cachedInput === null || rate.cachedInput === undefined
    ? rate.input
    : rate.cachedInput;
  const cachedInputCost = (cachedInputTokens / 1_000_000) * cachedInputRate;
  const outputCost = (outputTokens / 1_000_000) * rate.output;
  
  return inputCost + cachedInputCost + outputCost;
}

export function selectPricingRate(pricing, usage = {}) {
  if (usesLongContext(usage) && pricing.longContext) return pricing.longContext;
  const tier = String(usage.service_tier || usage.serviceTier || usage.processing_tier || usage.processingTier || '').toLowerCase();
  return tier === 'priority' && pricing.priority ? pricing.priority : pricing;
}

function usesLongContext(usage = {}) {
  if (usage.long_context || usage.longContext || usage.context_type === 'long' || usage.contextType === 'long') return true;
  const explicitContextLength = Number(usage.context_length ?? usage.contextLength ?? 0);
  if (explicitContextLength > 270_000) return true;
  const inputTokens = Number(usage.prompt_tokens || usage.input_tokens || 0);
  return inputTokens > 270_000;
}

export function getCachedInputTokens(usage = {}) {
  return usage.cached_input_tokens
    || usage.cachedInputTokens
    || usage.prompt_tokens_details?.cached_tokens
    || usage.input_tokens_details?.cached_tokens
    || 0;
}

/**
 * Get pricing info for a model
 */
export function getPricing(model) {
  if (!model) return null;
  const modelName = String(model);
  return PRICING[modelName]
    || PRICING[modelName.split(':')[0]]
    || PRICING[stripDateVersion(modelName)]
    || null;
}

export function hasKnownPricing(model) {
  return Boolean(getPricing(model));
}

function stripDateVersion(model) {
  return model
    .replace(/-\d{4}-\d{2}-\d{2}$/, '')
    .replace(/-\d{4}$/, '');
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
        const rate = selectPricingRate(pricing, model);
        estimate += (promptTokens / 1_000_000) * rate.input;
        estimate += (maxOutputTokens / 1_000_000) * rate.output;
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
