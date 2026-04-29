---
name: propose-judge-patch
description: Drafts a reviewable judge-template patch from evaluator validation disagreements.
---

# Propose Judge Patch

Use this after `skills/validate-evaluator.md` has produced a JSON validation report with disagreements.

## Workflow

1. Run evaluator validation and save JSON:

```bash
node scripts/validate-evaluator.mjs labels/sample-goldens.json --json > reports/evaluator-validation.json
```

2. Propose a judge-template patch:

```bash
node scripts/propose-judge-patch.mjs reports/evaluator-validation.json --judge-template rag-quality --output reports/proposed-judge.patch
```

3. Inspect the patch before applying it.

The script is deterministic. It does not call a model and does not edit judge templates directly. It reads disagreement reasons and human critiques, infers likely rubric gaps, and writes a patch file for human or agent review.

## Guardrails

- Do not patch a judge from one or two weak examples unless the failure mode is obvious.
- Prefer adding concrete pass/fail clauses over rewriting the whole prompt.
- Re-run `scripts/validate-evaluator.mjs` after applying any judge-template change.
