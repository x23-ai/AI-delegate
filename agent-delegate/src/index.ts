import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });
import { toUtf8Bytes, keccak256, JsonRpcProvider, Wallet, hexlify } from 'ethers';
import { CID } from 'multiformats/cid';
import { TraceBuilder } from './trace.js';
import { buildMerkleTree } from './utils/merkle.js';
import { uploadJsonToIpfs } from './utils/pinata.js';
import { Contract } from 'ethers';

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

  // 3) Perform onchain tx
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  const agentKey = process.env.AGENT_PRIVATE_KEY;
  if (!agentKey) {
    throw new Error('AGENT_PRIVATE_KEY is not set in .env');
  }
  const agentWallet = new Wallet(agentKey, provider);
  const cidObj = CID.parse(cid);
  const ipfsDigest = hexlify(cidObj.multihash.digest);
  console.log('IPFS digest:', ipfsDigest);

  const CAST_VOTE_ADDRESS = process.env.CAST_VOTE_ADDRESS;
  const GOVERNOR_ADDRESS = process.env.GOVERNOR_ADDRESS;
  if (!CAST_VOTE_ADDRESS || !GOVERNOR_ADDRESS) {
    throw new Error('CAST_VOTE_ADDRESS or GOVERNOR_ADDRESS is not set in .env');
  }
  const contract = new Contract(
    CAST_VOTE_ADDRESS,
    [
      'function castVote(address governor, uint256 proposalId, uint8 support, string memory reason, bytes params, bytes32 merkletRoot, bytes32 ipfsDigest) external',
    ],
    agentWallet
  );

  const support = 1;
  const reason = `Agent ${agentId} voted FOR proposal ${proposalId}. See reasoning trace on IPFS: ${cid}`;
  const params = '0x';

  console.log('Casting vote...');
  const tx = await contract.castVote(
    GOVERNOR_ADDRESS,
    proposalId,
    support,
    reason,
    params,
    merkleRoot,
    ipfsDigest
  );
  console.log('Vote transaction sent:', tx.hash);
  const receipt = await tx.wait();
  console.log('Vote transaction confirmed:', receipt.transactionHash);
  console.log('Gas used:', receipt.gasUsed.toString());

  console.log('Agent trace successfully submitted for proposal', proposalId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
