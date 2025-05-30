// SPDX-License-Identifier: MIT
// Copyright (c) 2025 x23.ai B.V. All rights reserved.
// This file is part of the x23.ai platform, which is released under the MIT License.

pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/governance/IGovernor.sol";

contract CastVote is AccessControl {
    /// @dev Monotonic counter for unique vote IDs
    uint256 private _voteCount;

    /// @notice Role granted to AI agent addresses
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    /// @notice Stores each vote’s metadata
    struct Vote {
        address governor;
        uint256 proposalId;
        uint8 support;
        bytes32 merkleRoot;
        bytes32 ipfsDigest;
    }

    /// @notice voteId => Vote data
    mapping(uint256 => Vote) public votes;

    /// @notice governorAddress => proposalId => hasVoted flag
    mapping(address => mapping(uint256 => bool)) public hasVoted;

    /// @notice Emitted when an agent records a vote
    event VoteRecorded(
        uint256 indexed voteId,
        address indexed governor,
        uint256 indexed proposalId,
        uint8 support,
        bytes32 merkleRoot,
        bytes32 ipfsDigest
    );

    /// @param admin Initial admin & agent
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
    }

    /// @notice Grant AGENT_ROLE to additional agent addresses
    function grantAgentRole(
        address agent
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(AGENT_ROLE, agent);
    }

    /**
     * @notice Casts a vote on behalf of the agent, records metadata, and emits an event.
     * @param governor      Address of the GovernorV2 contract
     * @param proposalId    ID of the proposal to vote on
     * @param supportValue  Voting choice (0=Against, 1=For, 2=Abstain)
     * @param reason        Textual justification for the vote
     * @param params        Encoded params for `castVoteWithReasonAndParams`
     * @param merkleRoot    Root of the reasoning‐trace Merkle tree
     * @param ipfsDigest    32‐byte digest of the CIDv1 multihash for the IPFS trace
     * @return voteId       Unique on-chain ID for this vote
     */
    function castVote(
        address governor,
        uint256 proposalId,
        uint8 supportValue,
        string calldata reason,
        bytes calldata params,
        bytes32 merkleRoot,
        bytes32 ipfsDigest
    ) external onlyRole(AGENT_ROLE) returns (uint256) {
        require(!hasVoted[governor][proposalId], "CastVote: already voted");
        hasVoted[governor][proposalId] = true;

        _voteCount++;
        uint256 voteId = _voteCount;

        // 1) Call the Governor’s vote entry point
        IGovernor(governor).castVoteWithReasonAndParams(
            proposalId,
            supportValue,
            reason,
            params
        );

        // 2) Store metadata for on-chain audit
        votes[voteId] = Vote({
            governor: governor,
            proposalId: proposalId,
            support: supportValue,
            merkleRoot: merkleRoot,
            ipfsDigest: ipfsDigest
        });

        // 3) Emit an event for easy off-chain indexing
        emit VoteRecorded(
            voteId,
            governor,
            proposalId,
            supportValue,
            merkleRoot,
            ipfsDigest
        );

        return voteId;
    }

    /**
     * @notice Verify a single reasoning‐step against the stored Merkle root.
     * @param voteId  ID of the vote to verify against
     * @param leaf    Hash of the individual reasoning step
     * @param proof   Merkle proof linking `leaf` to the stored `merkleRoot`
     */
    function verifyStep(
        uint256 voteId,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        return MerkleProof.verify(proof, votes[voteId].merkleRoot, leaf);
    }
}
