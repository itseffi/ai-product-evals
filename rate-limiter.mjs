/**
 * Rate Limiter
 * 
 * Handles API rate limits with token bucket algorithm
 */

class RateLimiter {
  constructor(options = {}) {
    this.requestsPerMinute = options.requestsPerMinute || 60;
    this.tokensPerMinute = options.tokensPerMinute || 100000;
    this.retryAfterMs = options.retryAfterMs || 1000;
    
    // Token buckets
    this.requestTokens = this.requestsPerMinute;
    this.tokenBucket = this.tokensPerMinute;
    
    // Refill timestamps
    this.lastRefill = Date.now();
    
    // Queue for pending requests
    this.queue = [];
    this.processing = false;
  }
  
  /**
   * Refill token buckets based on elapsed time
   */
  refill() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    const elapsedMinutes = elapsedMs / 60000;
    
    // Refill proportionally
    this.requestTokens = Math.min(
      this.requestsPerMinute,
      this.requestTokens + (this.requestsPerMinute * elapsedMinutes)
    );
    
    this.tokenBucket = Math.min(
      this.tokensPerMinute,
      this.tokenBucket + (this.tokensPerMinute * elapsedMinutes)
    );
    
    this.lastRefill = now;
  }
  
  /**
   * Check if we can make a request
   */
  canRequest(estimatedTokens = 1000) {
    this.refill();
    return this.requestTokens >= 1 && this.tokenBucket >= estimatedTokens;
  }
  
  /**
   * Consume tokens for a request
   */
  consume(actualTokens = 1000) {
    this.requestTokens -= 1;
    this.tokenBucket -= actualTokens;
  }
  
  /**
   * Wait until we can make a request
   */
  async waitForCapacity(estimatedTokens = 1000) {
    while (!this.canRequest(estimatedTokens)) {
      const waitMs = Math.min(this.retryAfterMs, 5000);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  
  /**
   * Execute a function with rate limiting
   */
  async execute(fn, estimatedTokens = 1000) {
    await this.waitForCapacity(estimatedTokens);
    
    try {
      const result = await fn();
      
      // Consume actual tokens if available
      const actualTokens = result?.usage?.total_tokens || estimatedTokens;
      this.consume(actualTokens);
      
      return result;
    } catch (error) {
      // Handle rate limit errors
      if (error.message?.includes('429') || error.message?.includes('rate limit')) {
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, this.retryAfterMs * 2));
        return this.execute(fn, estimatedTokens);
      }
      throw error;
    }
  }
}

// Provider-specific rate limiters
const limiters = new Map();

/**
 * Get or create rate limiter for a provider
 */
export function getRateLimiter(provider) {
  if (!limiters.has(provider)) {
    // Default limits (can be configured per provider)
    const limits = {
      ollama: { requestsPerMinute: 1000, tokensPerMinute: 1000000 }, // Local, no real limits
      openai: { requestsPerMinute: 60, tokensPerMinute: 90000 },
      anthropic: { requestsPerMinute: 60, tokensPerMinute: 100000 },
      google: { requestsPerMinute: 60, tokensPerMinute: 100000 },
      openrouter: { requestsPerMinute: 60, tokensPerMinute: 100000 },
    };
    
    const config = limits[provider] || { requestsPerMinute: 30, tokensPerMinute: 50000 };
    limiters.set(provider, new RateLimiter(config));
  }
  
  return limiters.get(provider);
}

/**
 * Execute with rate limiting for a specific provider
 */
export async function withRateLimit(provider, fn, estimatedTokens = 1000) {
  const limiter = getRateLimiter(provider);
  return limiter.execute(fn, estimatedTokens);
}

export { RateLimiter };
