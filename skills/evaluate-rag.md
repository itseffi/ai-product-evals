---
name: evaluate-rag
description: >
  Guides evaluation of RAG pipeline retrieval and generation quality.
  Use when evaluating a retrieval-augmented generation system, measuring retrieval quality,
  assessing generation faithfulness or relevance, generating synthetic QA pairs for retrieval
  testing, or optimizing chunking strategies.
---

# Evaluate RAG

## Overview

1. Do error analysis on end-to-end traces first. Determine whether failures come from retrieval, generation, or both.
2. Build a retrieval evaluation dataset: queries paired with relevant document chunks.
3. Measure retrieval quality with Recall@k.
4. Evaluate generation separately: faithfulness and relevance.
5. If retrieval is the bottleneck, optimize chunking before tuning generation.

## Prerequisites

Complete error analysis on RAG pipeline traces before selecting metrics. Inspect what was retrieved versus what the model needed. Determine whether the problem is retrieval, generation, or both. Start from `evals/rag-pipeline.json`, inspect `run-eval.mjs`, `evaluators/index.mjs`, `app.html`, and review `traces/` before making changes.

## Core Instructions

### Use The Built-In RAG Metric Types

Use `eval_type: "rag_retrieval"` for retrieval-only checks with `retrieved_context_ids`, `expected_relevant_context_ids`, and `k`.

Use relationship evals for generation:

- `rag_context_relevance` for C|Q
- `rag_faithfulness` for A|C
- `rag_answer_relevance` for A|Q
- `rag_context_support` for C|A
- `rag_answerability` for Q|C
- `rag_self_containment` for Q|A

Use the `rag-quality` judge template when you need a single end-to-end RAG answer rubric that covers grounding, answerability/refusal, scope discipline, answer relevance, and attribution.

### Evaluate Retrieval And Generation Separately

Measure each component independently.

- **First-pass retrieval:** Optimize for Recall@k. Include all relevant documents, even at the cost of noise.
- **Reranking:** Optimize for Precision@k, MRR, or NDCG@k. Rank the most relevant documents first.

### Build A Retrieval Evaluation Dataset

You need queries paired with ground-truth relevant document chunks.

**Manual curation (highest quality):** Write realistic questions and map each to the exact chunk or chunks containing the answer.

**Synthetic QA generation (scalable):** For each document chunk, prompt an LLM to extract a fact and generate a question answerable only from that fact.

Synthetic QA prompt template:

```text
Given a chunk of text, extract a specific, self-contained fact from it.
Then write a question that is directly and unambiguously answered
by that fact alone.

Return output in JSON format:
{ "fact": "...", "question": "..." }

Chunk: "{text_chunk}"
```

**Adversarial question generation:** Create harder queries that resemble content in multiple chunks but are only answered by one.

Process:

1. Select target chunk A containing a clear fact.
2. Find similar chunks B and C using embedding search.
3. Prompt the LLM to write a question using terminology from B and C that only chunk A answers.

### Retrieval Metrics

**Recall@k:** Fraction of relevant documents found in the top k results.

```text
Recall@k = (relevant docs in top k) / (total relevant docs for query)
```

**Precision@k:** Fraction of top k results that are relevant.

```text
Precision@k = (relevant docs in top k) / k
```

**Mean Reciprocal Rank (MRR):** How early the first relevant document appears.

```text
MRR = (1/N) * sum(1/rank_of_first_relevant_doc)
```

**NDCG@k:** For graded relevance where documents have varying utility.

```text
DCG@k  = sum over i=1..k of: rel_i / log2(i+1)
IDCG@k = DCG@k with documents sorted by decreasing relevance
NDCG@k = DCG@k / IDCG@k
```

### Evaluate And Optimize Chunking

Treat chunking as a tunable hyperparameter.

- run fixed-size chunk grid searches
- compare chunk size and overlap
- measure Recall@k and NDCG@k on the same dataset
- use content-aware chunking when fixed-size splits break logical units

### Evaluate Generation Quality

After retrieval is adequate, evaluate:

- **Faithfulness:** whether the answer is grounded in retrieved context
- **Relevance:** whether the answer addresses the actual user query

Diagnose failures using traces:

- hallucinations
- omissions
- misinterpretations
- answering the wrong part of the retrieved context

### Multi-Hop Retrieval Evaluation

For questions requiring multiple chunks:

```text
TwoHopRecall@k = (1/N) * sum(1 if {Chunk1, Chunk2} ⊆ top_k_results)
```

Classify failures as:

- hop 1 miss
- hop 2 miss
- rank-out-of-top-k

### Repo Files To Inspect

- `evals/rag-pipeline.json`
- `evaluators/rag.mjs`
- `evaluators/index.mjs`
- `judges/rag-faithfulness.md`
- `judges/rag-quality.md`
- `traces/`

## Anti-Patterns

- Using one end-to-end correctness metric without separating retrieval and generation.
- Jumping directly to metrics without reading traces first.
- Tuning generation before fixing retrieval.
- Overfitting to synthetic evaluation data without checking real user queries.
- Using similarity metrics as the main generation metric instead of grounded error analysis.
