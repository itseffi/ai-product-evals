---
name: error-analysis
description: >
  Guides systematic analysis of eval failures using traces.
  Use when a suite is failing, model outputs seem inconsistent, evaluator behavior is suspect,
  or you need to classify failures before changing prompts, metrics, or datasets.
---

# Error Analysis

## Overview

1. Read traces before changing metrics, prompts, or model choices.
2. Group failures into stable categories rather than looking at them one by one.
3. Separate model failures, evaluator failures, provider failures, and dataset problems.
4. Quantify the dominant failure modes before proposing fixes.
5. Fix the highest-volume or highest-severity class first.

## Prerequisites

Run the relevant eval suite and collect traces. Inspect `traces/`, `run-eval.mjs`, `tracer.mjs`, and `evaluators/index.mjs` before proposing changes. If traces do not exist yet, run the smallest relevant suite first.

## Core Instructions

### Check Human-Labeled Pivots

Run:

```bash
npm run skill:error-analysis
```

If labels exist under `labels/`, the script includes pivots by `failure_mode`, `feature`, `scenario`, `persona`, and `suite`. Use those pivots to prioritize fixes before changing prompts or eval metrics.

### Start With Real Outputs

For the failing suite, inspect:

- the prompt
- the system prompt
- the raw model response
- the parsed evaluator result
- the reported reason for failure

Do not infer a failure category without reading the actual trace.

### Classify Failures Into Buckets

Use categories such as:

- provider/auth or transport error
- invalid model or request format
- no response or truncated response
- instruction-following failure
- factual error
- reasoning error
- formatting-only failure
- weak evaluator false positive
- evaluator false negative
- bad expected answer or bad dataset label

If a failure does not fit an existing bucket, add a new one rather than forcing it into the wrong class.

### Quantify Failure Modes

Count how many failures land in each category. A good fix targets the dominant class instead of optimizing for one memorable example.

### Separate Root Cause From Surface Symptom

Examples:

- A regex mismatch may actually be an instruction-following failure.
- A failed contains check may actually be a bad assertion.
- A hallucination may actually be missing retrieval context.
- A bad answer may actually be a provider-side parser issue.

### Repo Files To Inspect

- `traces/`
- `tracer.mjs`
- `run-eval.mjs`
- `evaluators/index.mjs`
- `evals/`
- `app.html`
- `labels/`
- `docs/schemas/labels.md`

## Anti-Patterns

- Changing the suite before reading traces.
- Fixing one anecdotal example instead of the dominant failure class.
- Treating evaluator mistakes as model mistakes.
- Treating infrastructure errors as quality regressions.
- Collapsing multiple root causes into one vague bucket like “bad output.”
