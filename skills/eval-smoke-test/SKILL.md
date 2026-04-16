---
name: eval-smoke-test
description: >
  Guides fast sanity-checking of the eval pipeline.
  Use when the repo seems broken, CI is failing, provider setup is uncertain,
  or you need to distinguish runner issues from evaluator or dataset issues.
---

# Eval Smoke Test

## Overview

1. Verify provider availability and selected model configuration before changing eval logic.
2. Run the smallest suite first: `evals/quick-test.json`.
3. Separate provider failures, runner failures, evaluator failures, and bad assertions.
4. Re-run with `--skip-judge` to isolate judge-related failures from core pipeline failures.
5. Read traces before editing the suite or the workflow.

## Prerequisites

Confirm at least one provider is configured. Inspect `run-eval.mjs`, `evaluators/index.mjs`, `.github/workflows/eval.yml`, and `evals/quick-test.json` before making changes. If CI is failing, verify whether the failure is in provider setup, model selection, or test logic.

## Core Instructions

### Start With The Smallest Working Surface

Use the repo’s smoke suite first:

```bash
node run-eval.mjs evals/quick-test.json
node run-eval.mjs --skip-judge evals/quick-test.json
```

If needed, run against one explicit hosted provider:

```bash
node run-eval.mjs --provider openai --model gpt-5.4-mini evals/quick-test.json
```

### Classify The First Failure

Determine which layer fails first:

- **Provider failure:** missing API key, unavailable local model, invalid model ID
- **Runner failure:** CLI parsing, provider selection, trace writing, output generation
- **Evaluator failure:** scoring logic, parsing logic, incorrect judge behavior
- **Dataset/assertion failure:** the model output is reasonable but the assertion is wrong or too brittle

### Use `--skip-judge` As A Diagnostic Tool

`--skip-judge` is useful for smoke tests because it removes judge-model dependence while keeping deterministic checks active. If deterministic checks pass but full runs fail, the likely problem is judge configuration or judge prompt design rather than the main eval runner.

### Inspect Traces Before Editing

Read `traces/` outputs and compare:

- prompt
- model response
- parsed evaluation result
- error type

Do not strengthen or weaken assertions before looking at what the model actually returned.

### Repo Files To Inspect

- `evals/quick-test.json`
- `run-eval.mjs`
- `evaluators/index.mjs`
- `providers/`
- `.github/workflows/eval.yml`
- `traces/`

## Anti-Patterns

- Starting with the largest benchmark instead of the smoke test.
- Treating missing credentials as model regressions.
- Debugging judge quality before confirming basic execution works.
- Editing assertions before reading traces.
- Adding more test cases before the pipeline is stable.
