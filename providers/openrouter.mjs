/**
 * OpenRouter Provider
 * Access many LLMs through a single API
 * https://openrouter.ai
 */

import { BaseProvider } from './base.mjs';

// Pricing per 1M tokens (input/output).
// OpenAI-family entries are aligned to OpenAI's standard-tier pricing page.
// OpenRouter-specific routing and markup can differ by provider/model.
// Sources:
// - https://developers.openai.com/api/docs/pricing
// - https://openrouter.ai/docs/api-reference/models/get-models
const MODEL_PRICING = {
  'openai/gpt-5.4': { input: 2.5, output: 15 },
  'openai/gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'openai/gpt-5.4-nano': { input: 0.2, output: 1.25 },
  'openai/gpt-5.4-pro': { input: 30, output: 180 },
  'openai/gpt-5.2': { input: 1.75, output: 14 },
  'openai/gpt-5.2-pro': { input: 21, output: 168 },
  'openai/gpt-5.1': { input: 1.25, output: 10 },
  'openai/gpt-5': { input: 1.25, output: 10 },
  'openai/gpt-5-pro': { input: 15, output: 120 },
  'openai/gpt-5-mini': { input: 0.25, output: 2 },
  'openai/gpt-5-nano': { input: 0.05, output: 0.4 },
  'openai/gpt-4.1': { input: 2, output: 8 },
  'openai/gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'openai/gpt-4o': { input: 2.5, output: 10 },
  'openai/gpt-4o-2024-05-13': { input: 5, output: 15 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/o1-pro': { input: 150, output: 600 },
  'openai/o3-pro': { input: 20, output: 80 },
  'openai/o3': { input: 2, output: 8 },
  'openai/o4-mini': { input: 1.1, output: 4.4 },
  'anthropic/claude-sonnet-4': { input: 3, output: 15 },
  'anthropic/claude-opus-4': { input: 15, output: 75 },
  'anthropic/claude-3.7-sonnet': { input: 3, output: 15 },
  'anthropic/claude-3.5-sonnet': { input: 3, output: 15 },
  'anthropic/claude-3.5-haiku': { input: 0.8, output: 4 },
  'google/gemini-2.5-pro': { input: 1.25, output: 10 },
  'google/gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'google/gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'google/gemini-pro-1.5': { input: 1.25, output: 5 },
  'google/gemini-flash-1.5': { input: 0.075, output: 0.3 },
  'meta-llama/llama-3.1-70b-instruct': { input: 0.52, output: 0.75 },
  'meta-llama/llama-3.1-8b-instruct': { input: 0.055, output: 0.055 },
  'mistralai/mixtral-8x7b-instruct': { input: 0.24, output: 0.24 },
};

export class OpenRouterProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'openrouter';
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.defaultModel = config.defaultModel || 'openai/gpt-5.4-mini';
  }

  async complete(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const normalizedMessages = this.normalizeMessages(messages);
    const model = options.model || this.defaultModel;
    const startTime = Date.now();

    const response = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://github.com/itseffi/ai-product-evals',
        'X-Title': 'AI Product Evals',
      },
      body: JSON.stringify({
        model,
        messages: normalizedMessages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens || options.maxTokens || 2048,
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    const usage = data.usage || {};
    const cost = this.calculateCost(usage, model);

    return {
      text: data.choices?.[0]?.message?.content || '',
      usage: {
        prompt_tokens: usage.prompt_tokens || 0,
        completion_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
      },
      latencyMs,
      model,
      provider: this.name,
      cost,
    };
  }

  async getModels() {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/models`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await response.json();
      return (data.data || []).map(m => ({
        id: m.id,
        name: m.name || m.id,
        contextLength: m.context_length,
        pricing: m.pricing,
      }));
    } catch (error) {
      console.warn(`OpenRouter getModels failed: ${error.message}`);
      return Object.keys(MODEL_PRICING).map(id => ({ id, name: id }));
    }
  }

  async isAvailable() {
    return !!this.apiKey;
  }

  calculateCost(usage, model) {
    const pricing = MODEL_PRICING[model];
    if (!pricing || !usage) return null;

    const inputCost = (usage.prompt_tokens || 0) * (pricing.input / 1_000_000);
    const outputCost = (usage.completion_tokens || 0) * (pricing.output / 1_000_000);
    return inputCost + outputCost;
  }
}
