import { MerkleTree } from 'merkletreejs';
import keccak256 from 'keccak256';
import { keccak256 as ethersKeccak, toUtf8Bytes } from 'ethers';

/**
 * Result of building a Merkle tree.
 */
export interface MerkleTreeResult {
  tree: MerkleTree;
  leaves: Buffer[];
  root: string; // Hex-string root, 0x-prefixed
}

/**
 * Builds an ordered Merkle tree from an array of string steps.
 * @param steps Array of reasoning step strings.
 * @returns MerkleTree instance, leaf buffers, and hex-encoded root.
 */
export function buildMerkleTree(steps: string[]): MerkleTreeResult {
  // 1) Hash each step to a Buffer using ethers.js keccak256
  const leaves: Buffer[] = steps.map((step) =>
    Buffer.from(ethersKeccak(toUtf8Bytes(step)).slice(2), 'hex')
  );

  // 2) Construct the Merkle tree without sorting pairs (preserves order)
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: false });

  // 3) Compute the root as a 0x-prefixed hex string
  const root = '0x' + tree.getRoot().toString('hex');

  return { tree, leaves, root };
}

/**
 * Generates a proof array for a given leaf in the Merkle tree.
 * @param tree The MerkleTree instance.
 * @param leaf Either a Buffer leaf or 0x-prefixed hex string.
 * @returns Array of 0x-prefixed hex sibling hashes.
 */
export function getProof(tree: MerkleTree, leaf: Buffer | string): string[] {
  const leafBuf: Buffer = typeof leaf === 'string' ? Buffer.from(leaf.slice(2), 'hex') : leaf;
  return tree.getProof(leafBuf).map((node) => '0x' + node.data.toString('hex'));
}

/**
 * Proof result object for a specific step index.
 */
export interface ProofResult {
  root: string; // Hex-encoded Merkle root
  leaf: string; // Hex-encoded leaf hash
  proof: string[]; // Proof array of sibling hashes
}

/**
 * Creates a proof for a single step by index.
 * @param steps Array of reasoning step strings.
 * @param index Zero-based index of the step to prove.
 * @returns ProofResult containing root, leaf, and proof array.
 */
export function createProofForStep(steps: string[], index: number): ProofResult {
  if (index < 0 || index >= steps.length) {
    throw new Error('Index out of range');
  }
  const { tree, leaves, root } = buildMerkleTree(steps);
  const leafBuf = leaves[index];
  const leaf = '0x' + leafBuf.toString('hex');
  const proof = getProof(tree, leafBuf);
  return { root, leaf, proof };
}
