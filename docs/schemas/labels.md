# Human Label Schema

Human labels are the source of truth for judge validation and failure-mode analysis.
Promoted labels become static judge-replay eval cases: the stored `response` is evaluated by the selected judge and compared with `human_pass`.

Required fields:

- `id`: stable label identifier
- `prompt`: user prompt or task input
- `response`: model response being judged
- `human_pass`: `true` or `false`
- `critique`: human explanation for the pass/fail judgment

Recommended fields:

- `source_trace_id`: trace ID the example came from
- `suite`: eval suite or product area
- `reference_answer`: optional gold/reference answer for reference-based judge templates
- `failure_mode`: root failure class, such as `hallucination`, `retrieval_error`, `formatting_issue`, or `tool_argument_error`
- `feature`: product feature being evaluated
- `scenario`: situation being tested
- `persona`: user/persona segment, when relevant
- `reviewer`: reviewer identifier
- `reviewed_at`: ISO timestamp
- `reviewer_labels`: optional array of reviewer-specific labels for human-human agreement measurement

Compatibility notes:

- `app.html` exports only reviewed records that have both a human outcome and a non-empty critique. Pending rows are intentionally excluded because they are not valid gold labels.
- In CSV, `reviewer_labels` is stored as a JSON string containing reviewer-specific labels.
- CSV headers are normalized when imported, so manual-review columns such as `Model response`, `Human outcome`, and `Human critique` are accepted as aliases for `response`, `human_pass`, and `critique`.
- Alias support does not remove the required fields. Manual-review CSVs still need a `prompt` column to become valid gold labels.
- Store only sanitized public labels under `labels/`. Keep private, customer-specific, or calibration labels under `labels/private/` or outside the repository.
- When `reviewer_labels` is present, the loader aggregates reviewer votes into `human_pass` if `human_pass` is not already set. Ties remain invalid until resolved.

CSV exports from `app.html` use this schema so they can be consumed by:

- `scripts/promote-labels-to-eval.mjs`
- `scripts/validate-evaluator.mjs`
- `scripts/error-analysis.mjs`
- `scripts/monitor-traces.mjs`
