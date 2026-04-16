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
- over-penalizes formatting differences
- prefers one provider’s style
- mistakes plausible hallucinations for grounded answers

### Calibrate Before Production Use

If the evaluator is unreliable on labeled examples, fix the rubric or the parsing before using it to score more data.

### Repo Files To Inspect

- `evaluators/index.mjs`
- `run-eval.mjs`
- `evals/`
- `traces/`
- `app.html`

## Anti-Patterns

- Assuming the evaluator is correct because it is an LLM.
- Reporting only one overall accuracy number.
- Calibrating on cherry-picked easy cases.
- Ignoring false positives or false negatives.
- Expanding judge usage before validating it on labeled data.
