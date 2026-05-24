export function ragRetrievalEval(testCase) {
  const retrieved = testCase.retrieved_context_ids || testCase.retrievedContextIds || [];
  const expected = testCase.expected_relevant_context_ids || testCase.expectedRelevantContextIds || [];
  const k = Number(testCase.k || testCase.top_k || retrieved.length || 1);

  if (!Array.isArray(retrieved) || !Array.isArray(expected) || expected.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: 'RAG retrieval eval requires retrieved_context_ids and expected_relevant_context_ids',
      evalType: 'rag_retrieval',
      metrics: { recallAtK: 0, precisionAtK: 0, mrr: 0 },
    };
  }

  const topK = retrieved.slice(0, k);
  const expectedSet = new Set(expected.map(String));
  const relevantInTopK = topK.filter(id => expectedSet.has(String(id)));
  const firstRelevantIndex = retrieved.findIndex(id => expectedSet.has(String(id)));

  const recallAtK = relevantInTopK.length / expectedSet.size;
  const precisionAtK = relevantInTopK.length / Math.max(topK.length, 1);
  const mrr = firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0;
  const ndcg = ndcgAtK(topK, expectedSet, k);

  const metrics = { recallAtK, precisionAtK, mrr, ndcg, k };
  // Gate on one named metric instead of averaging unrelated quantities; the
  // score reflects whatever metric gates so pass/score stay consistent.
  const metricKey = { recall: 'recallAtK', precision: 'precisionAtK', mrr: 'mrr', ndcg: 'ndcg' }[testCase.retrieval_pass_metric] || 'recallAtK';
  const passThreshold = testCase.threshold ?? 1;
  const score = metrics[metricKey];
  const pass = score >= passThreshold;

  return {
    pass,
    score,
    reason: `Recall@${k}: ${format(recallAtK)}, Precision@${k}: ${format(precisionAtK)}, MRR: ${format(mrr)}, nDCG@${k}: ${format(ndcg)} (gate: ${metricKey} >= ${passThreshold})`,
    evalType: 'rag_retrieval',
    metrics,
  };
}

function ndcgAtK(topK, expectedSet, k) {
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (expectedSet.has(String(topK[i]))) dcg += 1 / Math.log2(i + 2);
  }
  let idcg = 0;
  const idealHits = Math.min(k, expectedSet.size);
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

export function getRagContext(testCase) {
  if (testCase.context) return stringifyContext(testCase.context);
  if (testCase.contexts) return stringifyContext(testCase.contexts);
  if (testCase.retrieved_contexts) return stringifyContext(testCase.retrieved_contexts);

  const prompt = testCase.prompt || testCase.question || '';
  const contextMatch = prompt.match(/context:\s*---\n([\s\S]*?)\n---/i);
  if (contextMatch) return contextMatch[1].trim();

  const chunks = [...prompt.matchAll(/Chunk\s+\d+:\s*([\s\S]*?)(?=\nChunk\s+\d+:|\n\nQuestion:|$)/gi)]
    .map(match => match[1].trim());
  if (chunks.length > 0) return chunks.join('\n\n');

  return '';
}

function stringifyContext(context) {
  if (Array.isArray(context)) {
    return context.map(item => {
      if (typeof item === 'string') return item;
      return `${item.id ? `[${item.id}] ` : ''}${item.text || item.content || JSON.stringify(item)}`;
    }).join('\n\n');
  }
  if (typeof context === 'object') return JSON.stringify(context, null, 2);
  return String(context || '');
}

function format(value) {
  return `${Math.round(value * 100)}%`;
}
