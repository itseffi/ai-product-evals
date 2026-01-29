/**
 * OpenAI Provider
 * https://platform.openai.com
 */

import { BaseProvider } from './base.mjs';

// Pricing per 1M tokens (input/output)
const MODEL_PRICING = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-4': { input: 30, output: 60 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'o1': { input: 15, output: 60 },
  'o1-mini': { input: 3, output: 12 },
};

export class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'openai';
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.defaultModel = config.defaultModel || 'gpt-4o-mini';
  }

  async complete(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const normalizedMessages = this.normalizeMessages(messages);
    const model = options.model || this.defaultModel;
    const startTime = Date.now();

    const requestBody = {
      model,
      messages: normalizedMessages,
      max_tokens: options.max_tokens || options.maxTokens || 2048,
      stream: false,
    };

    // o1 models don't support temperature
    if (!model.startsWith('o1')) {
      requestBody.temperature = options.temperature ?? 0.7;
    }

    const response = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI error: ${response.status} - ${error}`);
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

  async streamComplete(messages, options = {}, onChunk = () => {}) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const normalizedMessages = this.normalizeMessages(messages);
    const model = options.model || this.defaultModel;
    const startTime = Date.now();

    const requestBody = {
      model,
      messages: normalizedMessages,
      max_tokens: options.max_tokens || options.maxTokens || 2048,
      stream: true,
    };

    if (!model.startsWith('o1')) {
      requestBody.temperature = options.temperature ?? 0.7;
    }

    const response = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI error: ${response.status} - ${error}`);
    }

    let fullText = '';
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));

      for (const line of lines) {
        const data = line.replace('data: ', '').trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            fullText += content;
            onChunk(content);
          }
          if (parsed.usage) {
            usage = parsed.usage;
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    return {
      text: fullText,
      usage,
      latencyMs: Date.now() - startTime,
      model,
      provider: this.name,
      cost: this.calculateCost(usage, model),
    };
  }

  async getModels() {
    if (!this.apiKey) return [];

    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await response.json();
      return (data.data || [])
        .filter(m => m.id.includes('gpt') || m.id.includes('o1'))
        .map(m => ({
          id: m.id,
          name: m.id,
          ownedBy: m.owned_by,
        }));
    } catch (error) {
      console.warn(`OpenAI getModels failed: ${error.message}`);
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
