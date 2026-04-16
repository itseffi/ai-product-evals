---
name: build-review-interface
description: >
  Guides building or improving interfaces for human review of eval traces.
  Use when humans need to inspect failures, label outputs, compare model behavior,
  or audit evaluator decisions at scale.
---

# Build Review Interface

## Overview

1. Start from the human review task, not from UI widgets.
2. Optimize the interface for fast, correct judgment on traces.
3. Show the evidence needed to make a decision without forcing excessive context switching.
4. Capture structured labels that can later validate evaluators or improve datasets.
5. Use the interface to support error analysis, not just browsing.

## Prerequisites

Inspect the current review surface in `app.html`, existing trace structure in `traces/`, and the runner output format in `run-eval.mjs` and `tracer.mjs`. Determine what human reviewers need to decide and what information is currently missing.

## Core Instructions

### Define The Review Task Clearly

Decide whether the reviewer is being asked to:

- accept or reject a model response
- identify a failure category
- compare two model outputs
- validate a judge decision
- annotate retrieval versus generation failures

The UI should be built around one or two explicit review tasks.

### Show The Minimum Necessary Context

For each record, consider showing:

- prompt
- system prompt
- retrieved context if relevant
- model response
- evaluator decision
- trace metadata

Do not hide the evidence that explains why a label should be applied.

### Capture Structured Labels

Prefer structured fields over only free-form notes, such as:

- pass/fail
- failure category
- severity
- corrected answer
- evaluator disagreement

These labels should be reusable later for evaluator validation or dataset cleanup.

### Use Review To Improve The Eval Pipeline

The interface should help answer:

- which failures are real model failures
- which are evaluator mistakes
- which test cases need rewriting
- which missing cases should be added

### Repo Files To Inspect

- `app.html`
- `traces/`
- `tracer.mjs`
- `run-eval.mjs`
- `evaluators/index.mjs`

## Anti-Patterns

- Building UI before defining the review task.
- Showing too little context for a human to judge accurately.
- Capturing only free-form notes with no structured labels.
- Treating review as a one-off dashboard instead of a data-generation tool.
- Making reviewers navigate multiple screens to answer one simple question.
