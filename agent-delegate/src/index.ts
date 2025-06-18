import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });
import { toUtf8Bytes, keccak256 } from 'ethers';
import { TraceBuilder } from './trace.js';
import { buildMerkleTree } from './utils/merkle.js';
import { uploadJsonToIpfs } from './utils/pinata.js';

async function main() {
  const proposalId = Number(process.env.PROPOSAL_ID || '1');
  const agentId = process.env.AGENT_ID || 'agent-1';

  const traceBuilder = new TraceBuilder(proposalId, agentId);

  // Example steps
  traceBuilder.addStep({
    type: 'fetchOnchain',
    description: 'Loaded proposal data from RPC',
    references: [{ source: 'Ethereum', uri: process.env.RPC_URL! }],
  });

  traceBuilder.addStep({
    type: 'analysis',
    description: 'Analyzed sentiment and on-chain metrics',
  });

  traceBuilder.addStep({
    type: 'decision',
    description: 'Decided to vote FOR based on analysis',
    output: { vote: 'for' },
  });

  const trace = traceBuilder.getTrace();
  // console.log('Built trace:', trace);

  // 1) Publish to IPFS
  const cid = await uploadJsonToIpfs(trace, `${agentId}-trace-proposal${proposalId}.json`);
  console.log('Published trace CID:', cid);

  // 2) Build Merkle root over steps
  const stepHashes = trace.steps.map((s) => keccak256(toUtf8Bytes(JSON.stringify(s))));
  const { root: merkleRoot } = buildMerkleTree(trace.steps.map((s) => JSON.stringify(s)));
  console.log('Merkle root:', merkleRoot);
  console.log('step hashes:', stepHashes);

  // TODO: wire ethers signer + CastVote contract call here
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
