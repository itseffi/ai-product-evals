/**
 * Google Gemini Provider
 * https://ai.google.dev
 */

import { BaseProvider } from './base.mjs';

// Pricing per 1M tokens (input/output)
const MODEL_PRICING = {
  'gemini-1.5-pro': { input: 1.25, output: 5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-flash-8b': { input: 0.0375, output: 0.15 },
  'gemini-2.0-flash-exp': { input: 0, output: 0 }, // Free during preview
  'gemini-pro': { input: 0.5, output: 1.5 },
};

export class GoogleProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'google';
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.defaultModel = config.defaultModel || 'gemini-1.5-flash';
  }

  async complete(messages, options = {}) {
    if (!this.apiKey) {
      throw new Error('Google API key not configured');
    }

    const normalizedMessages = this.normalizeMessages(messages);
    const model = options.model || this.defaultModel;
    const startTime = Date.now();

    // Convert to Gemini format
    const contents = [];
    let systemInstruction = null;

    for (const msg of normalizedMessages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    const requestBody = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.max_tokens || options.maxTokens || 2048,
      },
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;
    
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    // Extract text from response
    const text = data.candidates?.[0]?.content?.parts
      ?.map(p => p.text)
      .join('') || '';

    const usage = data.usageMetadata || {};
    const cost = this.calculateCost(usage, model);

    return {
      text,
      usage: {
        prompt_tokens: usage.promptTokenCount || 0,
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0,
      },
      latencyMs,
      model,
      provider: this.name,
      cost,
    };
  }

  async streamComplete(messages, options = {}, onChunk = () => {}) {
    if (!this.apiKey) {
      throw new Error('Google API key not configured');
    }

    const normalizedMessages = this.normalizeMessages(messages);
    const model = options.model || this.defaultModel;
    const startTime = Date.now();

    const contents = [];
    let systemInstruction = null;

    for (const msg of normalizedMessages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    }

    const requestBody = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.max_tokens || options.maxTokens || 2048,
      },
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;
    
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google error: ${response.status} - ${error}`);
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
          const text = parsed.candidates?.[0]?.content?.parts
            ?.map(p => p.text)
            .join('') || '';
          
          if (text) {
            fullText += text;
            onChunk(text);
          }

          if (parsed.usageMetadata) {
            usage = {
              prompt_tokens: parsed.usageMetadata.promptTokenCount || 0,
              completion_tokens: parsed.usageMetadata.candidatesTokenCount || 0,
              total_tokens: parsed.usageMetadata.totalTokenCount || 0,
            };
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
      cost: this.calculateCost({ promptTokenCount: usage.prompt_tokens, candidatesTokenCount: usage.completion_tokens }, model),
    };
  }

  async getModels() {
    if (!this.apiKey) return [];

    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/models?key=${this.apiKey}`
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await response.json();
      return (data.models || [])
        .filter(m => m.name.includes('gemini'))
        .map(m => ({
          id: m.name.replace('models/', ''),
          name: m.displayName || m.name,
          description: m.description,
        }));
    } catch (error) {
      console.warn(`Google getModels failed: ${error.message}`);
      return Object.keys(MODEL_PRICING).map(id => ({ id, name: id }));
    }
  }

  async isAvailable() {
    return !!this.apiKey;
  }

  calculateCost(usage, model) {
    const pricing = MODEL_PRICING[model];
    if (!pricing || !usage) return null;

    const inputCost = (usage.promptTokenCount || 0) * (pricing.input / 1_000_000);
    const outputCost = (usage.candidatesTokenCount || 0) * (pricing.output / 1_000_000);
    return inputCost + outputCost;
  }
}
