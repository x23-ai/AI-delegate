# Repository Guidelines

## Project Structure & Modules
- `contracts/`: Foundry Solidity contracts and tests (`src/`, `test/`).
- `agent-delegate/`: TypeScript agent that builds a reasoning trace, uploads to IPFS, and submits onchain votes (`src/`).
- `frontend/`: Next.js + Tailwind app for verifying Merkle proofs against onchain data (`app/`, `components/`, `lib/`).
- `merkle/`: Node helpers for Merkle roots/proofs (`merkle.js`, `index.js`).
- Env files: `contracts/.env`, `agent-delegate/.env`, `frontend/.env.local` (never commit secrets).

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
