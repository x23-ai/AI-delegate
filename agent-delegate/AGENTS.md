# Agents.md — Agent-Focused Instructions

This file is for coding agents. Humans should read README.md. Agents: follow these steps and conventions to build, run, and modify this workspace safely and consistently.

---

## Repo Map

- Orchestrator: `src/orchestrate.ts` (wires all agents and shared clients)
- Agents: `src/agents/*.ts` with role prompts in `src/agents/roles/*.md`
- Evidence toolkit: `src/tools/evidence.ts` (shared retrieval + expansions)
- x23 client + tools: `src/tools/x23.ts`, curated: `src/tools/curated.ts`, prices: `src/tools/prices.ts`
- Utilities: `src/utils/*` (logging, metrics, prompt templating, config)
- API spec: `x23ai API spec.yaml` (maps to methods in `x23.ts`)

## Build & Run

- Node: 18+ recommended.
- Install deps: `npm ci` (or `npm i`) in `agent-delegate/`.
- Build: `npm run build` → outputs `dist/`.
- Dev run: `npm run orchestrate` (tsx) or `npx tsx src/orchestrate.ts`.
- Required env: `X23_API_KEY`, `OPENAI_API_KEY` (when `LLM_PROVIDER=openai`).

## Tests & Validation

- No unit tests included. Validate by:
  - Building: `npm run build` (TypeScript should compile cleanly).
  - Running orchestrator on a sample proposal and inspecting logs + trace JSON.
- Traces: set `SAVE_TRACE_JSON=1` to write a JSON trace under `dist/`.

## Conventions

- TypeScript ESM (`"type": "module"`); avoid `require`.
- Keep edits minimal and focused; prefer changing prompts/config before code.
- Logging:
  - Use `log.info`/`log.debug`; decision logs should use `colors.magenta(...)` for visibility.
  - Set `LOG_LEVEL=info|debug`. To log x23 params at info, set `X23_LOG_PARAMS_INFO=1`.
- LLM JSON extraction: use schemas provided in each agent/tool; keep outputs small and typed.
- Evidence rules:
  - Shared toolkit runs tool selection (`keyword|vector|hybrid`) and expansions (`rawPosts`, `officialDetail`, `curatedSource`, `price`).
  - Curated uses `evaluateOfficialUrl` on one or multiple catalog URLs sequentially.
  - Timeline enrichment uses `x23.getTimeline` on the top raw/citation.

## Pipeline

- Planner → Fact Checker → Reasoner → Devil’s Advocate → Judge
- All agents record auditable steps via `TraceBuilder` with inputs/outputs/URIs. Set `SAVE_TRACE_JSON=1` to persist a JSON trace.

## Tools (x23, Curated, Prices)

- x23 client: `src/tools/x23.ts`
  - Search: `keywordSearch*`, `vectorSearch*`, `hybridSearch*`
  - Official URL evaluation: `evaluateOfficialUrl({ protocol, url, question })`
  - Forum: `getDiscussionPosts`
  - Timeline: `getTimeline`
  - Info logs: method/path; enable param previews via `X23_LOG_PARAMS_INFO=1`.

- Curated: `src/tools/curated.ts` + `src/tools/curatedCatalog.ts`
  - LLM selects `sourceId` or `sourceIds[]`; calls `evaluateOfficialUrl` sequentially; stops at first answer.

- Prices: `src/tools/prices.ts`
  - Spot + historical via Alchemy Prices; governed by `ALCHEMY_PRICES_*` envs.

## Prompts

- Role files under `src/agents/roles/*.md` define persona and guidance.
- Prompt templating (`src/utils/prompt.ts`) supports placeholders:
  - `{{protocols}}` from `X23_PROTOCOLS`
  - `{{forumRoot}}` from `X23_DISCUSSION_URL`
- Judge’s Goals live in `src/agents/roles/judge.md`; the judge combines stage evidence with these goals.

## Environment

- x23: `X23_API_KEY`, `X23_PROTOCOLS` (comma‑sep, default `optimism`), `X23_DISCUSSION_URL`.
- LLM: `LLM_PROVIDER` (`openai`|`stub`), `OPENAI_API_KEY`, optional `OPENAI_MODEL`.
- Prices: `ALCHEMY_PRICES_API_KEY`, optional `ALCHEMY_PRICES_*` paths, `ALCHEMY_PRICES_SYMBOL_MAP`.
- Evidence: `FACT_ENABLE_QUERY_REWRITE`, `EVIDENCE_CACHE_TTL_MS`.
- Logging: `LOG_LEVEL`, `DEBUG`, `DEBUG_LEVEL`, `X23_LOG_PARAMS_INFO`.

## Gotchas

- Keep request bodies concise; many endpoints limit payload size.
- `evaluateOfficialUrl` returns only `{ answer }`; citations must come from a preceding search (e.g., `hybridSearchRaw` with `itemTypes: ['officialDoc']`).
- When trying multiple curated URLs, always call sequentially (already implemented).
