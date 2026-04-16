---
name: benchmark-models
description: >
  Guides model and provider comparison on a shared eval suite.
  Use when comparing providers, selecting a default model, investigating
  model-specific regressions, or turning one suite into a reusable benchmark.
---

# Benchmark Models

## Overview

1. Hold the eval suite constant and vary only provider/model.
2. Use one shared suite first: `evals/llm-comparison.json`.
3. Compare pass rate and failure categories, not just aggregate score.
4. Read traces to understand whether differences are capability, formatting, or evaluator issues.
5. Keep quality findings separate from infrastructure and pricing metadata.

## Prerequisites

Verify that the compared models are available and that the suite is provider-agnostic. Inspect `evals/llm-comparison.json`, `run-eval.mjs`, `providers/`, and `.github/workflows/eval.yml` before running comparisons.

## Core Instructions

### Keep The Benchmark Constant

Use the same:

- prompts
- assertions
- evaluator mode
- output format

Only provider/model should change.

Example runs:

```bash
node run-eval.mjs --provider openai --model gpt-5.4-mini evals/llm-comparison.json
node run-eval.mjs --provider anthropic --model claude-haiku-4-5 evals/llm-comparison.json
node run-eval.mjs --provider google --model gemini-2.5-flash evals/llm-comparison.json
```

### Compare By Failure Mode

Group failures by capability:

- instruction following
- factual recall
- reasoning
- code generation
- formatting compliance

A benchmark is more useful when it explains where a model fails, not just whether it lost.

### Check Evaluator Sensitivity

Determine whether the suite is strong enough to distinguish models. If weak `contains` checks let all models pass, the benchmark is not sensitive. If formatting rules dominate all failures, the benchmark may be too brittle.

### Read Traces Before Ranking

Inspect `traces/` to answer:

- Did the lower-ranked model actually misunderstand the task?
- Did it fail only on formatting?
- Did the evaluator mis-score a good output?
- Did the provider produce parsing differences that look like capability differences?

### Repo Files To Inspect

- `evals/llm-comparison.json`
- `run-eval.mjs`
- `evaluators/index.mjs`
- `providers/`
- `.github/workflows/eval.yml`
- `traces/`

## Anti-Patterns

- Comparing different prompt sets across models.
- Mixing benchmark edits and model changes in the same run.
- Ranking by one average number without reading traces.
- Treating provider transport failures as model quality failures.
- Using cost as a primary benchmark outcome when the goal is quality.
