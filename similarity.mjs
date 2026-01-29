/**
 * Semantic Similarity
 * 
 * Embeddings-based similarity scoring
 */

import { getProvider } from './providers/index.mjs';

/**
 * Get embeddings from OpenAI
 */
async function getOpenAIEmbeddings(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY required for embeddings');
  }
  
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`OpenAI embeddings error: ${response.status}`);
  }
  
  const data = await response.json();
  return data.data.map(d => d.embedding);
}

/**
 * Get embeddings from Ollama
 */
async function getOllamaEmbeddings(texts) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  
  const embeddings = [];
  for (const text of texts) {
    const response = await fetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: text,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama embeddings error: ${response.status}`);
    }
    
    const data = await response.json();
    embeddings.push(data.embedding);
  }
  
  return embeddings;
}

/**
 * Get embeddings using available provider
 */
export async function getEmbeddings(texts, provider = null) {
  const textArray = Array.isArray(texts) ? texts : [texts];
  
  // Try OpenAI first (best quality)
  if (process.env.OPENAI_API_KEY) {
    return getOpenAIEmbeddings(textArray);
  }
  
  // Fall back to Ollama
  if (process.env.OLLAMA_BASE_URL || true) {
    try {
      return await getOllamaEmbeddings(textArray);
    } catch (e) {
      console.warn('Ollama embeddings failed:', e.message);
    }
  }
  
  throw new Error('No embedding provider available');
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have same dimension');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Calculate semantic similarity between two texts
 */
export async function semanticSimilarity(text1, text2) {
  const embeddings = await getEmbeddings([text1, text2]);
  return cosineSimilarity(embeddings[0], embeddings[1]);
}

/**
 * Semantic similarity evaluator
 */
export async function semanticSimilarityEval(testCase, response, options = {}) {
  const expected = testCase.expected || testCase.reference || testCase.gold;
  
  if (!expected) {
    return {
      pass: null,
      score: null,
      reason: 'No expected text for semantic similarity',
      evalType: 'semantic_similarity',
    };
  }
  
  try {
    const similarity = await semanticSimilarity(expected, response);
    const threshold = testCase.similarity_threshold || options.threshold || 0.7;
    const pass = similarity >= threshold;
    
    return {
      pass,
      score: similarity,
      reason: `Similarity: ${(similarity * 100).toFixed(1)}% (threshold: ${threshold * 100}%)`,
      evalType: 'semantic_similarity',
    };
  } catch (error) {
    return {
      pass: null,
      score: null,
      reason: `Similarity error: ${error.message}`,
      evalType: 'semantic_similarity',
    };
  }
}

/**
 * Find most similar text from a list
 */
export async function findMostSimilar(query, candidates) {
  const queryEmbed = (await getEmbeddings([query]))[0];
  const candidateEmbeds = await getEmbeddings(candidates);
  
  let bestIdx = 0;
  let bestSimilarity = -1;
  
  for (let i = 0; i < candidates.length; i++) {
    const sim = cosineSimilarity(queryEmbed, candidateEmbeds[i]);
    if (sim > bestSimilarity) {
      bestSimilarity = sim;
      bestIdx = i;
    }
  }
  
  return {
    index: bestIdx,
    text: candidates[bestIdx],
    similarity: bestSimilarity,
  };
}

/**
 * Calculate pairwise similarities between all texts
 */
export async function pairwiseSimilarities(texts) {
  const embeddings = await getEmbeddings(texts);
  const n = texts.length;
  const matrix = Array(n).fill(null).map(() => Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      matrix[i][j] = cosineSimilarity(embeddings[i], embeddings[j]);
    }
  }
  
  return matrix;
}
