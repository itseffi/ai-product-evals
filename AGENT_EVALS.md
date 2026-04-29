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
- to inspect a specific trace, run `node scripts/error-analysis.mjs <trace-id-or-trace-filename>`

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
3. `skills/propose-judge-patch.md` when validation disagreements indicate a rubric gap

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
- `npm run skill:validate-evaluator`
- `npm run skill:validate-evaluator:json`
- `npm run skill:judge-bias-check`
- `npm run skill:judge-bias-check:json`
- `npm run skill:propose-judge-patch`
- `npm run skill:propose-judge-patch:json`
- `npm run skill:monitor`
- `npm run skill:monitor:json`

For a specific trace:

- `node scripts/error-analysis.mjs <trace-id-or-trace-filename>`
- `node scripts/error-analysis.mjs <trace-id-or-trace-filename> --json`

They are not complete replacements for the skills. Use them to gather structure, then follow the matching skill.

## Calibrated Eval Workflow

For judge-based work, do not start by tuning the judge prompt. Use this order:

1. Run the relevant eval suite.
2. Inspect traces manually.
3. Label representative examples with `human_pass` and `critique`.
4. Save only sanitized public labels under `labels/` using `docs/schemas/labels.md`. Keep private or calibration labels under `labels/private/` or outside the repo.
5. Run `node scripts/validate-evaluator.mjs labels/<your-label-file>.json --repeat 5 --min-agreement 0.9 --min-stability 1`.
6. Run `npm run skill:judge-bias-check` for pairwise or subjective judges.
7. If validation has disagreements, run `scripts/propose-judge-patch.mjs` to draft a reviewable judge-template patch.
8. Promote durable labels into eval cases with `scripts/promote-labels-to-eval.mjs`.
9. Only then refine judge templates in `judges/`.

Prefer suite-specific judge templates over generic criteria. Keep the generic judge as a fallback only.

## Agent-Safe Runner Controls

Use these before long or expensive runs:

- `node run-eval.mjs evals/quick-test.json --dry-run --format json`
- `node run-eval.mjs evals/quick-test.json --max-calls 3`
- `node run-eval.mjs evals/quick-test.json --stream-jsonl reports/run-events.jsonl`
- `node run-eval.mjs evals/quick-test.json --max-cost 5 --max-call-cost 0.25`
- `node run-eval.mjs evals/quick-test.json --repeat 5` for pass@K and consistency metrics

Use `paraphrases` in eval cases for robustness checks, `unauthorized_patterns` for unauthorized-action detection, `expected_confidence` for calibration checks, and `response_surface` / `context_surface` when personalization or context quality is the target.
