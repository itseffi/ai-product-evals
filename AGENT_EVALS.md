# Agent Evals Router

Use this file to decide which eval skill to apply first in this repository.

## Start Here

1. If the repo or CI is broken, start with `skills/eval-smoke-test.md`.
2. If evals are failing but the repo runs, start with `skills/error-analysis.md`.
3. If the task is domain-specific, route to the matching skill after error analysis.

## Skill Routing

### Pipeline broken or CI red

Use:

- `skills/eval-smoke-test.md`

Then:

- run `npm run skill:eval-audit`
- if traces exist, run `npm run skill:error-analysis`
- to inspect a specific trace, run `node scripts/error-analysis.mjs <trace-id>`

### Model benchmarking or provider comparison

Use:

- `skills/benchmark-models.md`

Primary suite:

- `evals/llm-comparison.json`

### Prompt experiments

Use:

- `skills/compare-prompt-strategies.md`

Primary suite:

- `evals/prompt-variants.json`

### Code-generation evaluation

Use:

- `skills/evaluate-code-generation.md`

Primary suite:

- `evals/code-generation.json`

### RAG evaluation

Use:

- `skills/evaluate-rag.md`

Primary suite:

- `evals/rag-pipeline.json`

### Tool-use evaluation

Use:

- `skills/evaluate-tool-use.md`

Primary suite:

- `evals/agent-tools.json`

### Judge design or judge debugging

Use in sequence:

1. `skills/write-judge-prompt.md`
2. `skills/validate-evaluator.md`

### Expanding dataset coverage

Use:

- `skills/generate-synthetic-data.md`

### Improving human labeling workflows

Use:

- `skills/build-review-interface.md`

Primary surface:

- `app.html`

## Helper Scripts

These scripts provide lightweight entrypoints for agents:

- `npm run skill:eval-audit`
- `npm run skill:eval-audit:json`
- `npm run skill:error-analysis`
- `npm run skill:error-analysis:json`

For a specific trace:

- `node scripts/error-analysis.mjs <trace-id>`
- `node scripts/error-analysis.mjs <trace-id> --json`

They are not complete replacements for the skills. Use them to gather structure, then follow the matching skill.
