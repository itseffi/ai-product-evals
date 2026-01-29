# AI Product Evals

- **Level 1: Unit Tests** - CLI for automated testing
- **Level 2: Model & Human Eval** - Web app for human review
- **Level 3: A/B Testing** - Compare prompt variants

## Features

- **Real evaluation scoring** - Pass/fail with reasons (exact match, contains, regex, tool call, LLM-as-judge)
- **Trace logging** - Every run saved to JSON for debugging and analysis
- **Trace Viewer UI** - Visual interface to browse and grade results
- **Parallel execution** - Run tests concurrently for faster results
- **Response caching** - Skip identical prompts to save time and cost
- **Rate limiting** - Automatic API rate limit handling
- **Auto-retry** - Exponential backoff on failures
- **History tracking** - Compare runs, detect regressions
- **A/B testing** - Compare prompt variants systematically
- **Multi-turn testing** - Test conversation flows
- **Semantic similarity** - Embeddings-based scoring
- **Safety checks** - Toxicity and PII detection
- **Dataset import** - Load from JSON, JSONL, or CSV
- **Multiple export formats** - Markdown, CSV, JSON
- **CI/CD ready** - GitHub Actions workflow included
- **Multi-provider** - Ollama, OpenAI, Anthropic, Google, OpenRouter

## Quick Start

```bash
npm install
cp .env.example .env   # Configure at least one provider
node run-eval.mjs evals/quick-test.json
```

## CLI Commands

```bash
# Run an eval
node run-eval.mjs evals/agent-tools.json

# Run in parallel (faster)
node run-eval.mjs --parallel evals/llm-comparison.json

# Load from CSV dataset
node run-eval.mjs evals/example.csv

# Export to CSV
node run-eval.mjs --format csv -o results.csv evals/quick-test.json

# View run history
node run-eval.mjs --history

# Compare against previous run
node run-eval.mjs --compare <trace-id> evals/agent-tools.json

# Skip LLM scoring (faster)
node run-eval.mjs --skip-judge evals/quick-test.json

# Override provider
node run-eval.mjs --provider openai evals/llm-comparison.json

# Clear response cache
node run-eval.mjs --clear-cache

# List available providers
node run-eval.mjs --list-providers

# Run A/B test (compare prompt variants)
node run-eval.mjs --ab-test evals/ab-test-config.json

# Run multi-turn conversation test
node run-eval.mjs --multi-turn evals/conversation-test.json
```

## LLM Data Review App (Level 2)

Open `app.html` in a browser for the full human review workflow:

**Dashboard:**
- LLM <> Human Agreement Rate chart
- Human Acceptance Rate chart
- Stats: Total Records, Pending, Agreement %, Acceptance %

**Review Workflow:**
- Upload traces (JSON) or labeled data (CSV)
- Filter by Tool, Scenario, Status, Source
- Navigate records with Previous/Next
- View Chat, Functions, Metadata tabs
- Add human critique
- Edit/revise model responses
- Accept or Reject with one click
- Download labeled data as CSV

**CSV Format (matches your template):**
```csv
Iteration,Model response,Model critique,Model outcome,Human critique,Human outcome,Human revised response,Agreement
1,"{...}","Nearly correct...",bad,"Agree...",bad,"{...}",TRUE
```

**Agreement Tracking:**
- `Agreement = TRUE` when Model outcome matches Human outcome
- Charts track agreement and acceptance rates over time

## Evaluation Types

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
*Requires `OPENAI_API_KEY` for embeddings (or Ollama with `nomic-embed-text` model)*

### Safety Check
```json
{ "prompt": "Test prompt", "safety_check": true, "eval_type": "safety" }
```
*Checks for toxicity, PII leakage, and prompt injection attempts*

## A/B Testing

Compare prompt variants:

```javascript
import { runABTest, generateABReport } from './ab-test.mjs';

const results = await runABTest({
  name: 'System Prompt Comparison',
  variantA: { name: 'Concise', system_prompt: 'Be brief.' },
  variantB: { name: 'Detailed', system_prompt: 'Think step by step...' },
  testCases: [
    { prompt: 'What is 2+2?', expected_contains: ['4'] },
  ],
  models: [{ model: 'qwen3:8b' }],
});

console.log(generateABReport(results));
```

## Multi-Turn Conversations

Test dialogue flows:

```javascript
import { runConversation } from './multi-turn.mjs';

const result = await runConversation({
  name: 'Customer Support',
  system_prompt: 'You are a helpful support agent.',
  turns: [
    { user: 'I forgot my password', expected_contains: ['reset'] },
    { user: 'The email never arrived', expected_contains: ['spam', 'check'] },
  ],
}, provider);
```

## Dataset Formats

### JSON (standard)
```json
{
  "name": "My Eval",
  "test_cases": [{ "prompt": "...", "expected": "..." }],
  "models": [{ "provider": "ollama", "model": "qwen3:8b" }]
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

## CI/CD Integration

GitHub Actions workflow included (`.github/workflows/eval.yml`):

- Runs on push to main
- Runs on PRs (comments results)
- Scheduled daily runs
- Compares models in parallel
- Fails PR if pass rate below threshold

Set these secrets in your repo:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`

## Response Caching

Responses are cached in `.cache/` to avoid re-running identical prompts:

```bash
# Disable caching for a run
node run-eval.mjs --no-cache evals/quick-test.json

# Clear all cached responses
node run-eval.mjs --clear-cache
```

Configure cache TTL in `.env`:
```bash
CACHE_TTL_MS=86400000  # 24 hours (default)
```

## Cost Tracking

Accurate per-model pricing with real-time tracking:

```
Total Cost: $0.0023
```

Pricing data in `costs.mjs` for:
- OpenAI (GPT-4o, o1, etc.)
- Anthropic (Claude 3.5, etc.)
- Google (Gemini 1.5, 2.0)
- OpenRouter models
- Ollama (free)

## Project Structure

```
ai-product-evals/
├── run-eval.mjs           # Level 1: CLI runner for automated evals
├── app.html               # Level 2: Human review web app with charts
├── tracer.mjs             # Trace logging & history
├── evaluators/index.mjs   # Scoring logic
├── providers/             # LLM providers
├── cache.mjs              # Response caching
├── rate-limiter.mjs       # API rate limiting
├── costs.mjs              # Cost tracking
├── safety.mjs             # Safety checks
├── similarity.mjs         # Semantic similarity
├── ab-test.mjs            # Level 3: A/B testing
├── multi-turn.mjs         # Conversation testing
├── dataset.mjs            # Dataset loading/export
├── evals/                 # Eval configs
├── traces/                # Saved traces (gitignored)
├── .cache/                # Response cache (gitignored)
├── .github/workflows/     # CI/CD
└── .env                   # API keys
```

## Environment Variables

```bash
# Providers
OLLAMA_BASE_URL=http://localhost:11434
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
OPENROUTER_API_KEY=...

# Defaults
DEFAULT_PROVIDER=ollama
JUDGE_PROVIDER=ollama
JUDGE_MODEL=qwen3:8b

# Performance
PARALLEL_LIMIT=3
MAX_RETRIES=2
RETRY_DELAY_MS=1000
EVAL_TIMEOUT_MS=180000

# Caching
USE_CACHE=true
CACHE_TTL_MS=86400000
```

## License

MIT
