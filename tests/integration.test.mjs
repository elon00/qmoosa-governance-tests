import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VoteType,
  GovernanceClient,
  buildProposeIntent,
  buildVoteIntent,
  calculateTimelockStatus,
  calculateQuorumMetrics
} from '@qmoosa/governance-sdk';
import {
  GovernanceEngine,
  ProposalState
} from '@qmoosa/governance-engine';
import {
  DEFAULT_GOVERNANCE_CONFIG,
  calculateQuorum,
  resolveProposalState
} from '@qmoosa/governance-protocol';

const GUARDIAN = '0x8888888888888888888888888888888888888888';
const PROPOSER = '0x1111111111111111111111111111111111111111';
const VOTER_A = '0x2222222222222222222222222222222222222222';
const VOTER_B = '0x3333333333333333333333333333333333333333';

test('Integration Reality: End-to-End Governance Lifecycle Across Protocol, Engine & SDK', () => {
  const client = new GovernanceClient();
  const engine = new GovernanceEngine({
    votingDelay: 1,
    votingPeriod: 10,
    proposalThreshold: 100_000n * 10n ** 18n,
    timelockDelay: 86400,
    guardianAddress: GUARDIAN
  });

  const totalSupply = 10_000_000n * 10n ** 18n;
  const quorumRequired = calculateQuorum(totalSupply, 4n, 100n);
  assert.equal(quorumRequired, 400_000n * 10n ** 18n);

  engine.recordTotalSupply(1, totalSupply);
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);
  engine.recordVotingPower(VOTER_A, 1, 800_000n * 10n ** 18n);
  engine.recordVotingPower(VOTER_B, 1, 100_000n * 10n ** 18n);

  let currentBlock = 100;
  let currentTime = 1_700_000_000;

  // Step 1: SDK prepares proposal with validated parameters and signed intent
  const prep = client.preparePropose({
    proposer: PROPOSER,
    description: 'Protocol Treasury Diversification',
    actions: [
      {
        target: '0xTreasuryVault',
        value: 1000n,
        signature: 'allocateFunds(uint256)',
        calldata: '0x00000000000003e8'
      }
    ]
  });

  // Step 2: Engine accepts proposal and validates intent signature
  const proposalId = engine.createProposal({
    proposer: prep.request.proposer,
    description: prep.request.description,
    actions: [...prep.request.actions],
    currentBlock,
    currentTime,
    signature: prep.intent.signature
  });

  assert.equal(proposalId, '1');
  assert.equal(engine.getProposalState(proposalId, currentBlock, currentTime), ProposalState.Pending);

  // Step 3: Advance past voting delay
  currentBlock = 102;
  assert.equal(engine.getProposalState(proposalId, currentBlock, currentTime), ProposalState.Active);

  // Step 4: Voters prepare and cast signed votes
  const votePrepA = client.prepareVote(VOTER_A, proposalId, VoteType.For);
  const weightA = engine.castVote({
    voter: votePrepA.voter,
    proposalId,
    support: votePrepA.support,
    currentBlock,
    currentTime,
    reason: 'Strategic allocation aligned with roadmap',
    signature: votePrepA.intent.signature
  });
  assert.equal(weightA, 800_000n * 10n ** 18n);

  const votePrepB = client.prepareVote(VOTER_B, proposalId, VoteType.Against);
  const weightB = engine.castVote({
    voter: votePrepB.voter,
    proposalId,
    support: votePrepB.support,
    currentBlock,
    currentTime,
    reason: 'Risk tolerance concerns',
    signature: votePrepB.intent.signature
  });
  assert.equal(weightB, 100_000n * 10n ** 18n);

  // Step 5: Quorum metrics verify passing status
  const proposal = engine.getProposal(proposalId);
  assert.ok(proposal);
  const metrics = calculateQuorumMetrics(proposal.forVotes, proposal.abstainVotes, quorumRequired);
  assert.equal(metrics.quorumReached, true);
  assert.equal(metrics.percentageBps, 10000);

  // Step 6: Advance past voting period (101 + 10 = 111)
  currentBlock = 112;
  assert.equal(engine.getProposalState(proposalId, currentBlock, currentTime), ProposalState.Succeeded);

  // Step 7: Queue in timelock
  const eta = engine.queueProposal(proposalId, currentBlock, currentTime);
  assert.equal(eta, currentTime + 86400);

  // SDK Timelock Status inspector verifies locked state
  const statusBeforeEta = calculateTimelockStatus(eta, currentTime);
  assert.equal(statusBeforeEta.status, 'LOCKED');
  assert.equal(statusBeforeEta.isReady, false);
  assert.equal(statusBeforeEta.timeRemainingSeconds, 86400);

  // Step 8: Fast-forward past timelock delay
  currentTime = eta + 60;
  const statusAfterEta = calculateTimelockStatus(eta, currentTime);
  assert.equal(statusAfterEta.status, 'READY');
  assert.equal(statusAfterEta.isReady, true);

  // Step 9: Execute proposal
  const executedActions = engine.executeProposal(proposalId, currentBlock, currentTime);
  assert.equal(executedActions.length, 1);
  assert.equal(executedActions[0].target, '0xTreasuryVault');
  assert.equal(engine.getProposalState(proposalId, currentBlock, currentTime), ProposalState.Executed);
});

test('Integration Reality: Emergency Guardian Veto and Pause Across Subsystems', () => {
  const engine = new GovernanceEngine({
    proposalThreshold: 100_000n * 10n ** 18n,
    guardianAddress: GUARDIAN
  });

  engine.recordTotalSupply(1, 10_000_000n * 10n ** 18n);
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);

  const proposalId = engine.createProposal({
    proposer: PROPOSER,
    description: 'Suspicious Governance Action',
    actions: [{ target: '0xUnverified', value: 0n, signature: 'exploit()', calldata: '0x' }],
    currentBlock: 10,
    currentTime: 1000
  });

  // Emergency Guardian vetoes
  engine.vetoProposal(proposalId, GUARDIAN, 'Unverified contract target detected');
  assert.equal(engine.getProposalState(proposalId, 12, 1000), ProposalState.Vetoed);

  // Emergency Guardian pauses governance
  engine.pause(GUARDIAN, 1000);
  assert.equal(engine.isPaused(1000), true);

  // All proposal creation attempts fail while paused
  assert.throws(
    () =>
      engine.createProposal({
        proposer: PROPOSER,
        description: 'New while paused',
        actions: [{ target: '0xSafe', value: 0n, signature: 'safe()', calldata: '0x' }],
        currentBlock: 12,
        currentTime: 1000
      }),
    /GOVERNANCE_PAUSED/
  );

  // Unpause
  engine.unpause(GUARDIAN);
  assert.equal(engine.isPaused(1000), false);
});
