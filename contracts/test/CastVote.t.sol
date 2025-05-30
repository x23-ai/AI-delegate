// SPDX-License-Identifier: MIT
// Copyright (c) 2025 x23.ai B.V. All rights reserved.
// This file is part of the x23.ai platform, which is released under the MIT License.

pragma solidity ^0.8.18;

import "forge-std/Test.sol";
import "src/CastVote.sol";

/// @dev A minimal GovernorV2 stub implementing castVoteWithReasonAndParams.
contract FakeGovernor {
    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        uint8 support,
        uint256 weight
    );
    mapping(uint256 => mapping(address => uint8)) public votes;

    function castVoteWithReasonAndParams(
        uint256 proposalId,
        uint8 supportValue,
        string calldata,
        bytes calldata
    ) external returns (uint256) {
        votes[proposalId][msg.sender] = supportValue;
        emit VoteCast(msg.sender, proposalId, supportValue, 0);
        return votes[proposalId][msg.sender];
    }
}

contract CastVoteTest is Test {
    CastVote private castVote;
    FakeGovernor private governor;

    address private admin = address(0xA11CE);
    address private agent = address(0xB0B);
    address private stranger = address(0xC0DE);

    event VoteRecorded(
        uint256 indexed voteId,
        address indexed governor,
        uint256 indexed proposalId,
        uint8 supportValue,
        bytes32 merkleRoot,
        bytes32 ipfsDigest
    );

    function setUp() public {
        // Deploy the CastVote contract with admin
        castVote = new CastVote(admin);

        // Give AGENT_ROLE to our agent address
        vm.prank(admin);
        castVote.grantAgentRole(agent);

        // Deploy a fake Governor
        governor = new FakeGovernor();
    }

    function testOnlyAgentCanCast() public {
        vm.prank(stranger);
        vm.expectRevert();
        castVote.castVote(
            address(governor),
            1,
            1,
            "reason",
            hex"",
            bytes32(0),
            bytes32(0)
        );
    }

    function testHappyPathStoresAndEmits() public {
        bytes32 merkleRoot = keccak256("root");
        bytes32 ipfsDigest = bytes32(uint256(0x1234));

        vm.prank(agent);
        vm.expectEmit(true, true, true, true, address(castVote));
        emit VoteRecorded(1, address(governor), 42, 2, merkleRoot, ipfsDigest);

        uint256 voteId = castVote.castVote(
            address(governor),
            42,
            2,
            "some reason",
            hex"cafebabe",
            merkleRoot,
            ipfsDigest
        );

        // Check storage
        (
            address gov,
            uint256 pid,
            uint8 support,
            bytes32 mr,
            bytes32 ipfs
        ) = castVote.votes(voteId);
        assertEq(gov, address(governor));
        assertEq(pid, 42);
        assertEq(support, 2);
        assertEq(mr, merkleRoot);
        assertEq(ipfs, ipfsDigest);

        // Ensure governor stub recorded the vote
        assertEq(governor.votes(42, address(castVote)), 2);
    }

    function testReplayProtection() public {
        vm.prank(agent);
        castVote.castVote(
            address(governor),
            7,
            1,
            "",
            hex"",
            bytes32(0),
            bytes32(0)
        );

        vm.prank(agent);
        vm.expectRevert("CastVote: already voted");
        castVote.castVote(
            address(governor),
            7,
            1,
            "",
            hex"",
            bytes32(0),
            bytes32(0)
        );
    }

    function testVerifyStepValidProof() public {
        // Build a simple Merkle tree of two leaves: A and B
        bytes32 leafA = keccak256("A");
        bytes32 leafB = keccak256("B");
        (bytes32 first, bytes32 second) = leafA < leafB
            ? (leafA, leafB)
            : (leafB, leafA);
        bytes32 root = keccak256(abi.encodePacked(first, second));

        // Agent casts vote storing this merkle root
        vm.prank(agent);
        uint256 voteId = castVote.castVote(
            address(governor),
            99,
            1,
            "",
            hex"",
            root,
            bytes32(0)
        );

        // Proof that leafA is in the root: proof = [sibling]
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafA < leafB ? leafB : leafA;

        bool valid = castVote.verifyStep(voteId, leafA, proof);
        assertTrue(valid, "Expected proof to be valid");
    }

    function testVerifyStepInvalidProof() public {
        bytes32 badRoot = keccak256("bad");
        vm.prank(agent);
        uint256 voteId = castVote.castVote(
            address(governor),
            100,
            1,
            "",
            hex"",
            badRoot,
            bytes32(0)
        );

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256("somethingElse");

        bool valid = castVote.verifyStep(voteId, keccak256("A"), proof);
        assertFalse(valid, "Expected proof to be invalid");
    }

    function testFuzzSupportAndMetadata(
        uint8 supportValue,
        uint256 pid,
        bytes32 merkleRoot,
        bytes32 ipfs
    ) public {
        vm.assume(supportValue <= 2);

        vm.prank(agent);
        uint256 voteId = castVote.castVote(
            address(governor),
            pid,
            supportValue,
            "fuzz",
            hex"",
            merkleRoot,
            ipfs
        );

        (, , uint8 stored, bytes32 mr, bytes32 ip) = castVote.votes(voteId);
        assertEq(stored, supportValue);
        assertEq(mr, merkleRoot);
        assertEq(ip, ipfs);
    }
}
