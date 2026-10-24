// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

contract AgentLedger {
    enum Role { DATA, ANALYSIS, REPORT }
    enum Status { OPEN, ASSIGNED, SUBMITTED, VERIFIED_PASS, VERIFIED_FAIL }

    struct Agent {
        bool registered;
        uint8 roleMask;
        string manifestURI;
        bytes32 manifestHash;
    }

    struct Task {
        bool exists;
        bytes32 runId;
        Role role;
        uint32 attempt;
        address assignee;
        bytes32 inputHash;
        bytes32 criteriaHash;
        bytes32 decisionHash;
        address validator;
        Status status;
        bytes32 artifactHash;
        string artifactURI;
        bytes32 evidenceHash;
        string evidenceURI;
    }

    struct Reputation { uint256 passCount; uint256 failCount; }

    error UNAUTHORIZED();
    error STALE_ATTEMPT();
    error DUPLICATE_OUTCOME();
    error ARTIFACT_MISMATCH();
    error INVALID_ARGUMENT();
    error INVALID_STATE();
    error TASK_EXISTS();
    error TASK_NOT_FOUND();
    error ROLE_MISMATCH();

    address public immutable coordinator;
    mapping(address => Agent) private agents;
    mapping(bytes32 => Task) private tasks;
    mapping(address => mapping(Role => Reputation)) private reputations;

    event AgentRegistered(address indexed agentId, uint8 roleMask, string manifestURI, bytes32 manifestHash);
    event TaskAssigned(
        bytes32 indexed runId, bytes32 indexed taskId, uint32 indexed attempt,
        Role role, address assignee, bytes32 inputHash, bytes32 criteriaHash,
        bytes32 decisionHash, address validator
    );
    event ArtifactSubmitted(
        bytes32 indexed runId, bytes32 indexed taskId, uint32 indexed attempt,
        address producer, bytes32 artifactHash, string artifactURI
    );
    event OutcomeRecorded(
        bytes32 indexed runId, bytes32 indexed taskId, uint32 indexed attempt,
        address assignee, Role role, bool passed, bytes32 artifactHash,
        bytes32 evidenceHash, string evidenceURI, address validator
    );

    constructor(address coordinator_) {
        if (coordinator_ == address(0)) revert INVALID_ARGUMENT();
        coordinator = coordinator_;
    }

    function registerAgent(Role[] calldata roles, string calldata manifestURI, bytes32 manifestHash) external {
        if (roles.length == 0 || bytes(manifestURI).length == 0 || manifestHash == bytes32(0)) {
            revert INVALID_ARGUMENT();
        }
        uint8 mask;
        for (uint256 i; i < roles.length; ++i) {
            mask |= uint8(1 << uint8(roles[i]));
        }
        agents[msg.sender] = Agent(true, mask, manifestURI, manifestHash);
        emit AgentRegistered(msg.sender, mask, manifestURI, manifestHash);
    }

    function assignTask(
        bytes32 runId, bytes32 taskId, uint32 attempt, Role role, address assignee,
        bytes32 inputHash, bytes32 criteriaHash, bytes32 decisionHash, address validator
    ) external {
        if (msg.sender != coordinator) revert UNAUTHORIZED();
        if (attempt != 1) revert STALE_ATTEMPT();
        if (tasks[taskId].exists) revert TASK_EXISTS();
        if (
            runId == bytes32(0) || taskId == bytes32(0) || inputHash == bytes32(0) ||
            criteriaHash == bytes32(0) || decisionHash == bytes32(0) ||
            assignee == address(0) || validator == address(0) || validator == assignee
        ) revert INVALID_ARGUMENT();
        if (!agents[assignee].registered || (agents[assignee].roleMask & uint8(1 << uint8(role))) == 0) {
            revert ROLE_MISMATCH();
        }
        Task storage task = tasks[taskId];
        task.exists = true;
        task.runId = runId;
        task.role = role;
        task.attempt = attempt;
        task.assignee = assignee;
        task.inputHash = inputHash;
        task.criteriaHash = criteriaHash;
        task.decisionHash = decisionHash;
        task.validator = validator;
        task.status = Status.ASSIGNED;
        emit TaskAssigned(runId, taskId, attempt, role, assignee, inputHash, criteriaHash, decisionHash, validator);
    }

    function submitArtifact(bytes32 taskId, uint32 attempt, bytes32 artifactHash, string calldata artifactURI) external {
        Task storage task = currentTask(taskId, attempt);
        if (msg.sender != task.assignee) revert UNAUTHORIZED();
        if (task.status != Status.ASSIGNED) revert INVALID_STATE();
        if (artifactHash == bytes32(0) || bytes(artifactURI).length == 0) revert INVALID_ARGUMENT();
        task.artifactHash = artifactHash;
        task.artifactURI = artifactURI;
        task.status = Status.SUBMITTED;
        emit ArtifactSubmitted(task.runId, taskId, attempt, msg.sender, artifactHash, artifactURI);
    }

    function recordOutcome(
        bytes32 taskId, uint32 attempt, bool passed, bytes32 artifactHash,
        bytes32 evidenceHash, string calldata evidenceURI
    ) external {
        Task storage task = currentTask(taskId, attempt);
        if (msg.sender != task.validator) revert UNAUTHORIZED();
        if (task.status == Status.VERIFIED_PASS || task.status == Status.VERIFIED_FAIL) revert DUPLICATE_OUTCOME();
        if (task.status != Status.SUBMITTED) revert INVALID_STATE();
        if (task.artifactHash != artifactHash) revert ARTIFACT_MISMATCH();
        if (evidenceHash == bytes32(0) || bytes(evidenceURI).length == 0) revert INVALID_ARGUMENT();
        task.status = passed ? Status.VERIFIED_PASS : Status.VERIFIED_FAIL;
        task.evidenceHash = evidenceHash;
        task.evidenceURI = evidenceURI;
        Reputation storage reputation = reputations[task.assignee][task.role];
        if (passed) ++reputation.passCount;
        else ++reputation.failCount;
        emit OutcomeRecorded(
            task.runId, taskId, attempt, task.assignee, task.role, passed,
            artifactHash, evidenceHash, evidenceURI, msg.sender
        );
    }

    function getAgent(address agentId) external view returns (Agent memory) { return agents[agentId]; }
    function getTask(bytes32 taskId) external view returns (Task memory) { return tasks[taskId]; }

    function getRoleReputation(address agentId, Role role) external view returns (uint256 passCount, uint256 failCount) {
        Reputation storage reputation = reputations[agentId][role];
        return (reputation.passCount, reputation.failCount);
    }

    function currentTask(bytes32 taskId, uint32 attempt) private view returns (Task storage task) {
        task = tasks[taskId];
        if (!task.exists) revert TASK_NOT_FOUND();
        if (task.attempt != attempt) revert STALE_ATTEMPT();
    }
}
