"use client";
import { useEffect, useState } from "react";
import { castVote } from "../lib/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ethers, keccak256, toUtf8Bytes } from "ethers";

export default function HomePage() {
  const [proposalId, setProposalId] = useState("1");
  const [voteData, setVoteData] = useState<any>(null);
  const [leaf, setLeaf] = useState("");
  const [proof, setProof] = useState("[]");
  const [verifyResult, setVerifyResult] = useState<boolean | null>(null);

  async function fetchVote() {
    const id = parseInt(proposalId);
    const data = await castVote.votes(id);
    setVoteData({
      governor: data.governor,
      proposalId: data.proposalId.toString(),
      support: data.supportValue.toString(),
      merkleRoot: data.merkleRoot,
      ipfs: data.ipfsDigest,
    });
  }

  async function runVerify() {
    setVerifyResult(null);
    const id = parseInt(proposalId);
    const leafHash = keccak256(toUtf8Bytes(leaf));
    const proofArray: string[] = JSON.parse(proof);
    const result = await castVote.verifyStep(id, leafHash, proofArray);
    setVerifyResult(result);
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <Card>
        <CardHeader>
          <h2 className="text-xl font-bold">Fetch Vote Metadata</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="number"
            value={proposalId}
            onChange={(e) => setProposalId(e.target.value)}
            placeholder="Proposal ID"
          />
          <Button onClick={fetchVote}>Fetch Vote</Button>
          {voteData && (
            <pre className="bg-gray-100 p-3 rounded">
              {JSON.stringify(voteData, null)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-xl font-bold">Verify Merkle Step</h2>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="text"
            value={leaf}
            onChange={(e) => setLeaf(e.target.value)}
            placeholder="Leaf text"
          />
          <Textarea
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            placeholder="Proof as JSON array of hex strings"
            rows={3}
          />
          <Button onClick={runVerify}>Verify Step</Button>
          {verifyResult !== null && (
            <div>Valid Proof: {verifyResult.toString()}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
