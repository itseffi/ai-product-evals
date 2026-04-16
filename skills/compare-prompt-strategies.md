---
name: compare-prompt-strategies
description: >
  Guides comparison of prompt and system-prompt variants.
  Use when testing prompt strategies, comparing structured versus concise prompts,
  or deciding whether a prompt change improves behavior without overfitting.
---

# Compare Prompt Strategies

## Overview

1. Hold the task constant and vary only the prompt strategy.
2. Start from `evals/prompt-variants.json`.
3. Measure whether prompt changes improve task behavior, not just one formatting rule.
4. Use traces to understand how the prompt changed model behavior.
5. Expand the suite if one prompt only wins on narrow or cherry-picked cases.

## Prerequisites

Inspect `evals/prompt-variants.json`, `ab-test.mjs`, `run-eval.mjs`, and recent traces before changing prompts. Confirm that the compared variants represent meaningful product choices rather than superficial wording changes.

## Core Instructions

### Run Prompt Variants Fairly

Use one provider/model across all prompt variants.

Example:

```bash
node run-eval.mjs evals/prompt-variants.json
node run-eval.mjs --provider openai --model gpt-5.4-mini evals/prompt-variants.json
```

### Evaluate Real Behavior Changes

Check whether the prompt changes:

- compliance with required format
- clarity
- brevity
- domain tone
- completeness

Do not declare success only because a prompt produced a preferred writing style.

### Review Traces To Understand Why A Prompt Won

Trace review should answer:

- did the prompt reduce ambiguity?
- did it overconstrain the answer?
- did it improve one behavior while hurting another?
- did it cause longer, slower, or more evasive responses?

### Strengthen Coverage If Needed

Add cases that include:

- easy tasks
- edge cases
- instruction-following cases
- format-sensitive cases

Prompt experiments are weak if all examples reward only one response style.

### Repo Files To Inspect

- `evals/prompt-variants.json`
- `ab-test.mjs`
- `run-eval.mjs`
- `evaluators/index.mjs`
- `traces/`

## Anti-Patterns

- Comparing prompt variants across different models.
- Using only one or two examples.
- Choosing a prompt winner without trace review.
- Confusing verbosity with quality.
- Measuring prompt quality with assertions that any output can satisfy.
