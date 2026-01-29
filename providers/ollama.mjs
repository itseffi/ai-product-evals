/**
 * Ollama Provider
 * Local/open-source LLM inference
 * https://ollama.ai
 */

import { BaseProvider } from './base.mjs';

export class OllamaProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'ollama';
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.defaultModel = config.defaultModel || 'llama3.2';
  }

  async complete(messages, options = {}) {
    const normalizedMessages = this.normalizeMessages(messages);
    const model = options.model || this.defaultModel;
    const startTime = Date.now();

    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: normalizedMessages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.max_tokens || options.maxTokens || 2048,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const latencyMs = Date.now() - startTime;

    return {
      text: data.message?.content || '',
      usage: {
        prompt_tokens: data.prompt_eval_count || 0,
        completion_tokens: data.eval_count || 0,
        total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      latencyMs,
      model,
      provider: this.name,
      cost: null, // Ollama is free/local
    };
  }

  async streamComplete(messages, options = {}, onChunk = () => {}) {
    const normalizedMessages = this.normalizeMessages(messages);
    const model = options.model || this.defaultModel;
    const startTime = Date.now();

    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: normalizedMessages,
        stream: true,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.max_tokens || options.maxTokens || 2048,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error: ${response.status} - ${error}`);
    }

    let fullText = '';
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            fullText += data.message.content;
            onChunk(data.message.content);
          }
          if (data.done) {
            usage = {
              prompt_tokens: data.prompt_eval_count || 0,
              completion_tokens: data.eval_count || 0,
              total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
            };
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    }

    return {
      text: fullText,
      usage,
      latencyMs: Date.now() - startTime,
      model,
      provider: this.name,
      cost: null,
    };
  }

  async getModels() {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await response.json();
      return (data.models || []).map(m => ({
        id: m.name,
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
      }));
    } catch (error) {
      console.warn(`Ollama getModels failed: ${error.message}`);
      return [];
    }
  }

  async isAvailable() {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
