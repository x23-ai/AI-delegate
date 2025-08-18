# Agent Delegate

This package orchestrates multi‑agent evaluation of governance proposals (planner → fact checker → reasoner → devil’s advocate → judge) with auditable traces and x23.ai data tools.

## Environment Variables

Required for normal operation:
- `X23_API_KEY`: API key for https://api.x23.ai/v1 endpoints.
- `OPENAI_API_KEY`: Required when `LLM_PROVIDER=openai`.

Recommended/Configurable:
- `LLM_PROVIDER`: `openai` (default) or `stub`.
- `OPENAI_MODEL`: OpenAI Responses model. Default: `gpt5-mini` (reasoning; temperature ignored). Examples: `gpt5-mini`, `gpt-4o-mini`.
- `PROPOSAL_ID`: Numeric proposal id (default `1`).
- `PROPOSAL_TITLE`: Short title string.
- `PROPOSAL_DESC`: Optional description context.
- `PROPOSAL_SOURCES`: Comma‑separated URLs (forums, specs, snapshots).
- `ORCH_MAX_ITERS`: Max refinement iterations per stage (default `2`).
- `JUDGE_CONFIDENCE`: Threshold 0..1 to accept judge decision (default `0.5`).

On‑chain (not required initially):
- `RPC_URL`, `AGENT_PRIVATE_KEY`, `CAST_VOTE_ADDRESS`, `GOVERNOR_ADDRESS` (used by `src/index.ts`).

## Commands
- Dev orchestrator: `npx tsx src/orchestrate.ts`
- Build: `npm run build`
- Lint/format: `npm run lint` / `npm run format`
 - Utility: Fetch OP circulating supply (programmatic): `import { getOPCirculatingSupply } from './src/tools/op'`

## Notes
- Reasoning models like `gpt5-mini` do not support `temperature`; the client omits it automatically.
- Traces are recorded via `TraceBuilder` and can be published/hashed later.
