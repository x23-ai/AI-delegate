pragma solidity ^0.8.18;

/// @dev Minimal stub for GovernorV2-like voting
contract FakeGovernor {
    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        uint8 supportValue,
        uint256 weight
    );
    mapping(uint256 => mapping(address => uint8)) public votes;

    function castVoteWithReasonAndParams(
        uint256 proposalId,
        uint8 supportValue,
        string calldata, // reason
        bytes calldata // params
    ) external returns (uint256) {
        votes[proposalId][msg.sender] = supportValue;
        emit VoteCast(msg.sender, proposalId, supportValue, 0);
        return supportValue;
    }
}
