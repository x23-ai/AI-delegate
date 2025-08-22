# Agent Delegate

This package orchestrates multi‑agent evaluation of governance proposals (planner → fact checker → reasoner → devil’s advocate → judge) with auditable traces and x23.ai data tools.

## Prompts and Tool Definitions

- Agent prompts: editable constants live at the top of each agent file:
  - Planner: `PLANNER_PROMPT_SYSTEM_SUFFIX` (src/agents/planner.ts)
  - Reasoner: `REASONER_PROMPT_SYSTEM_SUFFIX` (src/agents/reasoner.ts)
  - Devil’s Advocate: `DEVILS_ADVOCATE_PROMPT_SYSTEM_SUFFIX` (src/agents/devilsAdvocate.ts)
  - Judge: `JUDGE_PROMPT_SYSTEM_SUFFIX` (src/agents/judge.ts)
  - Conductor QA/scorers: `CONDUCTOR_*_PROMPT` (src/agents/conductor.ts)
  - Fact Checker: `ASSUMPTION_EXTRACT_SYSTEM_SUFFIX`, `ARITHMETIC_EXTRACT_SYSTEM_SUFFIX`, `CLAIM_CLASSIFY_SYSTEM_SUFFIX` (src/agents/factChecker.ts)

- Tool prompts/schemas (central): `src/tools/definitions.ts`
  - `SEARCH_TOOL_SELECTOR_SYSTEM_PROMPT` + `SEARCH_TOOL_SELECTOR_SCHEMA` – pick search tool: `keyword`, `vector`, `hybrid`, `officialHybrid`.
  - `SEED_SEARCH_SYSTEM_PROMPT` + `SEED_SEARCH_SCHEMA` – produce a concise, search-optimized seed query.
  - `RAW_POSTS_DECISION_PROMPT` + `RAW_POSTS_DECISION_SCHEMA` – decide if raw discussion posts are needed for added context.
  - `QUERY_REWRITE_SYSTEM_PROMPT` + `QUERY_REWRITE_SCHEMA` – rewrite search queries concisely (enabled by default; set `FACT_ENABLE_QUERY_REWRITE=0` to disable).
  - `OFFICIAL_DETAIL_DECISION_PROMPT` + `OFFICIAL_DETAIL_DECISION_SCHEMA` – request official-docs detail after citations when the digest/snippet is insufficient.

- x23 client mapping: `src/tools/x23.ts`
  - Maps API responses to compact `DocChunk` objects using only relevant fields per `agent-delegate/x23ai API spec.yaml`:
    - `id`, `title`, `uri` (`appUrl`/`sourceUrl`), `snippet` (`tldr`/`digest`/`headline`), `source` (`type`/`protocol`), `publishedAt`, `score`.
  - Search tools return digests/snippets; `officialHybridAnswer` returns `{ answer, citations }`.
  - `rawPosts` is a separate endpoint to fetch full forum thread content when necessary.

### Retrieval Pattern: Search → (Optional) Detail

- Search tools (`keyword`, `vector`, `hybrid`, `officialHybrid` with `realtime=false`) retrieve high-signal digests/snippets and citations.
- If a discussion citation needs more context, the agent can call `rawPosts` to fetch the thread’s raw content.
- If an official-doc citation needs more detail than the digest, the agent can request an official-doc detail answer (internally calls `officialHybridAnswer` with `realtime=true`) and feed the response back into classification.
- These detail steps are decided by the LLM and only run when needed (post-citation), keeping calls minimal and focused.

## Environment Variables

Required for normal operation:

- `X23_API_KEY`: API key for https://api.x23.ai/v1 endpoints.
- `OPENAI_API_KEY`: Required when `LLM_PROVIDER=openai`.

Recommended/Configurable:

- `LLM_PROVIDER`: `openai` (default) or `stub`.
- `OPENAI_MODEL`: OpenAI Responses model. Default: `gpt-5-mini` (reasoning; temperature ignored). Examples: `gpt-5-mini`, `gpt-4o-mini`.
- `DEBUG`: set to `1` (or `true`) to log raw LLM responses (schema, JSON, and text) and raw x23 API JSON responses for easier debugging.
- `X23_PROTOCOLS`: Comma-separated list of default protocols to search. Default: `optimism`.
- `X23_DISCUSSION_URL`: Default forum base URL for rawPosts. Default: `https://gov.optimism.io`.
- `ORCH_MAX_ITERS`: Max refinement iterations per stage (default `2`).
- `JUDGE_CONFIDENCE`: Threshold 0..1 to accept judge decision (default `0.5`).
- `FACT_MAX_ITERS`: Max refinement iterations per assumption in fact checking (default `2`).
- `FACT_MAX_CHECKS`: Upper limit on number of assumptions the fact checker evaluates (processes the first N; `0` or unset processes all).
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
- LLM logging: token counts per call at info level with clear labels (operation + schema). With `DEBUG=1`, raw JSON/text and schemas are printed.
- x23 logging: raw API JSON is printed when `DEBUG=1`. Each x23 tool method also logs the mapped return object at info level with a clear method label.
- Debug levels:
  - `DEBUG_LEVEL=0` (default): no extra debug payloads.
  - `DEBUG_LEVEL=1`: log raw JSON objects (LLM schemas, LLM responses, x23 responses) at debug level.
  - `DEBUG_LEVEL=2`: include raw LLM text in debug logs in addition to JSON.
  - Use `LOG_LEVEL=debug` to display these debug logs; otherwise only info/warn/error show.
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
