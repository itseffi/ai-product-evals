---
name: evaluate-code-generation
description: >
  Guides evaluation of code-generation tasks.
  Use when benchmarking coding models, assessing bug-fix and synthesis tasks,
  strengthening weak checks, or designing better coding eval cases.
---

# Evaluate Code Generation

## Overview

1. Read traces before changing the coding benchmark.
2. Separate syntax validity, instruction following, and semantic correctness.
3. Start from `evals/code-generation.json`.
4. Replace weak substring checks with stronger structural or execution-based checks where possible.
5. Split large mixed-skill tasks into narrower cases if failures are hard to interpret.

## Prerequisites

Inspect `evals/code-generation.json`, `evaluators/index.mjs`, and `traces/` before proposing metric changes. Determine whether the current failures reflect bad code, bad assertions, or tasks that are too broad.

## Core Instructions

### Separate Types Of Coding Failure

Classify each failure as one of:

- syntax or parse failure
- instruction-following failure
- partial but semantically incorrect solution
- correct logic with wrong format
- evaluator false positive or false negative

### Strengthen Weak Assertions

Current `contains` checks may allow obviously bad code to pass. Prefer:

- exact function name checks
- parser-based validation
- execution-based validation
- minimal unit tests

Use LLM judges only when the requirement is subjective and deterministic scoring is impractical.

### Keep Tasks Narrow

A good coding eval usually measures one dominant skill:

- implement a function
- fix a bug
- produce valid SQL
- follow a formatting constraint

If a task mixes too many constraints, a failure becomes hard to diagnose.

### Read Traces Before Rewriting The Suite

Inspect whether a model:

- returned explanations when code-only was required
- used the wrong interface but correct logic
- matched substrings without solving the task
- solved the task but failed a brittle assertion

### Repo Files To Inspect

- `evals/code-generation.json`
- `run-eval.mjs`
- `evaluators/index.mjs`
- `traces/`

## Anti-Patterns

- Treating substring presence as proof of correctness.
- Using subjective judging for deterministic programming tasks.
- Ignoring syntax or execution failures.
- Combining implementation, refactoring, explanation, and formatting into one eval case.
- Expanding the suite without first reading traces.
