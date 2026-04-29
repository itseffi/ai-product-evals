---
name: validate-evaluator
description: >
  Guides validation of evaluators, especially LLM judges, against labeled examples.
  Use when evaluator quality is uncertain, judge scores seem inconsistent,
  or you need to check whether the evaluator is biased, noisy, or misaligned.
---

# Validate Evaluator

## Overview

1. Treat the evaluator as a model that can fail.
2. Compare evaluator decisions against trusted labels or strong reference examples.
3. Measure false positives and false negatives separately.
4. Check whether the evaluator is biased toward verbosity, formatting, or certain providers.
5. Calibrate the evaluator before expanding its use.

## Prerequisites

Collect labeled examples or high-confidence gold cases first. Inspect `evaluators/index.mjs`, especially judge-based paths, and read traces where the evaluator’s decision seems suspicious.

## Core Instructions

### Use The Repo Harness First

Run:

```bash
npm run skill:validate-evaluator
```

For a specific label file:

```bash
node scripts/validate-evaluator.mjs labels/sample-goldens.json
```

Use repeated runs when validating a judge:

```bash
node scripts/validate-evaluator.mjs labels/sample-goldens.json --repeat 5
```

Treat agreement, false positives, false negatives, disagreement samples, and stability as the primary output. A judge that flips verdicts on repeated calls is not calibrated, even if one run reports high agreement.

The validator exits nonzero when provider calls fail, parse failures occur, agreement or stability are below threshold, or drift exceeds the supplied baseline. Override defaults with `--min-agreement`, `--min-stability`, `--drift-baseline`, `--max-agreement-drop`, and `--max-stability-drop`.

The validator also reports Cohen's kappa. Use kappa alongside raw agreement because raw agreement can look strong on imbalanced labels.

Use a judge panel when one model is too noisy:

```bash
node scripts/validate-evaluator.mjs labels/sample-goldens.json --judge-panel openai:gpt-5.5,anthropic:claude-haiku-4-5
```

Run the public synthetic bias checks before trusting pairwise judges:

```bash
npm run skill:judge-bias-check
```

### Build A Validation Set

Use:

- human-labeled examples
- obvious positive examples
- obvious negative examples
- edge cases that are hard but still interpretable

The validation set should include both passes and fails.

### Measure Error Types Separately

Do not rely on one aggregate accuracy value alone. Check:

- false positives
- false negatives
- consistency on repeated or near-duplicate cases
- disagreement patterns by capability area

### Look For Systematic Bias

Check whether the evaluator:

- rewards verbosity
- changes its answer when response order is swapped
- over-penalizes formatting differences
- prefers one provider’s style
- mistakes plausible hallucinations for grounded answers

### Calibrate Before Production Use

If the evaluator is unreliable on labeled examples, fix the rubric or the parsing before using it to score more data.

Use suite-specific judge templates from `judges/` when possible. Keep generic criteria as a fallback only.
For RAG calibration sets, use `rag-quality` unless you are intentionally testing a narrower relationship such as `rag-faithfulness`.

### Repo Files To Inspect

- `evaluators/index.mjs`
- `run-eval.mjs`
- `evals/`
- `traces/`
- `app.html`
- `labels/`
- `judges/`
- `scripts/validate-evaluator.mjs`

## Anti-Patterns

- Assuming the evaluator is correct because it is an LLM.
- Reporting only one overall accuracy number.
- Calibrating on cherry-picked easy cases.
- Ignoring false positives or false negatives.
- Expanding judge usage before validating it on labeled data.
