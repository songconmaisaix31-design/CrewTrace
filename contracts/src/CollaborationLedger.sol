// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

contract CollaborationLedger {
    enum Kind { AGENT, TASK, PROPOSAL, CLAIM, HANDOFF }

    struct Commitment {
        Kind kind;
        bytes32 recordId;
        uint32 version;
        bytes32 contentHash;
        string uri;
        address recorder;
        uint64 recordedAt;
    }

    error UNAUTHORIZED();
    error INVALID_ARGUMENT();
    error DUPLICATE_COMMITMENT();

    address public immutable recorder;
    mapping(bytes32 => Commitment) private commitments;

    event CommitmentRecorded(
        Kind indexed kind, bytes32 indexed recordId, uint32 indexed version,
        bytes32 contentHash, string uri, address recorder
    );

    constructor(address recorder_) {
        if (recorder_ == address(0)) revert INVALID_ARGUMENT();
        recorder = recorder_;
    }

    function record(Kind kind, bytes32 recordId, uint32 version, bytes32 contentHash, string calldata uri) external {
        if (msg.sender != recorder) revert UNAUTHORIZED();
        if (recordId == bytes32(0) || version == 0 || contentHash == bytes32(0) || bytes(uri).length == 0) {
            revert INVALID_ARGUMENT();
        }
        bytes32 key = commitmentKey(kind, recordId, version);
        if (commitments[key].recordedAt != 0) revert DUPLICATE_COMMITMENT();
        commitments[key] = Commitment(kind, recordId, version, contentHash, uri, msg.sender, uint64(block.timestamp));
        emit CommitmentRecorded(kind, recordId, version, contentHash, uri, msg.sender);
    }

    function commitmentKey(Kind kind, bytes32 recordId, uint32 version) public pure returns (bytes32) {
        return keccak256(abi.encode(kind, recordId, version));
    }

    function getCommitment(Kind kind, bytes32 recordId, uint32 version) external view returns (Commitment memory) {
        return commitments[commitmentKey(kind, recordId, version)];
    }
}
