/**
 * Base Provider Class
 * Abstract interface that all LLM providers must implement
 */

export class BaseProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = 'base';
    this.timeout = config.timeout || parseInt(process.env.EVAL_TIMEOUT_MS || '60000', 10);
  }

  /**
   * Complete a prompt and return the response
   * @param {string|Array} messages - Prompt string or array of {role, content} messages
   * @param {Object} options - Model options (model, temperature, max_tokens, etc.)
   * @returns {Promise<{text: string, usage: Object, latencyMs: number, model: string}>}
   */
  async complete(messages, options = {}) {
    throw new Error('complete() must be implemented by provider');
  }

  /**
   * Stream a completion (optional - falls back to complete if not implemented)
   * @param {string|Array} messages - Prompt string or array of messages
   * @param {Object} options - Model options
   * @param {Function} onChunk - Callback for each chunk
   * @returns {Promise<{text: string, usage: Object, latencyMs: number, model: string}>}
   */
  async streamComplete(messages, options = {}, onChunk = () => {}) {
    // Default implementation: just call complete
    return this.complete(messages, options);
  }

  /**
   * Get list of available models for this provider
   * @returns {Promise<Array<{id: string, name: string, contextLength?: number}>>}
   */
  async getModels() {
    throw new Error('getModels() must be implemented by provider');
  }

  /**
   * Check if provider is available (has credentials, service is up)
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    throw new Error('isAvailable() must be implemented by provider');
  }

  /**
   * Normalize messages to array format
   * @param {string|Array} messages
   * @returns {Array<{role: string, content: string}>}
   */
  normalizeMessages(messages) {
    if (typeof messages === 'string') {
      return [{ role: 'user', content: messages }];
    }
    return messages;
  }

  /**
   * Make an HTTP request with timeout
   * @param {string} url
   * @param {Object} options - fetch options
   * @returns {Promise<Response>}
   */
  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Calculate estimated cost (override in provider if supported)
   * @param {Object} usage - {prompt_tokens, completion_tokens}
   * @param {string} model
   * @returns {number|null} - Cost in USD or null if unknown
   */
  calculateCost(usage, model) {
    return null;
  }
}
