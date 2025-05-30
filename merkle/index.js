import { buildMerkleTree, createProofForStep } from "./merkle.js";

const steps = [
  "This is a reasoning trace A",
  "This is a second reasoning trace, B",
  "And a third step…",
  "This is a fourth step, C",
  "This is a fifth step, D",
];

// 1) Build tree and get the root
const { tree, root } = buildMerkleTree(steps);
console.log("==== Merkle Root To Save ====");
console.log(root);
console.log("===============================");

// 2) To prove any step:
const { leaf, proof } = createProofForStep(steps, 3);
console.log("Leaf hash:", leaf);
console.log("Proof array:", proof);
