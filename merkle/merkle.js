import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import { keccak256 as ethersKeccak, toUtf8Bytes } from "ethers";

/**
 * @param {string[]} steps
 * @returns {{ tree: MerkleTree, leaves: Buffer[], root: string }}
 *   - tree   : the MerkleTree instance
 *   - leaves : array of hashed leaves (Buffers)
 *   - root   : hex-prefixed root ("0x...")
 */
export function buildMerkleTree(steps) {
  // 1) Hash each reasoning step into a Buffer
  const leaves = steps.map((step) =>
    Buffer.from(ethersKeccak(toUtf8Bytes(step)).slice(2), "hex")
  );

  // 2) Build an _ordered_ Merkle tree (no sorting of pairs)
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: false });

  // 3) Extract root as a hex string
  const root = "0x" + tree.getRoot().toString("hex");

  return { tree, leaves, root };
}

/**
 * @param {MerkleTree} tree
 * @param {Buffer|string} leaf
 * @returns {string[]}  array of hex-prefixed sibling hashes
 */
export function getProof(tree, leaf) {
  // Accept either the Buffer leaf (from buildMerkleTree) or the hex string
  const buffLeaf =
    typeof leaf === "string" ? Buffer.from(leaf.slice(2), "hex") : leaf;

  return tree.getProof(buffLeaf).map((p) => "0x" + p.data.toString("hex"));
}

/**
 * @param {string[]} steps
 * @param {number} index  zero-based index of the step you want to prove
 * @returns {{
 *   root: string,
 *   leaf: string,
 *   proof: string[],
 * }}
 */
export function createProofForStep(steps, index) {
  if (index < 0 || index >= steps.length) {
    throw new Error("Index out of range");
  }
  const { tree, leaves, root } = buildMerkleTree(steps);
  const leafBuf = leaves[index];
  const leaf = "0x" + leafBuf.toString("hex");
  const proof = getProof(tree, leafBuf);
  return { root, leaf, proof };
}
