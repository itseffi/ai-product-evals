/**
 * Provider Factory
 * Creates and manages LLM provider instances
 */

import { OllamaProvider } from './ollama.mjs';
import { OpenRouterProvider } from './openrouter.mjs';
import { OpenAIProvider } from './openai.mjs';
import { AnthropicProvider } from './anthropic.mjs';
import { GoogleProvider } from './google.mjs';

const PROVIDERS = {
  ollama: OllamaProvider,
  openrouter: OpenRouterProvider,
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  google: GoogleProvider,
};

// Provider instances cache
const instances = {};

/**
 * Get a provider instance by name
 * @param {string} name - Provider name (ollama, openrouter, openai, anthropic, google)
 * @param {Object} config - Optional provider-specific config
 * @returns {BaseProvider}
 */
export function getProvider(name, config = {}) {
  const normalizedName = name.toLowerCase();
  
  if (!PROVIDERS[normalizedName]) {
    throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  // Cache provider instances unless config is passed
  const cacheKey = Object.keys(config).length === 0 ? normalizedName : null;
  
  if (cacheKey && instances[cacheKey]) {
    return instances[cacheKey];
  }

  const ProviderClass = PROVIDERS[normalizedName];
  const instance = new ProviderClass(config);

  if (cacheKey) {
    instances[cacheKey] = instance;
  }

  return instance;
}

/**
 * Get all available providers (those with credentials configured)
 * @returns {Promise<Array<{name: string, provider: BaseProvider, available: boolean}>>}
 */
export async function getAvailableProviders() {
  const results = [];
  
  for (const [name, ProviderClass] of Object.entries(PROVIDERS)) {
    const provider = getProvider(name);
    const available = await provider.isAvailable();
    results.push({ name, provider, available });
  }
  
  return results;
}

/**
 * Get the default provider based on availability
 * Priority: env DEFAULT_PROVIDER > ollama > openrouter > openai > anthropic > google
 * @returns {Promise<BaseProvider>}
 */
export async function getDefaultProvider() {
  const defaultName = process.env.DEFAULT_PROVIDER?.toLowerCase();
  
  if (defaultName && PROVIDERS[defaultName]) {
    const provider = getProvider(defaultName);
    if (await provider.isAvailable()) {
      return provider;
    }
    console.warn(`Default provider "${defaultName}" is not available, trying others...`);
  }

  // Try providers in order of preference
  const order = ['ollama', 'openrouter', 'openai', 'anthropic', 'google'];
  
  for (const name of order) {
    const provider = getProvider(name);
    if (await provider.isAvailable()) {
      return provider;
    }
  }

  throw new Error('No LLM providers available. Please configure at least one provider in .env');
}

/**
 * Get provider names
 * @returns {string[]}
 */
export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

// Re-export provider classes
export { OllamaProvider, OpenRouterProvider, OpenAIProvider, AnthropicProvider, GoogleProvider };
