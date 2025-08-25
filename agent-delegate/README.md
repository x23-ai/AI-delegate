# Agent Delegate

Agent Delegate evaluates governance proposals end‑to‑end and produces a final vote recommendation (for / against / abstain) with rationale and confidence. It uses the x23.ai API for retrieval and supports curated source evaluation and token price lookups.

If you’re a coding agent, see AGENTS.md for build steps, tests, and conventions.

## Quick Start

1) Prerequisites
- Node.js 18+
- API keys: `X23_API_KEY` (x23.ai) and `OPENAI_API_KEY` (when `LLM_PROVIDER=openai`)

2) Install
- From `agent-delegate/`: `npm ci` (or `npm install`)

3) Configure
- Create `.env` and set:
  - `X23_API_KEY` (required)
  - `OPENAI_API_KEY` (required if using OpenAI)
  - Optional: `X23_PROTOCOLS`, `X23_DISCUSSION_URL`, `LOG_LEVEL`, `DEBUG_LEVEL`, `X23_LOG_PARAMS_INFO`

4) Run
- Dev run: `npm run orchestrate`
- Build: `npm run build` then `npm start`

## What’s New

- Shared evidence toolkit across agents (FactChecker, Reasoner, Devil’s Advocate): LLM tool selection, query rewrite, rawPosts/official-detail expansion, caching + URI de‑dup, timeline enrichment.
 
- Planner seed planning: planner generates a concise seed search (query + protocols), records it, and prepends a task if missing.
- Reasoner iterative loop: repeats search→refine up to `REASONER_REFINE_ITERS` with an explicit continue/stop decision and per‑iteration rollups.
- Prompt templating: role prompts accept `{{protocols}}` and `{{forumRoot}}` via `src/utils/prompt.ts`.
- Config validation: early validation of required env and knob ranges with clear errors.
 - Alchemy Prices tool: `src/tools/prices.ts` provides spot and historical token prices for assets like OP to ground calculations.

## Prompts and Tool Definitions

- Agent prompts: editable constants live at the top of each agent file:
  - Planner: `PLANNER_PROMPT_SYSTEM_SUFFIX` (src/agents/planner.ts)
  - Reasoner: `REASONER_PROMPT_SYSTEM_SUFFIX` (src/agents/reasoner.ts)
  - Devil’s Advocate: `DEVILS_ADVOCATE_PROMPT_SYSTEM_SUFFIX` (src/agents/devilsAdvocate.ts)
  - Judge: `JUDGE_PROMPT_SYSTEM_SUFFIX` (src/agents/judge.ts)
  - Judge role file: `src/agents/roles/judge.md` includes a Goals section used to weigh tradeoffs. Edit this to align the judge’s stance.
  - Conductor QA/scorers: `CONDUCTOR_*_PROMPT` (src/agents/conductor.ts)
  - Fact Checker: `ASSUMPTION_EXTRACT_SYSTEM_SUFFIX`, `ARITHMETIC_EXTRACT_SYSTEM_SUFFIX`, `CLAIM_CLASSIFY_SYSTEM_SUFFIX` (src/agents/factChecker.ts)

- Tool prompts/schemas (central): `src/tools/definitions.ts`
  - `SEARCH_TOOL_SELECTOR_SYSTEM_PROMPT` + `SEARCH_TOOL_SELECTOR_SCHEMA` – pick search tool: `keyword`, `vector`, `hybrid`.
  - `SEED_SEARCH_SYSTEM_PROMPT` + `SEED_SEARCH_SCHEMA` – produce a concise, search-optimized seed query.
  - `RAW_POSTS_DECISION_PROMPT` + `RAW_POSTS_DECISION_SCHEMA` – decide if raw discussion posts are needed for added context.
  - `QUERY_REWRITE_SYSTEM_PROMPT` + `QUERY_REWRITE_SCHEMA` – rewrite search queries concisely (enabled by default; set `FACT_ENABLE_QUERY_REWRITE=0` to disable).
  - `OFFICIAL_DETAIL_DECISION_PROMPT` + `OFFICIAL_DETAIL_DECISION_SCHEMA` – request official-docs detail after citations when the digest/snippet is insufficient.
  

- x23 client mapping: `src/tools/x23.ts`
  - Maps API responses to compact `DocChunk` objects using only relevant fields per `agent-delegate/x23ai API spec.yaml`:
    - `id`, `title`, `uri` (`appUrl`/`sourceUrl`), `snippet` (`tldr`/`digest`/`headline`), `source` (`type`/`protocol`), `publishedAt`, `score`.
  - Search tools return digests/snippets; `evaluateOfficialUrl` evaluates a single official URL and returns `{ answer }`.
  - `rawPosts` is a separate endpoint to fetch full forum thread content when necessary.

### Retrieval Pattern: Search → (Optional) Detail

- Search tools (`keyword`, `vector`, `hybrid`) retrieve high-signal digests/snippets and citations.
- If a discussion citation needs more context, the agent can call `rawPosts` to fetch the thread’s raw content.
- If an official-doc citation needs more detail than the digest, the agent can call `evaluateOfficialUrl` with `{ protocol, url, question }` to extract an answer directly from the cited URL and feed the response back into classification.
- These detail steps are decided by the LLM and only run when needed (post-citation), keeping calls minimal and focused.

## Shared Evidence Toolkit

Provided by `src/tools/evidence.ts` and used by FactChecker, Reasoner, Devil’s Advocate:

- Search selection (LLM) → run tool → optional expansions (rawPosts, official-detail).
- Evidence cache (TTL `EVIDENCE_CACHE_TTL_MS`, default 600000) keyed by `(normalizedClaim,hints)`; de‑dups by `uri`.
- Timeline enrichment for temporal/process claims via `x23.getTimeline` (mapped to pseudo‑docs).

## Customize The Judge

- Edit `src/agents/roles/judge.md` (Goals section) to reflect your governance stance:
  - Accountant‑style: prioritize completeness, auditability, and risk minimization
  - Growth‑focused: prioritize Superchain expansion and talent attraction
- The judge explicitly weighs all agent outputs against these goals.

### Prices (Alchemy)

- File: `src/tools/prices.ts`; client: `AlchemyPricesClient`
- Env: `ALCHEMY_PRICES_API_KEY` (required), optional `ALCHEMY_PRICES_BASE_URL`, `ALCHEMY_PRICES_BY_SYMBOL_PATH`, `ALCHEMY_PRICES_BY_ADDRESS_PATH`, `ALCHEMY_PRICES_HIST_PATH`
 - Optional env mapping for symbol→address: `ALCHEMY_PRICES_SYMBOL_MAP` as a JSON object.
   - Example: `{"OP":{"network":"opt-mainnet","address":"0x4200000000000000000000000000000000000042"}}`
   - Used for automatic fallback in historical lookups when a symbol series returns 0 points.
- Usage examples:
  - `await new AlchemyPricesClient().getSpotPrice({ symbol: 'OP', currencies: ['USD'] })`
  - `await new AlchemyPricesClient().getHistoricalSeries({ symbol: 'OP', start: '2024-01-01', end: '2024-02-01', interval: '1d' })`
  - `await new AlchemyPricesClient().getSpotPrice({ asset: { address: '0x4200...0042', network: 'opt-mainnet' }, currencies: ['USD'] })`
  - `await new AlchemyPricesClient().getHistoricalSeries({ asset: { address: '0x4200...0042', network: 'opt-mainnet' }, start: '2024-01-01', end: '2024-02-01', interval: '1d' })`

## Agent Behaviors

- Planner: generates a seed query and protocols via `planSeedSearch`, records a trace step, and prepends a task `Seed search corpus: "..." [protocols]` when missing.
- FactChecker: builds an initial corpus from seed search + payload docs, extracts assumptions and arithmetic checks, and classifies with citations/confidence.
- Reasoner: starts argument with “Purpose Breakdown:”, iterates search→refine up to `REASONER_REFINE_ITERS` with a dedicated continue/stop decision; parallel evidence gathering per iteration. Adds trace rollups (evidenceCount, searchAttempts, uniqueCitations) and uses inline citation markers like `(R1)`.
- Devil’s Advocate: runs bounded parallel evidence focusing on risks/constraints/conflicts, produces counterpoints/failure modes with inline markers and rollups.
- Judge: combines all stage outputs with the Goals stated in `src/agents/roles/judge.md` to produce a final recommendation. Example goal profiles:
  - Accountant‑style: “Prioritize completeness, auditability, risk minimization; require verifiable owners, budgets, success metrics.”
  - Growth‑focused: “Prioritize Superchain expansion and talent attraction; accept calculated risks with clear mitigations when impact is high.”

## Environment Variables

Required for normal operation:

- `X23_API_KEY`: API key for https://api.x23.ai/v1 endpoints.
- `OPENAI_API_KEY`: Required when `LLM_PROVIDER=openai`.

Recommended/Configurable:

- `LLM_PROVIDER`: `openai` (default) or `stub`.
- `OPENAI_MODEL`: OpenAI Responses model. Default: `gpt-5-mini` (reasoning; temperature ignored). Examples: `gpt-5-mini`, `gpt-4o-mini`.
- `DEBUG`: set to `1` (or `true`) to log raw LLM responses (schema, JSON, and text) and raw x23 API JSON responses for easier debugging.
 - `X23_LOG_PARAMS_INFO`: when `1`/true/yes, log x23 request params (sanitized/trimmed) at info level. By default, only method/path are logged at info.
 - `DEBUG_LEVEL`: set to `2` to include full x23 request bodies at debug level; `1` includes raw JSON responses at debug level.
- `X23_PROTOCOLS`: Comma-separated list of default protocols to search. Default: `optimism`.
- `X23_DISCUSSION_URL`: Default forum base URL for rawPosts. Default: `https://gov.optimism.io`.
- `ORCH_MAX_ITERS`: Max refinement iterations per stage (default `2`).
- `JUDGE_CONFIDENCE`: Threshold 0..1 to accept judge decision (default `0.5`).
- `FACT_MAX_ITERS`: Max refinement iterations per assumption in fact checking (default `2`).
- `FACT_MAX_CHECKS`: Upper limit on number of assumptions the fact checker evaluates (processes the first N; `0` or unset processes all).
- `FACT_MAX_ARITH_CHECKS`: Upper limit on number of arithmetic checks to evaluate (first N; `0` or unset processes all).
- `SAVE_TRACE_JSON`: set to `1`/`true` to write the full reasoning trace to a JSON file after the run. Use `TRACE_JSON_PATH` to override the output path (default `dist/trace-proposal-<id>-<timestamp>.json`).
- `FACT_MIN_CITATIONS`: Minimum citations required to consider a claim sufficiently evidenced (default `1`).
- `FACT_MIN_CONFIDENCE`: Minimum confidence (0..1) from the fact-checker’s LLM classification to accept a claim without further refinement (default `0.6`).
 - `REASONER_REFINE_ITERS`: Max search→refine iterations for the Reasoner (default `2`).
 - `REASONER_PREMISE_EVIDENCE_MAX`: Max premises per iteration to collect evidence for (default `3`).
 - `REASONER_EVIDENCE_CONCURRENCY`: Max concurrent evidence lookups per iteration (default `2`).
 - `DEVILS_PREMISE_EVIDENCE_MAX`: Max premises Devil’s Advocate inspects (default `3`).
 - `DEVILS_EVIDENCE_CONCURRENCY`: Concurrency for Devil’s Advocate evidence gathering (default `2`).
 - `EVIDENCE_CACHE_TTL_MS`: TTL for evidence cache (default `600000`).
 

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
 - Config validation: `src/utils/configValidate.ts` validates required env and knob ranges at startup and fails fast with clear messages.
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
