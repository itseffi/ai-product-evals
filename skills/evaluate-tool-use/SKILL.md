---
name: evaluate-tool-use
description: >
  Guides evaluation of tool-use behavior in agentic systems.
  Use when measuring tool selection accuracy, identifying wrong-tool or no-tool failures,
  improving argument checks, or designing stronger tool-use eval cases.
---

# Evaluate Tool Use

## Overview

1. Read traces first to identify whether failures are tool-choice errors, argument errors, or parser errors.
2. Start from `evals/agent-tools.json`.
3. Evaluate tool choice separately from argument correctness.
4. Include explicit no-tool cases so models are not rewarded for unnecessary tool use.
5. Tighten the parser only after reviewing how multiple providers format tool calls.

## Prerequisites

Inspect `evals/agent-tools.json`, `evals/quick-test.json`, `evaluators/index.mjs`, and `traces/` before changing the tool-use suite. Determine whether failures come from ambiguous prompts, weak argument expectations, or parser brittleness.

## Core Instructions

### Separate Tool Choice From Argument Correctness

Measure:

- whether the correct tool was chosen
- whether no tool should have been chosen
- whether the arguments are semantically correct
- whether formatting broke parsing even when intent was correct

Do not treat all tool failures as one category.

### Build Better Tool-Use Coverage

Add cases for:

- obvious tool usage
- ambiguous tool usage
- explicit no-tool usage
- multi-argument tools
- distractor tools with overlapping semantics

The suite should measure both over-calling and under-calling tools.

### Make Arguments Realistic

Expected arguments should reflect what downstream code actually needs. If argument matching is too loose, broken tool calls can pass. If argument matching is too strict, reasonable provider formatting differences can fail incorrectly.

### Review Parser Behavior Across Providers

Inspect traces to see whether providers produce:

- `TOOL: name(args)`
- JSON-like tool calls
- extra formatting around the tool call
- casing or quoting differences

Parser changes should be based on observed outputs, not assumptions.

### Repo Files To Inspect

- `evals/agent-tools.json`
- `evals/quick-test.json`
- `evaluators/index.mjs`
- `run-eval.mjs`
- `traces/`

## Anti-Patterns

- Evaluating only obvious tool calls.
- Ignoring no-tool cases.
- Treating partial argument overlap as full correctness.
- Tightening the parser without reading traces from multiple providers.
- Assuming formatting errors and reasoning errors are the same problem.
