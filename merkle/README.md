# WIP

## How to use

1. Generate your reasoning steps
2. Save the merkle root onchain
3. To prove any step is part of the same reasoning steps, `createProofForStep` for the particular step (zero indexed), then verify the raw text with the proof array is part of onchain merkle root (see `frontend`)
