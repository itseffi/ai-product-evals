/**
 * Response Cache
 * 
 * Caches LLM responses to avoid re-running identical prompts
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const CACHE_DIR = resolve(process.cwd(), '.cache');

// Ensure cache directory exists
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Generate cache key from request parameters
 */
export function getCacheKey(provider, model, messages, options = {}) {
  const data = JSON.stringify({
    provider,
    model,
    messages,
    temperature: options.temperature,
    max_tokens: options.max_tokens,
  });
  
  return createHash('sha256').update(data).digest('hex').substring(0, 16);
}

/**
 * Get cached response if exists
 */
export function getCachedResponse(cacheKey) {
  const cachePath = join(CACHE_DIR, `${cacheKey}.json`);
  
  if (!existsSync(cachePath)) {
    return null;
  }
  
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf8'));
    
    // Check TTL (default 24 hours)
    const ttlMs = parseInt(process.env.CACHE_TTL_MS || '86400000', 10);
    if (Date.now() - data.timestamp > ttlMs) {
      return null;
    }
    
    return data.response;
  } catch {
    return null;
  }
}

/**
 * Save response to cache
 */
export function setCachedResponse(cacheKey, response) {
  const cachePath = join(CACHE_DIR, `${cacheKey}.json`);
  
  const data = {
    timestamp: Date.now(),
    response,
  };
  
  try {
    writeFileSync(cachePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn(`Cache write failed: ${err.message}`);
  }
}

/**
 * Clear all cache
 */
export function clearCache() {
  const { readdirSync, unlinkSync } = require('fs');
  
  if (!existsSync(CACHE_DIR)) {
    return 0;
  }
  
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  files.forEach(f => unlinkSync(join(CACHE_DIR, f)));
  
  return files.length;
}

/**
 * Get cache stats
 */
export function getCacheStats() {
  const { readdirSync, statSync } = require('fs');
  
  if (!existsSync(CACHE_DIR)) {
    return { entries: 0, sizeBytes: 0 };
  }
  
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  const sizeBytes = files.reduce((sum, f) => {
    try {
      return sum + statSync(join(CACHE_DIR, f)).size;
    } catch {
      return sum;
    }
  }, 0);
  
  return { entries: files.length, sizeBytes };
}
