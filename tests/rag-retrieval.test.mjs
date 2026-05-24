import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ragRetrievalEval } from '../evaluators/rag.mjs';

const base = { retrieved_context_ids: ['a', 'b', 'c'], expected_relevant_context_ids: ['a', 'c'], k: 3 };

test('reports recall, precision, mrr and nDCG separately', () => {
  const r = ragRetrievalEval(base);
  assert.equal(r.metrics.recallAtK, 1);
  assert.ok(Math.abs(r.metrics.precisionAtK - 2 / 3) < 1e-9);
  assert.equal(r.metrics.mrr, 1);
  assert.ok(Math.abs(r.metrics.ndcg - 0.9197) < 1e-3);
});

test('pass metric is configurable (gate on precision)', () => {
  const r = ragRetrievalEval({ ...base, retrieval_pass_metric: 'precision', threshold: 0.8 });
  assert.equal(r.pass, false);
});

test('score reflects the gated metric, not an average of unrelated metrics', () => {
  const r = ragRetrievalEval(base);
  assert.equal(r.score, r.metrics.recallAtK);
});

test('default gate is recall', () => {
  assert.equal(ragRetrievalEval(base).pass, true);
  assert.equal(ragRetrievalEval({ ...base, expected_relevant_context_ids: ['a', 'c', 'z'] }).pass, false);
});
