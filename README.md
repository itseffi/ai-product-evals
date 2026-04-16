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
3. Follow the routing guide in [AGENT_EVALS.md](/Users/effi/Projects/ai-product-evals-main/AGENT_EVALS.md:1)
4. Use the matching skill from `skills/`

For a human:

```bash
npm install
node run-eval.mjs evals/quick-test.json
npm run skill:eval-audit
```

If you want a fast smoke test against a hosted provider:

```bash
node run-eval.mjs --provider openai --model gpt-5.4 evals/quick-test.json
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

- [skills/eval-smoke-test.md](/Users/effi/Projects/ai-product-evals-main/skills/eval-smoke-test.md:1)
- [skills/error-analysis.md](/Users/effi/Projects/ai-product-evals-main/skills/error-analysis.md:1)
- [skills/benchmark-models.md](/Users/effi/Projects/ai-product-evals-main/skills/benchmark-models.md:1)
- [skills/compare-prompt-strategies.md](/Users/effi/Projects/ai-product-evals-main/skills/compare-prompt-strategies.md:1)
- [skills/evaluate-code-generation.md](/Users/effi/Projects/ai-product-evals-main/skills/evaluate-code-generation.md:1)
- [skills/evaluate-rag.md](/Users/effi/Projects/ai-product-evals-main/skills/evaluate-rag.md:1)
- [skills/evaluate-tool-use.md](/Users/effi/Projects/ai-product-evals-main/skills/evaluate-tool-use.md:1)
- [skills/generate-synthetic-data.md](/Users/effi/Projects/ai-product-evals-main/skills/generate-synthetic-data.md:1)
- [skills/write-judge-prompt.md](/Users/effi/Projects/ai-product-evals-main/skills/write-judge-prompt.md:1)
- [skills/validate-evaluator.md](/Users/effi/Projects/ai-product-evals-main/skills/validate-evaluator.md:1)
- [skills/build-review-interface.md](/Users/effi/Projects/ai-product-evals-main/skills/build-review-interface.md:1)

Use [AGENT_EVALS.md](/Users/effi/Projects/ai-product-evals-main/AGENT_EVALS.md:1) to decide which skill to use first.

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
node scripts/error-analysis.mjs <trace-id>
node scripts/error-analysis.mjs <trace-id> --json
```

Use markdown output for humans and JSON output for agents or automation.

## Core Workflow

The recommended repo workflow is:

1. Start with `skills/eval-smoke-test.md` if the pipeline seems broken.
2. Run an eval suite from `evals/`.
3. Inspect traces in `traces/`.
4. Run `npm run skill:error-analysis`.
5. Use a domain-specific skill such as `evaluate-rag` or `evaluate-tool-use`.
6. If using judge-based scoring, use `write-judge-prompt` and `validate-evaluator`.

## Running Evals

Basic usage:

```bash
# Run a suite with the default available provider
node run-eval.mjs evals/quick-test.json

# Run a suite against a specific provider/model
node run-eval.mjs --provider openai --model gpt-5.4 evals/llm-comparison.json
node run-eval.mjs --provider anthropic --model claude-haiku-4-5 evals/agent-tools.json
node run-eval.mjs --provider google --model gemini-2.5-flash evals/rag-pipeline.json

# Run in parallel
node run-eval.mjs --parallel evals/llm-comparison.json

# Export results
node run-eval.mjs --format csv -o results.csv evals/quick-test.json
node run-eval.mjs --format json -o results.json evals/quick-test.json

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
- `--skip-judge` skips judge-based scoring only. Deterministic checks still run.

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

- `evals/example.csv`
  Example CSV dataset, useful for import/export testing

## Evaluation Types

This repo supports:

- exact match
- contains
- regex
- tool-call matching
- JSON structure matching
- LLM-as-judge
- semantic similarity
- safety checks

Examples:

### Contains Check

```json
{ "prompt": "List languages", "expected_contains": ["Python", "JavaScript"] }
```

### Regex Match

```json
{ "prompt": "List 3 items numbered", "expected_regex": "1\\..*\\n2\\..*\\n3\\." }
```

### Tool Call Detection

```json
{ "prompt": "Weather in Tokyo?", "expected_tool": "get_weather", "expected_args": ["Tokyo"] }
```

### LLM-as-Judge

```json
{ "prompt": "Explain transformers", "criteria": ["accuracy", "conciseness"] }
```

### Semantic Similarity

```json
{ "prompt": "Explain ML", "expected_semantic": "Machine learning is...", "eval_type": "semantic_similarity" }
```

### Safety Check

```json
{ "prompt": "Test prompt", "safety_check": true, "eval_type": "safety" }
```

## Traces

Every eval run writes a trace to `traces/`.

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
- exporting labeled data

If you want to improve this workflow, use [skills/build-review-interface.md](/Users/effi/Projects/ai-product-evals-main/skills/build-review-interface.md:1).

## A/B Testing

Use `ab-test.mjs` to compare prompt strategies or variants.

Example:

```javascript
import { runABTest, generateABReport } from './ab-test.mjs';

const results = await runABTest({
  name: 'System Prompt Comparison',
  variantA: { name: 'Concise', system_prompt: 'Be brief.' },
  variantB: { name: 'Detailed', system_prompt: 'Think step by step...' },
  testCases: [
    { prompt: 'What is 2+2?', expected_contains: ['4'] },
  ],
  models: [{ model: 'gpt-5.4' }],
});

console.log(generateABReport(results));
```

## Multi-Turn Conversations

Use `multi-turn.mjs` for conversation-style evals.

Example:

```javascript
import { runConversation } from './multi-turn.mjs';

const result = await runConversation({
  name: 'Customer Support',
  system_prompt: 'You are a helpful customer support agent.',
  turns: [
    { user: 'I forgot my password', expected_contains: ['reset'] },
    { user: 'The email never arrived', expected_contains: ['spam', 'check'] },
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
Test 1,What is 2+2?,4,,Be brief.,100
Test 2,List languages,,Python|JavaScript,,200
```

### JSONL

```jsonl
{"name": "Test 1", "prompt": "What is 2+2?", "expected": "4"}
{"name": "Test 2", "prompt": "List languages", "expected_contains": ["Python"]}
```

## CI/CD

GitHub Actions workflow:

- runs on push to `main` / `master`
- runs on PRs
- supports scheduled comparisons
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
JUDGE_MODEL=gpt-5.4

# Performance
PARALLEL_LIMIT=3
MAX_RETRIES=2
RETRY_DELAY_MS=1000
EVAL_TIMEOUT_MS=180000

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
