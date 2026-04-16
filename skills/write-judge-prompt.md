---
name: write-judge-prompt
description: >
  Guides design of LLM-as-judge prompts for subjective evaluation criteria.
  Use when deterministic checks are insufficient and you need a judge prompt
  for quality dimensions like helpfulness, faithfulness, clarity, or tone.
---

# Write Judge Prompt

## Overview

1. Use judge prompts only when deterministic checks are not enough.
2. Define the judgment criteria precisely before writing the prompt.
3. Ask the judge for structured outputs that can be parsed consistently.
4. Keep the scoring rubric narrow and behavior-based.
5. Validate the judge prompt against real examples before trusting it.

## Prerequisites

Confirm that deterministic evaluation is inadequate for the target behavior. Inspect `evaluators/index.mjs`, especially `llmJudge`, and read traces of real failures before designing the judge prompt.

## Core Instructions

### Start With A Narrow Rubric

Define the exact behavior being judged, such as:

- faithfulness to context
- relevance to query
- clarity
- conciseness
- professional tone

Avoid vague umbrella prompts like “judge overall quality.”

### Require Structured Output

Judge outputs should be easy to parse, for example:

```text
SCORE: [0-100]
PASS: [YES or NO]
REASON: [one sentence]
```

The parser should not rely on free-form prose.

### Use Behavior-Based Criteria

Describe what counts as success and failure in concrete terms. Good judge prompts refer to observable properties of the response, not abstract claims about “goodness.”

### Test Against Real Examples

Before trusting the judge:

- pass it obvious positives
- pass it obvious negatives
- pass it edge cases
- check whether it is stable across similar examples

### Repo Files To Inspect

- `evaluators/index.mjs`
- `run-eval.mjs`
- `evals/`
- `traces/`

## Anti-Patterns

- Using a judge when deterministic scoring is possible.
- Asking for unstructured natural-language reasoning only.
- Combining too many criteria in one rubric.
- Trusting a judge prompt without calibration.
- Treating judge output as ground truth without validation.
