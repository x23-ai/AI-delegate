import { ethers, JsonRpcProvider } from "ethers";

// Replace with your local deployment addresses
const CAST_VOTE_ADDRESS = process.env.NEXT_PUBLIC_CAST_VOTE_ADDRESS!;
const CAST_VOTE_ABI = [
  "function votes(uint256) view returns (address governor, uint256 proposalId, uint8 supportValue, bytes32 merkleRoot, bytes32 ipfsDigest)",
  "function verifyStep(uint256, bytes32, bytes32[]) view returns (bool)",
  "event VoteRecorded(uint256 indexed voteId, address indexed governor, uint256 indexed proposalId, uint8 supportValue, bytes32 merkleRoot, bytes32 ipfsDigest)",
];

const provider = new JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);
const castVote = new ethers.Contract(
  CAST_VOTE_ADDRESS,
  CAST_VOTE_ABI,
  provider
);

export { castVote };
