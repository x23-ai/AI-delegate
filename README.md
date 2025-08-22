# Building AI Delegates
Supported by Optimism: https://github.com/ethereum-optimism/ecosystem-contributions/issues/277#issuecomment-2820956333

This monorepo includes:

- `contracts/`: Foundry Solidity contracts and tests
- `agent-delegate/`: Multi‑agent TypeScript system that evaluates proposals using x23.ai search tools
- `frontend/`: Next.js app to verify Merkle proofs against on‑chain data
- `merkle/`: Node helpers for Merkle roots/proofs

See AGENTS.md for detailed repo guidelines and development instructions.

## Highlights (Recent)

- Shared evidence toolkit across agents (FactChecker, Reasoner, Devil’s Advocate)
  - LLM‑driven tool selection: keyword/vector/hybrid
  - Official‑docs detail and raw forum posts expansions
  - Evidence cache with TTL and URI de‑duplication
  - Timeline enrichment for process/chronology claims
- Official‑docs first decision
  - LLM decides if a claim is policy/compliance oriented (OFFICIAL_FIRST_DECISION_*); when true (or OFFICIAL_FIRST_ALL=1), query official docs first, fall back otherwise
- Planner seed planning
  - Planner bootstraps a seed search query and records it as a planning step; adds a task like: `Seed search corpus: "..." [protocols]`
- Reasoner iterative loop
  - Repeats search→refine up to REASONER_REFINE_ITERS
  - Uses an explicit LLM decision to continue/stop (checks uncertainties/conflicts/missing citations)
  - Adds trace rollups (evidenceCount, searchAttempts, uniqueCitations)
- Prompt templating
  - Role prompts can reference `{{protocols}}` and `{{forumRoot}}` via `src/utils/prompt.ts` to ensure consistent guidance

## Configuration (New/Updated)

- `OFFICIAL_FIRST_ALL`: When `1`/true/yes, try official docs first for all claims
- `EVIDENCE_CACHE_TTL_MS`: TTL for evidence cache (default 600000)
- `REASONER_REFINE_ITERS`: Max search→refine iterations for the Reasoner (default 2)
- `REASONER_PREMISE_EVIDENCE_MAX`: Max premises per iteration (default 3)
- `REASONER_EVIDENCE_CONCURRENCY`: Parallelism for Reasoner evidence lookup (default 2)
- `DEVILS_PREMISE_EVIDENCE_MAX`: Max premises for Devil’s Advocate (default 3)
- `DEVILS_EVIDENCE_CONCURRENCY`: Parallelism for Devil’s Advocate evidence lookup (default 2)

Config validation runs at startup; missing/invalid env vars fail fast with helpful messages.
