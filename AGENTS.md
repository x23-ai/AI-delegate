# Repository Guidelines

## Project Structure & Modules
- `contracts/`: Foundry Solidity contracts and tests (`src/`, `test/`).
- `agent-delegate/`: TypeScript agent that builds a reasoning trace, uploads to IPFS, and submits onchain votes (`src/`).
- `frontend/`: Next.js + Tailwind app for verifying Merkle proofs against onchain data (`app/`, `components/`, `lib/`).
- `merkle/`: Node helpers for Merkle roots/proofs (`merkle.js`, `index.js`).
- Env files: `contracts/.env`, `agent-delegate/.env`, `frontend/.env.local` (never commit secrets).

### Agent Prompts & Tools (editing guidelines)
- Prompts in agents: Each agent file defines editable prompt constants at the top of the file (e.g., `PLANNER_PROMPT_SYSTEM_SUFFIX`, `REASONER_PROMPT_SYSTEM_SUFFIX`, etc.). Edit these to adjust behavior.
- Tool prompts/schemas: Centralized under `agent-delegate/src/tools/definitions.ts`:
  - `SEARCH_TOOL_SELECTOR_*` for selecting between `keyword`/`vector`/`hybrid`/`officialHybrid` search tools.
  - `SEED_SEARCH_*` to derive a concise, search-optimized seed query.
  - `RAW_POSTS_DECISION_*` to decide when to fetch raw forum posts for added context.
  - `QUERY_REWRITE_*` to rewrite search queries (enabled by default). Disable via `FACT_ENABLE_QUERY_REWRITE=0`.
  - `OFFICIAL_DETAIL_DECISION_*` to request detailed answers from official docs after citations (similar to rawPosts behavior).
- x23 API client: `agent-delegate/src/tools/x23.ts` maps API responses to compact `DocChunk` structures (title, uri, snippet/tldr/digest, source, timestamps, score). Only relevant fields per the `agent-delegate/x23ai API spec.yaml` are surfaced.
- Separation of tools:
  - Search tools return digests/snippets: `keyword`, `vector`, `hybrid`, `officialHybrid` (answer + citations).
  - `rawPosts` is a separate tool to fetch full forum thread content when more context is needed for a discussion item.

## Build, Test, and Dev
- Contracts:
  - Build: `cd contracts && forge build`
  - Test: `cd contracts && forge test [--gas-report]`
  - Local chain: `anvil --chain-id 31337`
  - Deploy (example): `forge create src/CastVote.sol:CastVote --rpc-url $RPC_URL --private-key $ADMIN_PRIV_KEY --broadcast --constructor-args $ADMIN_ADDRESS`
- Agent:
  - Dev: `cd agent-delegate && npm run dev`
  - Build: `cd agent-delegate && npm run build && npm start`
  - Lint/format: `npm run lint` / `npm run format`
- Frontend:
  - Dev: `cd frontend && npm run dev`
  - Build/Start: `cd frontend && npm run build && npm start`
- Merkle helpers: `cd merkle && node index.js` (see `merkle/README.md`).

## Coding Style & Naming
- Indentation: 2 spaces; TypeScript/JS use Prettier in `agent-delegate` (semi-colons, single quotes, width 100, trailing commas es5).
- Linting: ESLint in `agent-delegate` (TS + import rules). Frontend uses Next ESLint config.
- Naming: camelCase for variables/functions, PascalCase for classes/components, kebab/lowercase for files.
- Solidity: follow Foundry defaults; keep contracts small and focused.

## Testing Guidelines
- Contracts: Foundry with `forge-std`. Place tests in `contracts/test/*.t.sol`. Run `forge test --gas-report` before PRs.
- Frontend/Agent: no test harness included; add focused unit tests when introducing non-trivial logic.
- Aim for clear, deterministic tests and include setup notes for Anvil where relevant.

## Commits & Pull Requests
- Commits: short, imperative subject (e.g., "CastVote: verify step proof"). Group related changes; avoid noisy WIP chains.
- PRs: include overview, scope, commands to run, test plan, and screenshots (UI) or gas impact (contracts). Link related issues. Ensure `lint`/`build`/`forge test` pass.

## Security & Configuration
- Never commit private keys or RPC secrets. Use the provided `.env` files and `source .env` when working with Foundry.
- Verify end-to-end locally: deploy with Foundry, use the agent to submit a vote, then confirm proof verification in the frontend.

### Debugging & Logs
- Set `DEBUG=1` to log raw LLM JSON/text and raw x23 API JSON.
- LLM calls log token counts with clear labels (schema name and operation) at info level.
- x23 tool methods log their returned objects at info level with tool-specific labels for quick inspection.
