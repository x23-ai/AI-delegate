# Agents & Tooling

This document captures how the multi‑agent system is wired, how it retrieves evidence, and which knobs to adjust.

## Pipeline

- Planner → Fact Checker → Reasoner → Devil’s Advocate → Judge
- All agents record auditable steps into a shared `TraceBuilder`, including inputs, outputs, and references (URIs). Optional JSON traces can be saved via `SAVE_TRACE_JSON=1`.

## Shared Evidence Toolkit

Implemented in `agent-delegate/src/tools/evidence.ts` and used by FactChecker, Reasoner, and Devil’s Advocate:

- LLM‑driven tool selection (`SEARCH_TOOL_SELECTOR_*`) for `keyword`/`vector`/`hybrid`.
- Optional query rewrite (`QUERY_REWRITE_*`). Disable via `FACT_ENABLE_QUERY_REWRITE=0`.
- Official‑doc detail (`OFFICIAL_DETAIL_DECISION_*`) and raw forum posts (`RAW_POSTS_DECISION_*`) expansions when snippets are insufficient.
- Evidence cache: keyed by `(normalizedClaim,hints)`, TTL `EVIDENCE_CACHE_TTL_MS` (default 600000), with URI de‑duplication.
- Timeline enrichment: for temporal/process claims (proposal phase, snapshot/onchain votes) via `x23.getTimeline`, mapped into pseudo‑docs.
- Official‑first routing: An LLM decision (`OFFICIAL_FIRST_DECISION_*`) determines if a claim is policy/compliance oriented and should query official docs first. Always‑on override via `OFFICIAL_FIRST_ALL=1`.

## Agent‑Specific Behavior

- Planner
  - Uses `planSeedSearch` to generate a concise seed query + protocols; records a planning step, and prepends a task `Seed search corpus: "..." [protocols]` when missing.

- Fact Checker
  - Builds an initial corpus via `hybridSearch` using the seed plan, plus inline payload docs.
  - Extracts assumptions and arithmetic checks; runs LLM classification with citations and confidence.

- Reasoner
  - Starts its argument with "Purpose Breakdown:" (proposers, voters, protocol stewards, affected users), then relates stakeholder purposes to the proposal’s overarching goal.
  - Iterative search→refine loop up to `REASONER_REFINE_ITERS`, with an explicit decision step to continue/stop (checks: open uncertainties, conflicting premises, missing citations, likely official guidance).
  - Evidence gathering runs in parallel per iteration (`REASONER_EVIDENCE_CONCURRENCY`), de‑dups by URI, and adds trace rollups: `evidenceCount`, `searchAttempts`, `uniqueCitations`.
  - Prompts instruct inline citation markers like `(R1)` aligned with numbered evidence in the digest.

- Devil’s Advocate
  - Gathers external evidence around key premises (parallel, bounded by `DEVILS_EVIDENCE_CONCURRENCY`), focusing on risks/constraints/conflicts.
  - Produces counterpoints/failure modes with inline citation markers and adds rollups into the trace.

## Prompt Templating

- Use `agent-delegate/src/utils/prompt.ts` to inject variables into role prompts.
- Currently supported placeholders:
  - `{{protocols}}`: resolved from `X23_PROTOCOLS`
  - `{{forumRoot}}`: resolved from `X23_DISCUSSION_URL`

## Configuration Knobs

- Evidence & retrieval
  - `X23_API_KEY` (required), `X23_PROTOCOLS`, `X23_DISCUSSION_URL`
  - `FACT_ENABLE_QUERY_REWRITE=0` to disable query rewrite
  - `EVIDENCE_CACHE_TTL_MS` (default 600000)
  - `OFFICIAL_FIRST_ALL=1` to force official‑first for all claims

- Reasoner
  - `REASONER_REFINE_ITERS` (default 2)
  - `REASONER_PREMISE_EVIDENCE_MAX` (default 3)
  - `REASONER_EVIDENCE_CONCURRENCY` (default 2)

- Devil’s Advocate
  - `DEVILS_PREMISE_EVIDENCE_MAX` (default 3)
  - `DEVILS_EVIDENCE_CONCURRENCY` (default 2)

## Validation & Logs

- Config validation runs at startup and fails early on invalid/missing env.
- Set `DEBUG=1` to log raw LLM JSON/text and x23 responses; tool calls include info‑level summaries and rollups for quick inspection.
