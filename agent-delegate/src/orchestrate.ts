import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });
import { TraceBuilder } from './trace.js';
import { X23Client } from './tools/x23.js';
import { runConductor } from './agents/conductor.js';
import { createLLM } from './llm/index.js';
import type { AgentContext } from './agents/types.js';

async function main() {
  const proposalId = Number(process.env.PROPOSAL_ID || '1');
  const agentId = process.env.AGENT_ID || 'conductor-1';
  const sources = (process.env.PROPOSAL_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const trace = new TraceBuilder(proposalId, agentId);
  const x23 = new X23Client({ apiKey: process.env.X23_API_KEY });

  const ctx: AgentContext = {
    proposal: { id: proposalId, title: process.env.PROPOSAL_TITLE, description: process.env.PROPOSAL_DESC, sources },
    x23,
    trace,
    cache: new Map(),
  };

  const llm = createLLM();
  const result = await runConductor(ctx, llm);
  console.log('Conductor pipeline result:', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
