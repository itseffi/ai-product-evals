/**
 * Anthropic Provider
 * https://anthropic.com
 */

import { BaseProvider } from './base.mjs';

// Pricing per 1M tokens (input/output)
const MODEL_PRICING = {
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-opus-20240229': { input: 15, output: 75 },
  'claude-3-sonnet-20240229': { input: 3, output: 15 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

export class AnthropicProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'anthropic';
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.baseUrl = 'https://api.anthropic.com/v1';
    this.defaultModel = config.defaultModel || 'claude-3-5-sonnet-20241022';
  }

  async complete(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const normalizedMessages = this.normalizeMessages(messages);
    const model = options.model || this.defaultModel;
    const startTime = Date.now();

    // Extract system message if present
    let systemMessage = '';
    const userMessages = [];
    for (const msg of normalizedMessages) {
      if (msg.role === 'system') {
        systemMessage = msg.content;
      } else {
        userMessages.push(msg);
      }
    }

    const requestBody = {
      model,
      messages: userMessages,
      max_tokens: options.max_tokens || options.maxTokens || 2048,
      temperature: options.temperature ?? 0.7,
    };

    if (systemMessage) {
      requestBody.system = systemMessage;
    }

    const response = await this.fetchWithTimeout(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    const usage = data.usage || {};
    const cost = this.calculateCost(usage, model);

    // Anthropic returns content as an array
    const text = data.content
      ?.filter(c => c.type === 'text')
      .map(c => c.text)
      .join('') || '';

    return {
      text,
      usage: {
        prompt_tokens: usage.input_tokens || 0,
        completion_tokens: usage.output_tokens || 0,
        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      },
      latencyMs,
      model,
      provider: this.name,
      cost,
    };
  }

  async streamComplete(messages, options = {}, onChunk = () => {}) {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const normalizedMessages = this.normalizeMessages(messages);
    const model = options.model || this.defaultModel;
    const startTime = Date.now();

    let systemMessage = '';
    const userMessages = [];
    for (const msg of normalizedMessages) {
      if (msg.role === 'system') {
        systemMessage = msg.content;
      } else {
        userMessages.push(msg);
      }
    }

    const requestBody = {
      model,
      messages: userMessages,
      max_tokens: options.max_tokens || options.maxTokens || 2048,
      temperature: options.temperature ?? 0.7,
      stream: true,
    };

    if (systemMessage) {
      requestBody.system = systemMessage;
    }

    const response = await this.fetchWithTimeout(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic error: ${response.status} - ${error}`);
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
        if (!data) continue;

        try {
          const parsed = JSON.parse(data);
          
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
            onChunk(parsed.delta.text);
          }
          
          if (parsed.type === 'message_delta' && parsed.usage) {
            usage.completion_tokens = parsed.usage.output_tokens || 0;
          }
          
          if (parsed.type === 'message_start' && parsed.message?.usage) {
            usage.prompt_tokens = parsed.message.usage.input_tokens || 0;
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;

    return {
      text: fullText,
      usage,
      latencyMs: Date.now() - startTime,
      model,
      provider: this.name,
      cost: this.calculateCost({ input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens }, model),
    };
  }

  async getModels() {
    // Anthropic doesn't have a models endpoint, return known models
    return Object.keys(MODEL_PRICING).map(id => ({
      id,
      name: id,
    }));
  }

  async isAvailable() {
    return !!this.apiKey;
  }

  calculateCost(usage, model) {
    const pricing = MODEL_PRICING[model];
    if (!pricing || !usage) return null;

    const inputCost = (usage.input_tokens || 0) * (pricing.input / 1_000_000);
    const outputCost = (usage.output_tokens || 0) * (pricing.output / 1_000_000);
    return inputCost + outputCost;
  }
}
