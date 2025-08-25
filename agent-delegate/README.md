# Agent Delegate

Agent Delegate evaluates governance proposals end‑to‑end and produces a final vote recommendation (for / against / abstain) with rationale and confidence. It retrieves evidence via x23.ai, runs a multi‑agent pipeline (Planner → Fact Checker → Reasoner → Devil’s Advocate → Judge), and emits an auditable reasoning trace.

If you’re contributing to the code, see `AGENTS.md` for build steps, tests, and conventions.

## Quick Start

1. Prerequisites

- Node.js 18+
- API keys: `X23_API_KEY` (for x23.ai) and `OPENAI_API_KEY` (when `LLM_PROVIDER=openai`)

2. Install

- From `agent-delegate/`: `npm ci` (or `npm install`)

3. Configure

- Create an `.env` file with at minimum:
  - `X23_API_KEY=...`
  - `OPENAI_API_KEY=...` (when using OpenAI)
  - `ALCHEMY_PRICES_API_KEY=....`
  - Optional: `X23_PROTOCOLS=optimism`, `X23_DISCUSSION_URL=https://gov.optimism.io`, `LOG_LEVEL=info`

4. Load proposal

- Add proposal text context in `/evaluate` directory
- Context should be either json, md, or txt files.

5. Run

- Dev run: `npm run orchestrate` or `npm run orchestrate-quick`
- Build then run: `npm run build && npm start`

## What It Does

- Plans a retrieval strategy; gathers evidence from forum, official docs, Snapshot, GitHub, and on‑chain data via x23.ai.
- Extracts assumptions and arithmetic checks; verifies claims with citations.
- Forms a structured argument, challenges it, and produces a final recommendation.
- Records every step in a reasoning trace for auditability.

## Inputs

Two ways to provide proposal context. Precedence: CLI > directory > file. For `id`, fallback to `PROPOSAL_ID` env if not provided elsewhere.

- Directory input (recommended): `--input evaluate` or `--input-dir evaluate`

  - Default directory is `agent-delegate/evaluate/` if present.
  - Place any mix of `.json`, `.md|.mdx`, `.txt`, `.yaml|.yml`, `.csv|.tsv`, `.ini|.toml` (recursively).
  - Loader behavior:
    - Merges `id`, `title`, `description`, and `payload` from JSON files (prefers `proposal.json` when present).
    - Adds every text file as a `payload` item of type `file`: `uri=file://<relative-path>`, `data=<file text>`.
    - Derives `description` from `README.md`/`proposal.md` if missing; first markdown heading becomes `title` when absent.

- Single JSON file: `--input import/proposal.json`

  - Minimal shape:
    ```json
    {
      "id": 1001,
      "title": "My Proposal",
      "description": "...",
      "payload": [
        { "type": "discussion", "uri": "https://gov.optimism.io/t/...", "data": { "topicId": 123 } }
      ]
    }
    ```

- Useful CLI flags:
  - `--proposal-id 1001` (required if no id in file/dir)
  - `--title "My Proposal"`, `--desc "Evaluate scope and budget."`
  - `--input <file-or-dir>` or `--input-dir <dir>`
  - `--payload-file <path>` (JSON array of payload items)
  - `--summary-json <path>` (writes a compact run summary)

## Running

- Orchestrator (dev): `npm run orchestrate -- --proposal-id 1001`
- Quick mode (faster, less depth): `npm run orchestrate -- --quick --proposal-id 1001`
  - Quick mode reduces iterations and search depth, disables slow evidence expansions, and lowers concurrency.

### Output files

- Save full output JSON: set `SAVE_TRACE_JSON=1` (optional `TRACE_JSON_PATH` to override)
  - Default path: `results/trace-proposal-<id>-<timestamp>.json`
  - File shape: `{ "trace": <ReasoningTrace>, "usageMetrics": { "llmCalls", "llmInputTokens", "llmOutputTokens", "x23Calls", "docsEvaluated" } }`
- Save compact summary JSON: add `--summary-json results/summary.json`

## Example Runs

These numbers are from previous test runs. Cost will depend on proposal complexity, LLMs used, and env variables set.

- Full run

  - LLM tokens: input ≈ 85,000; output ≈ 65,000
  - Runtime: 15-20 minutes
  - Cost: $0.15032

- Quick run (`--quick`)
  - LLM tokens: input ≈ 50,000; output ≈ 50,000
  - Runtime: 10 minutes
  - Cost : $0.10112

Tip: After a run with `SAVE_TRACE_JSON=1`, open the JSON in `results/` to see the exact `usageMetrics` for your environment.

## Architecture Overview

- Multi‑agent pipeline

  - Planner: objectives/tasks and seed search plan.
  - Fact Checker: extracts assumptions and arithmetic checks; classifies claims with citations.
  - Reasoner: builds a structured argument; iterates evidence gathering.
  - Devil’s Advocate: surfaces counterpoints and risks.
  - Judge: produces the final recommendation with a confidence score.

- Retrieval & tools

  - x23.ai client: keyword/vector/hybrid search, raw discussion posts, timeline enrichment, official‑doc detail; returns compact `DocChunk`s.
  - Optional curated sources and token price lookups.
  - Evidence caching and URI de‑dup for efficiency.

- Trace & metrics
  - Every agent records steps in a `ReasoningTrace`.
  - Usage metrics (LLM tokens/calls, x23 calls, docs evaluated) are printed and saved alongside the trace when enabled.

## Configuration (env)

Required

- `X23_API_KEY`: x23.ai API key
- `OPENAI_API_KEY`: when `LLM_PROVIDER=openai`

Common options

- `LLM_PROVIDER`: `openai` (default) or `stub`
- `OPENAI_MODEL`: default `gpt-5-mini` (e.g., `gpt-5-mini`, `gpt-4o-mini`)
- `X23_PROTOCOLS`: comma‑separated list (default `optimism`)
- `X23_DISCUSSION_URL`: forum base URL (default `https://gov.optimism.io`)
- `SAVE_TRACE_JSON`: `1` to write `{ trace, usageMetrics }` to JSON (see Output files)
- Performance knobs (see Quick mode): `REASONER_REFINE_ITERS`, `REASONER_PREMISE_EVIDENCE_MAX`, `FACT_MAX_ITERS`, `FACT_MAX_CHECKS`, etc.

On‑chain (optional)

- `RPC_URL`, `AGENT_PRIVATE_KEY`, `CAST_VOTE_ADDRESS`, `GOVERNOR_ADDRESS` (used by `src/index.ts`)

## Commands

- Dev orchestrator: `npm run orchestrate`
- Build: `npm run build`
- Start (built): `npm start`
- Lint/format: `npm run lint`, `npm run format`

## Troubleshooting

- Missing keys: ensure `.env` provides `X23_API_KEY` and `OPENAI_API_KEY`.
- Slow/expensive runs: use `--quick`, reduce `REASONER_REFINE_ITERS`, set `FACT_MAX_CHECKS`, or lower search limits.
- Debugging: set `DEBUG=1` to log raw responses; `X23_LOG_PARAMS_INFO=1` to preview request params.
