---
name: generate-synthetic-data
description: >
  Guides creation of synthetic eval cases that expand coverage without drifting away from real usage.
  Use when the current eval set is too small, too repetitive, or missing edge cases,
  and you need more diverse prompts, distractors, or structured scenarios.
---

# Generate Synthetic Data

## Overview

1. Start from real failure modes or real task dimensions, not random prompt generation.
2. Generate synthetic examples to cover missing combinations systematically.
3. Filter synthetic examples for realism, uniqueness, and evaluability.
4. Add only examples that improve coverage or expose a real blind spot.
5. Validate synthetic examples against real usage periodically.

## Prerequisites

Inspect the current eval suite and recent traces first. Determine what dimensions are under-covered. Use `evals/`, `traces/`, and `evaluators/index.mjs` to understand what kinds of examples the repo can score well.

## Core Instructions

### Start From Dimensions, Not Random Prompts

Define the dimensions that matter for the task, such as:

- difficulty
- ambiguity
- required format
- domain
- tool/no-tool decision
- retrieval dependency
- single-hop vs multi-hop

Generate examples by combining those dimensions intentionally.

### Use Tuple-Based Coverage

Create combinations of task dimensions and ensure each combination is represented by at least one eval case. This prevents synthetic generation from overproducing the easiest examples.

### Generate Evaluatable Cases

A synthetic example is useful only if you can score it reliably. Prefer cases that support:

- exact checks
- regex checks
- tool-call checks
- clearly grounded subjective evaluation

Do not generate cases whose “correct answer” is too vague to evaluate.

### Filter Generated Examples

Reject examples that are:

- duplicates
- unrealistic
- too similar to the prompt template
- trivially easy
- impossible to score cleanly

Keep only synthetic data that expands meaningful coverage.

### Repo Files To Inspect

- `evals/`
- `dataset.mjs`
- `run-eval.mjs`
- `evaluators/index.mjs`
- `traces/`

## Anti-Patterns

- Generating synthetic data without first identifying missing dimensions.
- Adding large volumes of low-quality examples.
- Treating synthetic data as a substitute for real user data.
- Creating examples that cannot be scored clearly.
- Overfitting the suite to synthetic phrasing.
