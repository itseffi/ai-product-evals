---
name: propose-judge-patch
description: Drafts a reviewable judge-template patch from evaluator validation disagreements.
---

# Propose Judge Patch

Use this after evaluator validation has produced a JSON report with disagreements.

```bash
node scripts/validate-evaluator.mjs labels/sample-goldens.json --json > reports/evaluator-validation.json
node scripts/propose-judge-patch.mjs reports/evaluator-validation.json --judge-template rag-quality --output reports/proposed-judge.patch
```

The script is deterministic. It does not call a model and does not edit judge templates directly. Inspect the patch, apply only the clauses that match the labeled failures, then rerun validation.
