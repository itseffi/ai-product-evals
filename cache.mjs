/**
 * Response Cache
 * 
 * Caches LLM responses to avoid re-running identical prompts
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, resolve } from 'path';

const CACHE_DIR = resolve(process.cwd(), '.cache');
const DEFAULT_CACHE_TTL_MS = 86400000;
const MIN_CACHE_TTL_MS = 1000;
const MAX_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
    tools: options.tools,
    tool_choice: options.tool_choice,
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
    const ttlMs = parseCacheTtlMs(process.env.CACHE_TTL_MS);
    if (Date.now() - data.timestamp > ttlMs) {
      return null;
    }
    
    return data.response;
  } catch {
    return null;
  }
}

export function parseCacheTtlMs(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_CACHE_TTL_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_CACHE_TTL_MS;
  return Math.min(Math.max(parsed, MIN_CACHE_TTL_MS), MAX_CACHE_TTL_MS);
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
