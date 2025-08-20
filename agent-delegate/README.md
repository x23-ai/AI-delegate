# Agent Delegate

This package orchestrates multi‑agent evaluation of governance proposals (planner → fact checker → reasoner → devil’s advocate → judge) with auditable traces and x23.ai data tools.

## Environment Variables

Required for normal operation:

- `X23_API_KEY`: API key for https://api.x23.ai/v1 endpoints.
- `OPENAI_API_KEY`: Required when `LLM_PROVIDER=openai`.

Recommended/Configurable:

- `LLM_PROVIDER`: `openai` (default) or `stub`.
- `OPENAI_MODEL`: OpenAI Responses model. Default: `gpt-5-mini` (reasoning; temperature ignored). Examples: `gpt-5-mini`, `gpt-4o-mini`.
- `LLM_DEBUG_SCHEMA`: set to `1` to log the strict JSON schema used for extraction and the raw model response text, plus validation errors if any.
- `X23_PROTOCOLS`: Comma-separated list of default protocols to search. Default: `optimism`.
- `X23_DISCUSSION_URL`: Default forum base URL for rawPosts. Default: `https://gov.optimism.io`.
- `ORCH_MAX_ITERS`: Max refinement iterations per stage (default `2`).
- `JUDGE_CONFIDENCE`: Threshold 0..1 to accept judge decision (default `0.5`).
- `FACT_MAX_ITERS`: Max refinement iterations per assumption in fact checking (default `2`).
- `FACT_MIN_CITATIONS`: Minimum citations required to consider a claim sufficiently evidenced (default `1`).
- `FACT_MIN_CONFIDENCE`: Minimum confidence (0..1) from the fact-checker’s LLM classification to accept a claim without further refinement (default `0.6`).

On‑chain (not required initially):

- `RPC_URL`, `AGENT_PRIVATE_KEY`, `CAST_VOTE_ADDRESS`, `GOVERNOR_ADDRESS` (used by `src/index.ts`).

## Commands

- Dev orchestrator: `npx tsx src/orchestrate.ts`
- Build: `npm run build`
- Lint/format: `npm run lint` / `npm run format`
- Utility: Fetch OP circulating supply (programmatic): `import { getOPCirculatingSupply } from './src/tools/op'`

## Notes

- Reasoning models like `gpt-5-mini` do not support `temperature`; the client omits it automatically.
- Traces are recorded via `TraceBuilder` and can be published/hashed later.
- Arithmetic checks: the fact checker evaluates simple expressions and common finance terms:
  - k/M/B, million/billion/thousand, commas, currency `$`
  - `% of` and `bps` (basis points)
  - APR → APY with compounding (daily/weekly/monthly/quarterly/annual)

## Passing Proposal Parameters

You can pass proposal details via CLI args or an import file. Precedence: CLI > file. There is no env fallback for proposal fields.

- CLI args:

  - `--proposal-id 123` (required if no file)
  - `--title "My Proposal"`
  - `--desc "Evaluate scope and budget."`
  - `--input import/proposal.json` (path to JSON file)
  - `--payload-file import/payload.json` (optional; JSON array of payload items)

- Import file (JSON): default path `agent-delegate/import/proposal.json`
  - Example contents:
    {
    "id": 123,
    "title": "My Proposal",
    "description": "Evaluate scope and budget.",
    "payload": [
    { "type": "discussion", "uri": "https://forum.xyz/t/abc/123", "data": { "topicId": 123 } },
    { "type": "pullRequest", "uri": "https://github.com/org/repo/pull/99", "data": { "owner": "org", "repo": "repo", "id": 99 } },
    { "type": "onchain", "data": { "chainId": 10, "governor": "treasuryGovernance", "proposalId": "0x..." } },
    { "type": "discussion", "data": { "text": "Inline discussion content or markdown goes here..." } },
    { "type": "note", "data": "A plain string with relevant context if needed." }
    ]
    }

Notes on `payload`:

- This optional array lets you attach the proposal’s primary documents and records (forum posts, PRs, onchain proposals/txs, code, etc.).
- Each item may include a `uri` (link) and/or inline content via `data` (either `{ "text": "..." }` or a plain string). Agents consider inline content during assumption extraction and claim classification.

### Persisting Summary

Write a compact summary to JSON with `--summary-json path`:

```
npm run orchestrate -- --proposal-id 123 --title "My Prop" --summary-json dist/summary.json
```
