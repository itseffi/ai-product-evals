# AI Product Evals

Purpose-built for humans and AI coding agents.

Core components:

- provider-agnostic eval suites in `evals/`
- a CLI runner in `run-eval.mjs`
- trace logging in `traces/`
- a browser review interface in `app.html`
- repo-local skills in `skills/` that guide agents to build, debug, and improve evals
- Claude-compatible skill exposure in `.claude/skills/`
- a reusable Codex plugin in `plugins/ai-product-evals/`

## Start Here

If you are new to this repo, start with the skills layer rather than jumping straight into the code.

For an AI coding agent:

1. Run `npm run skill:eval-audit`
2. If traces exist, run `npm run skill:error-analysis`
3. Follow the routing guide in [AGENT_EVALS.md](AGENT_EVALS.md)
4. Use the matching skill from `skills/`

For a human:

```bash
npm install
node run-eval.mjs evals/quick-test.json
npm run skill:eval-audit
```

If you want a fast smoke test against a hosted provider:

```bash
node run-eval.mjs --provider openai --model gpt-5.5 evals/quick-test.json
```

## Why This Repo Exists

Most eval repos are good at one thing only: running tests.

This repo is built to support the full eval workflow:

1. Define evals
2. Run them across models/providers
3. Capture traces
4. Review failures
5. Use skills to improve the eval pipeline itself

That is why the `skills/` directory is a first-class part of the repo.

## Skills

The most important addition in this repo is the skills layer.

These skills guide AI coding agents to help you build and improve LLM evaluations. They are not eval files. They are workflow instructions for agents.

Current skills:

- [skills/eval-smoke-test.md](skills/eval-smoke-test.md)
- [skills/error-analysis.md](skills/error-analysis.md)
- [skills/benchmark-models.md](skills/benchmark-models.md)
- [skills/compare-prompt-strategies.md](skills/compare-prompt-strategies.md)
- [skills/evaluate-code-generation.md](skills/evaluate-code-generation.md)
- [skills/evaluate-rag.md](skills/evaluate-rag.md)
- [skills/evaluate-tool-use.md](skills/evaluate-tool-use.md)
- [skills/generate-synthetic-data.md](skills/generate-synthetic-data.md)
- [skills/write-judge-prompt.md](skills/write-judge-prompt.md)
- [skills/validate-evaluator.md](skills/validate-evaluator.md)
- [skills/propose-judge-patch.md](skills/propose-judge-patch.md)
- [skills/build-review-interface.md](skills/build-review-interface.md)

Use [AGENT_EVALS.md](AGENT_EVALS.md) to decide which skill to use first.

## Agent Integrations

This repo exposes the same skills through three paths:

- `skills/*.md` as the source of truth in the repo
- `.claude/skills/` for Claude-compatible skill loading
- `plugins/ai-product-evals/` for the Codex plugin package

The skill content stays in sync because the Claude layer points at the same underlying skill folders, and the Codex plugin bundles the same skill set.

## Helper Scripts

These scripts make the skills more operational for agents:

```bash
# Structural audit of the eval repo
npm run skill:eval-audit
npm run skill:eval-audit:json

# Analyze the latest trace
npm run skill:error-analysis
npm run skill:error-analysis:json

# Analyze a specific trace
node scripts/error-analysis.mjs <trace-id-or-trace-filename>
node scripts/error-analysis.mjs <trace-id-or-trace-filename> --json

# Validate an LLM judge against human labels
npm run skill:validate-evaluator
npm run skill:validate-evaluator:json

# Check position/verbosity bias in pairwise judges
npm run skill:judge-bias-check
npm run skill:judge-bias-check:json

# Draft a reviewable judge-template patch from validation disagreements
npm run skill:propose-judge-patch
npm run skill:propose-judge-patch:json

# Promote reviewed labels into static judge-replay eval cases
node scripts/promote-labels-to-eval.mjs labels/sample-goldens.json -o evals/promoted-from-labels.json

# Summarize recent trace trends
npm run skill:monitor
npm run skill:monitor:json
```

Use markdown output for humans and JSON output for agents or automation.

## Core Workflow

The recommended repo workflow is:

1. Start with `skills/eval-smoke-test.md` if the pipeline seems broken.
2. Run an eval suite from `evals/`.
3. Inspect traces in `traces/`.
4. Run `npm run skill:error-analysis`.
5. Review and label important traces with pass/fail judgments and critiques.
6. Promote labels into eval cases when they represent durable product expectations.
7. Validate judge-based scoring against human labels before trusting it.
8. Use a domain-specific skill such as `evaluate-rag` or `evaluate-tool-use`.

## Human Labels And Judge Validation

Human labels are first-class artifacts in this repo. Store reviewed examples in `labels/` using the schema documented in [docs/schemas/labels.md](docs/schemas/labels.md).

The minimum valid label contains:

- `id`
- `prompt`
- `response`
- `human_pass`
- `critique`

Recommended labels also include `failure_mode`, `feature`, `scenario`, `persona`, and `source_trace_id`. These fields let `scripts/error-analysis.mjs` produce pivot-style summaries that prioritize the most common failure modes.

Use:

```bash
node scripts/validate-evaluator.mjs labels/sample-goldens.json
node scripts/validate-evaluator.mjs labels/sample-goldens.json --repeat 5
node scripts/validate-evaluator.mjs labels/sample-goldens.json --judge-panel openai:gpt-5.5,anthropic:claude-haiku-4-5
node scripts/validate-evaluator.mjs labels/sample-goldens.json --repeat 5 --min-agreement 0.9 --min-stability 1
node scripts/validate-evaluator.mjs labels/sample-goldens.json --write-baseline reports/judge-baseline.json
node scripts/validate-evaluator.mjs labels/sample-goldens.json --drift-baseline reports/judge-baseline.json
node scripts/validate-evaluator.mjs labels/sample-goldens.json --stream-jsonl reports/validator-events.jsonl
mkdir -p reports
node scripts/validate-evaluator.mjs labels/sample-goldens.json --json > reports/evaluator-validation.json
node scripts/propose-judge-patch.mjs reports/evaluator-validation.json --judge-template rag-quality --output reports/proposed-judge.patch
node scripts/promote-labels-to-eval.mjs labels/sample-goldens.json -o evals/promoted-from-labels.json
```

Judge prompts live in `judges/`. Prefer suite-specific templates such as `rag-quality`, `rag-faithfulness`, `code-correctness`, and `tool-choice` over generic criteria.
Use `--repeat` when validating judges to detect unstable verdicts across repeated calls. Validation reports raw agreement, stability, and Cohen's kappa; prefer kappa when the label set is imbalanced. Use `--write-baseline` to save a known-good validation report, then use `--drift-baseline` to compare later runs against it. The validator exits nonzero when agreement/stability thresholds are missed, provider calls fail, parse failures occur, or drift exceeds the configured baseline drop. Use `--judge-panel` when you want a majority vote across multiple judge models.

## Running Evals

Basic usage:

```bash
# Run a suite with the default available provider
node run-eval.mjs evals/quick-test.json

# Probe a suite without calling model providers
node run-eval.mjs evals/quick-test.json --dry-run --format json

# Run a suite against a specific provider/model
node run-eval.mjs --provider openai --model gpt-5.5 evals/llm-comparison.json
node run-eval.mjs --provider anthropic --model claude-haiku-4-5 evals/agent-tools.json
node run-eval.mjs --provider google --model gemini-2.5-flash evals/rag-pipeline.json

# Run in parallel
node run-eval.mjs --parallel evals/llm-comparison.json

# Run repeated trials for reliability metrics
node run-eval.mjs --repeat 5 evals/llm-comparison.json

# Agent-safe long-run controls
node run-eval.mjs evals/llm-comparison.json --max-calls 5
node run-eval.mjs evals/llm-comparison.json --max-cost 5 --max-call-cost 0.25
node run-eval.mjs evals/llm-comparison.json --stream-jsonl reports/run-events.jsonl

# Export results
node run-eval.mjs --format csv -o results.csv evals/quick-test.json
node run-eval.mjs --format json -o results.json evals/quick-test.json
node run-eval.mjs --format jsonl -o results.jsonl evals/quick-test.json

# Compare against a previous trace
node run-eval.mjs --compare <trace-id> evals/llm-comparison.json

# List providers
node run-eval.mjs --list-providers

# View run history
node run-eval.mjs --history
```

### Important Behavior

- Eval JSON files are provider-agnostic by default.
- `models` in an eval file is optional.
- If `models` is omitted, the runner uses:
  - `--provider` / `--model` if passed
  - otherwise the default available provider and its default model
- `--skip-judge` reports judge-based cases as skipped. Deterministic checks still run.

## Included Eval Suites

Current suites:

- `evals/quick-test.json`
  Fast sanity suite for runner behavior

- `evals/llm-comparison.json`
  Shared benchmark for comparing models/providers

- `evals/prompt-variants.json`
  Prompt strategy comparison suite

- `evals/code-generation.json`
  Coding benchmark suite

- `evals/rag-pipeline.json`
  Retrieval-augmented generation suite

- `evals/agent-tools.json`
  Tool-use and agent-routing suite

- `evals/judge-bias-checks.json`
  Public synthetic checks for position and verbosity bias in pairwise judges

## Evaluation Types

This repo supports:

- exact match
- contains
- regex
- tool-call matching
- JSON structure matching
- LLM-as-judge
- pairwise LLM judge
- semantic similarity
- safety checks
- unauthorized-action checks
- confidence calibration
- personalization response/context surface metrics
- RAG retrieval metrics
- RAG relationship metrics

Examples:

### Contains Check

```json
{ "prompt": "Name two evaluator validation error types.", "expected_contains": ["false positive", "false negative"] }
```

### Regex Match

```json
{ "prompt": "List 3 items numbered", "expected_regex": "1\\..*\\n2\\..*\\n3\\." }
```

### Tool Call Detection

```json
{ "prompt": "Open the evaluator implementation.", "expected_tool": "read_file", "expected_args": ["evaluators/index.mjs"] }
```

If a provider returns native tool calls, the evaluator scores those structured calls first. Text patterns such as `TOOL: read_file(evaluators/index.mjs)` are only a legacy fallback for prompt-only suites.

### LLM-as-Judge

```json
{ "prompt": "Explain transformers", "criteria": ["accuracy", "conciseness"] }
```

For reference-based judging:

```json
{
  "prompt": "What should happen when a judge provider fails?",
  "static_response": "The result should be treated as an evaluator infrastructure failure.",
  "reference_answer": "Judge provider failures must not count as agreement with human labels.",
  "eval_type": "llm_judge",
  "judge_template": "reference-correctness"
}
```

### Pairwise Judge

```json
{
  "eval_type": "pairwise_judge",
  "prompt": "Should a RAG assistant answer from world knowledge when context is empty?",
  "response_a": "No. It should say the answer is not available in the supplied context.",
  "response_b": "Yes. It should answer if the model knows the answer.",
  "expected_winner": "A"
}
```

Use `order: "BA"` to show the same canonical responses in reversed display order and check position bias. Use `expected_winner: "TIE"` for equivalent answers where verbosity should not be rewarded.

### Semantic Similarity

```json
{ "prompt": "Explain ML", "expected_semantic": "Machine learning is...", "eval_type": "semantic_similarity" }
```

### Safety Check

```json
{ "prompt": "Test prompt", "safety_check": true, "eval_type": "safety" }
```

### Reliability Checks

Use `--repeat N` to run each case multiple times. Reports include `pass@K`, consistency, unauthorized-failure count, recovery rate when `metadata.recovery_expected` is set, and safety-weighted failures when `safety_weight` or `failure_weight` is set.

Add `paraphrases` to a test case to measure prompt robustness across equivalent inputs:

```json
{
  "prompt": "Summarize the incident impact.",
  "paraphrases": ["What user impact did the incident have?"],
  "expected_contains": ["impact"]
}
```

### Unauthorized Action

```json
{
  "prompt": "Draft a migration plan. Do not execute anything.",
  "eval_type": "unauthorized_action",
  "unauthorized_patterns": ["executed migration", "deleted table"]
}
```

### Confidence Calibration

```json
{
  "prompt": "Return JSON with answer and confidence.",
  "eval_type": "confidence_calibration",
  "expected_confidence": 0.8,
  "confidence_tolerance": 0.15
}
```

### Personalization Surface Metrics

Response-side metrics check coverage, precision, salience, integration, and filtering:

```json
{
  "prompt": "Recommend a plan for a price-sensitive admin user.",
  "eval_type": "personalization_response",
  "response_surface": {
    "coverage": ["admin user", "price-sensitive"],
    "forbidden": ["enterprise-only"],
    "salience": ["budget"],
    "filtering": ["irrelevant add-on"]
  }
}
```

Context-side metrics check context completeness, relevance, consistency, freshness, and counterfactual coverage:

```json
{
  "eval_type": "personalization_context",
  "prompt": "Check user context quality.",
  "context": "persona: admin user; budget: low; plan: team",
  "context_surface": {
    "completeness": ["persona", "budget"],
    "irrelevant": ["consumer gaming"],
    "stale": ["expired plan"]
  }
}
```

### RAG Retrieval

```json
{
  "eval_type": "rag_retrieval",
  "question": "What changed in React 18 automatic batching?",
  "retrieved_context_ids": ["react-18-batching", "postgres-16"],
  "expected_relevant_context_ids": ["react-18-batching"],
  "k": 2
}
```

RAG retrieval reports `Recall@k`, `Precision@k`, and `MRR`. RAG generation can use relationship eval types such as `rag_context_relevance`, `rag_faithfulness`, `rag_answer_relevance`, `rag_context_support`, `rag_answerability`, and `rag_self_containment`.
For end-to-end RAG answer judging, use the `rag-quality` judge template.

## Traces

Normal executed eval runs write traces to `traces/`. Metadata-only commands such as `--dry-run`, `--list-providers`, `--history`, and `--clear-cache` do not write traces.

Traces are the main debugging artifact in this repo. They are used by:

- humans inspecting failures
- `app.html`
- `scripts/error-analysis.mjs`
- the agent skills, especially `error-analysis`, `evaluate-rag`, and `evaluate-tool-use`

Each trace captures:

- eval name
- config
- per-test result
- prompt and system prompt
- model/provider
- pass/fail
- score
- reasoning string
- raw response text or error

## Review Interface

Open `app.html` in a browser to review traces and human-label outputs.

The review interface supports:

- browsing traces
- filtering records
- comparing model versus human outcomes
- annotating failures
- exporting labeled data in the repo gold-label schema

If you want to improve this workflow, use [skills/build-review-interface.md](skills/build-review-interface.md).

## A/B Testing

Use `ab-test.mjs` to compare prompt strategies or variants.

Example:

```javascript
import { runABTest, generateABReport } from './ab-test.mjs';

const results = await runABTest({
  name: 'RAG Refusal Prompt Comparison',
  variantA: { name: 'Strict Grounding', system_prompt: 'Answer only from supplied context.' },
  variantB: { name: 'Helpful Default', system_prompt: 'Answer helpfully and mention uncertainty.' },
  testCases: [
    { prompt: 'The context is empty. Should the assistant answer from prior knowledge?', expected_contains: ['no'] },
  ],
  models: [{ model: 'gpt-5.5' }],
});

console.log(generateABReport(results));
```

## Multi-Turn Conversations

Use `multi-turn.mjs` for conversation-style evals. It supports scripted environment state through `environment.state`, `before_events`, `after_events`, `user_template` placeholders like `{{state.account.plan}}`, injected failures with `inject_failure`, and state assertions with `expected_state` or `state_assertions`.

Example:

```javascript
import { runConversation } from './multi-turn.mjs';

const result = await runConversation({
  name: 'Customer Support',
  system_prompt: 'You are a helpful customer support agent.',
  environment: { state: { account: { email_sent: false } } },
  turns: [
    {
      user: 'I forgot my password',
      expected_contains: ['reset'],
      after_events: [{ op: 'set', path: 'account.email_sent', value: true }],
      expected_state: { 'account.email_sent': true }
    },
    { user_template: 'The email state is {{state.account.email_sent}}, but I never received it.', expected_contains: ['spam', 'check'] },
  ],
}, provider);
```

## Dataset Formats

### JSON

```json
{
  "name": "My Eval",
  "test_cases": [{ "prompt": "...", "expected": "..." }]
}
```

### CSV

```csv
name,prompt,expected,expected_contains,system_prompt,max_tokens
Grounded Refusal,The supplied context is empty. Should a RAG assistant answer from prior knowledge?,No,,Answer concisely.,100
Validation Metrics,Name two evaluator validation counts.,,false positive|false negative,,200
```

### JSONL

```jsonl
{"name": "Grounded Refusal", "prompt": "The supplied context is empty. Should a RAG assistant answer from prior knowledge?", "expected": "No"}
{"name": "Validation Metrics", "prompt": "Name two evaluator validation counts.", "expected_contains": ["false positive", "false negative"]}
```

## CI/CD

GitHub Actions workflow:

- runs on push to `main` / `master`
- runs on PRs
- supports scheduled comparisons
- uses structured JSON reports for threshold checks
- skips provider jobs cleanly when matching secrets are absent
- uses explicit provider/model targets for hosted CI runs

Main workflow file:

- `.github/workflows/eval.yml`

Expected secrets:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `OPENROUTER_API_KEY`

## Environment Variables

```bash
# Providers
OLLAMA_BASE_URL=http://localhost:11434
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
OPENROUTER_API_KEY=...

# Defaults
# Choose a provider that is actually available in your environment.
# The default provider and judge provider can be the same.
DEFAULT_PROVIDER=openai
JUDGE_PROVIDER=openai
JUDGE_MODEL=gpt-5.5
JUDGE_PANEL=openai:gpt-5.5,anthropic:claude-haiku-4-5
JUDGE_MIN_AGREEMENT=0.9
JUDGE_MIN_STABILITY=1
JUDGE_MAX_AGREEMENT_DROP=0.05
JUDGE_MAX_STABILITY_DROP=0.05
# Local Ollama judges are opt-in because they are easy to misconfigure.
ALLOW_LOCAL_JUDGE=false

# Performance
PARALLEL_LIMIT=3
MAX_RETRIES=2
RETRY_DELAY_MS=1000
EVAL_TIMEOUT_MS=180000
MAX_CALLS=20
MAX_COST_PER_RUN_USD=5
MAX_COST_PER_CALL_USD=0.25
STREAM_JSONL_OUTPUT=reports/run-events.jsonl

# Caching
USE_CACHE=true
CACHE_TTL_MS=86400000
```

## Response Caching

Responses are cached in `.cache/`.

```bash
node run-eval.mjs --no-cache evals/quick-test.json
node run-eval.mjs --clear-cache
```

## Cost Tracking

Cost is reported as approximate metadata only.

## Project Structure

```text
ai-product-evals/
├── AGENT_EVALS.md        # Skill routing guide for agents
├── skills/               # Agent-facing eval skills and source-of-truth content
├── .claude/skills/       # Claude-compatible skill exposure
├── plugins/ai-product-evals/  # Codex plugin package
├── scripts/              # Helper scripts for skills
├── evals/                # Eval suites
├── run-eval.mjs          # Main eval runner
├── evaluators/           # Scoring logic
├── providers/            # Provider integrations
├── tracer.mjs            # Trace storage and comparison
├── traces/               # Saved traces
├── app.html              # Human review UI
├── ab-test.mjs           # Prompt-variant testing
├── multi-turn.mjs        # Conversation testing
├── dataset.mjs           # Dataset import/export
├── cache.mjs             # Response caching
├── rate-limiter.mjs      # Rate limiting
├── similarity.mjs        # Semantic similarity
├── safety.mjs            # Safety checks
└── .github/workflows/    # CI
```

## Built For

- running evals across providers and models
- debugging failures from traces
- improving prompt, RAG, tool-use, and code-generation evals
- helping AI coding agents work effectively on eval pipelines

## Extended By Skills

The skills layer helps agents:

- audit the eval pipeline
- analyze failures
- design judge prompts
- validate evaluators
- expand coverage with synthetic data
- improve review interfaces

## License

MIT
