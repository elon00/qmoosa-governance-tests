import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VoteType,
  GovernanceClient,
  buildProposeIntent,
  buildVoteIntent
} from '@qmoosa/governance-sdk';
import {
  GovernanceEngine,
  ProposalState
} from '@qmoosa/governance-engine';
import {
  DEFAULT_GOVERNANCE_CONFIG,
  calculateQuorum
} from '@qmoosa/governance-protocol';

const GUARDIAN = '0x8888888888888888888888888888888888888888';
const PROPOSER = '0x1111111111111111111111111111111111111111';
const VOTER = '0x2222222222222222222222222222222222222222';
const ATTACKER = '0x9999999999999999999999999999999999999999';

test('Negative Control 1: Flash-Loan Vote Borrowing Mitigation', () => {
  const engine = new GovernanceEngine({
    votingDelay: 1,
    votingPeriod: 10,
    proposalThreshold: 100_000n * 10n ** 18n
  });

  engine.recordTotalSupply(1, 10_000_000n * 10n ** 18n);
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);

  const proposalId = engine.createProposal({
    proposer: PROPOSER,
    description: 'Protocol Proposal',
    actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
    currentBlock: 10,
    currentTime: 1000
  });

  // Attacker borrows 10M tokens at block 15 (during active voting)
  engine.recordVotingPower(ATTACKER, 15, 10_000_000n * 10n ** 18n);

  // Voting power at snapshot block 11 is 0
  assert.throws(
    () =>
      engine.castVote({
        voter: ATTACKER,
        proposalId,
        support: VoteType.For,
        currentBlock: 15,
        currentTime: 1050
      }),
    /ZERO_VOTING_POWER/
  );
});

test('Negative Control 2: Double Voting Prevention', () => {
  const engine = new GovernanceEngine({ votingDelay: 1, votingPeriod: 10, proposalThreshold: 100_000n * 10n ** 18n });
  engine.recordTotalSupply(1, 10_000_000n * 10n ** 18n);
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);
  engine.recordVotingPower(VOTER, 1, 1_000_000n * 10n ** 18n);

  const proposalId = engine.createProposal({
    proposer: PROPOSER,
    description: 'Prop',
    actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
    currentBlock: 10,
    currentTime: 1000
  });

  engine.castVote({ voter: VOTER, proposalId, support: VoteType.For, currentBlock: 12, currentTime: 1000 });

  assert.throws(
    () =>
      engine.castVote({ voter: VOTER, proposalId, support: VoteType.For, currentBlock: 12, currentTime: 1000 }),
    /ALREADY_VOTED/
  );
});

test('Negative Control 3: Forged Intent Signature in Proposal Creation', () => {
  const engine = new GovernanceEngine({ proposalThreshold: 100_000n * 10n ** 18n });
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);

  assert.throws(
    () =>
      engine.createProposal({
        proposer: PROPOSER,
        description: 'Forged Signature Proposal',
        actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
        currentBlock: 10,
        currentTime: 1000,
        signature: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      }),
    /INVALID_INTENT_SIGNATURE/
  );
});

test('Negative Control 4: Forged Vote Intent Signature', () => {
  const engine = new GovernanceEngine({ votingDelay: 1, votingPeriod: 10, proposalThreshold: 100_000n * 10n ** 18n });
  engine.recordTotalSupply(1, 10_000_000n * 10n ** 18n);
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);
  engine.recordVotingPower(VOTER, 1, 500_000n * 10n ** 18n);

  const proposalId = engine.createProposal({
    proposer: PROPOSER,
    description: 'Prop',
    actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
    currentBlock: 10,
    currentTime: 1000
  });

  assert.throws(
    () =>
      engine.castVote({
        voter: VOTER,
        proposalId,
        support: VoteType.For,
        currentBlock: 12,
        currentTime: 1000,
        signature: 'badf00dbadf00dbadf00dbadf00dbadf00dbadf00dbadf00dbadf00dbadf00d'
      }),
    /INVALID_INTENT_SIGNATURE/
  );
});

test('Negative Control 5: Premature Timelock Execution', () => {
  const engine = new GovernanceEngine({
    votingDelay: 1,
    votingPeriod: 5,
    proposalThreshold: 100_000n * 10n ** 18n,
    timelockDelay: 86400
  });

  engine.recordTotalSupply(1, 10_000_000n * 10n ** 18n);
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);
  engine.recordVotingPower(VOTER, 1, 1_000_000n * 10n ** 18n);

  const proposalId = engine.createProposal({
    proposer: PROPOSER,
    description: 'Prop',
    actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
    currentBlock: 10,
    currentTime: 1000
  });

  engine.castVote({ voter: VOTER, proposalId, support: VoteType.For, currentBlock: 12, currentTime: 1000 });
  engine.queueProposal(proposalId, 17, 1000);

  // Attempting execution 1 hour before ETA must revert
  assert.throws(
    () => engine.executeProposal(proposalId, 17, 1000 + 82800),
    /TIMELOCK_NOT_MET/
  );
});

test('Negative Control 6: Expired Transaction Execution Past Grace Period', () => {
  const engine = new GovernanceEngine({
    votingDelay: 1,
    votingPeriod: 5,
    proposalThreshold: 100_000n * 10n ** 18n,
    timelockDelay: 86400,
    gracePeriod: 14 * 86400
  });

  engine.recordTotalSupply(1, 10_000_000n * 10n ** 18n);
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);
  engine.recordVotingPower(VOTER, 1, 1_000_000n * 10n ** 18n);

  const proposalId = engine.createProposal({
    proposer: PROPOSER,
    description: 'Prop',
    actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
    currentBlock: 10,
    currentTime: 1000
  });

  engine.castVote({ voter: VOTER, proposalId, support: VoteType.For, currentBlock: 12, currentTime: 1000 });
  const eta = engine.queueProposal(proposalId, 17, 1000);

  // Attempting execution after ETA + grace period
  const expiredTime = eta + 14 * 86400 + 100;
  assert.throws(
    () => engine.executeProposal(proposalId, 17, expiredTime),
    /Expired|TRANSACTION_EXPIRED/
  );
});

test('Negative Control 7: Proposal Threshold Deficit', () => {
  const engine = new GovernanceEngine({ proposalThreshold: 100_000n * 10n ** 18n });
  // Account with 50k tokens (< 100k threshold)
  engine.recordVotingPower(ATTACKER, 1, 50_000n * 10n ** 18n);

  assert.throws(
    () =>
      engine.createProposal({
        proposer: ATTACKER,
        description: 'Under threshold proposal',
        actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
        currentBlock: 10,
        currentTime: 1000
      }),
    /PROPOSAL_THRESHOLD_NOT_MET/
  );
});

test('Negative Control 8: Premature Voting Before Start Block', () => {
  const engine = new GovernanceEngine({ votingDelay: 5, votingPeriod: 10, proposalThreshold: 100_000n * 10n ** 18n });
  engine.recordTotalSupply(1, 10_000_000n * 10n ** 18n);
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);
  engine.recordVotingPower(VOTER, 1, 1_000_000n * 10n ** 18n);

  const proposalId = engine.createProposal({
    proposer: PROPOSER,
    description: 'Prop',
    actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
    currentBlock: 10,
    currentTime: 1000
  });

  // Start block is 15. Attempting to vote at block 12 (Pending state)
  assert.throws(
    () =>
      engine.castVote({
        voter: VOTER,
        proposalId,
        support: VoteType.For,
        currentBlock: 12,
        currentTime: 1000
      }),
    /PROPOSAL_NOT_ACTIVE/
  );
});

test('Negative Control 9: Invalid Vote Type Rejection', () => {
  const engine = new GovernanceEngine({ votingDelay: 1, votingPeriod: 10, proposalThreshold: 100_000n * 10n ** 18n });
  engine.recordTotalSupply(1, 10_000_000n * 10n ** 18n);
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);
  engine.recordVotingPower(VOTER, 1, 1_000_000n * 10n ** 18n);

  const proposalId = engine.createProposal({
    proposer: PROPOSER,
    description: 'Prop',
    actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
    currentBlock: 10,
    currentTime: 1000
  });

  assert.throws(
    () =>
      engine.castVote({
        voter: VOTER,
        proposalId,
        support: 99,
        currentBlock: 12,
        currentTime: 1000
      }),
    /INVALID_VOTE_TYPE/
  );
});

test('Negative Control 10: Unauthorized Guardian Veto Attempt', () => {
  const engine = new GovernanceEngine({
    proposalThreshold: 100_000n * 10n ** 18n,
    guardianAddress: GUARDIAN
  });

  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);
  const proposalId = engine.createProposal({
    proposer: PROPOSER,
    description: 'Prop',
    actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
    currentBlock: 10,
    currentTime: 1000
  });

  assert.throws(
    () => engine.vetoProposal(proposalId, ATTACKER, 'Unauthorized Veto'),
    /UNAUTHORIZED_GUARDIAN/
  );
});

test('Negative Control 11: Unauthorized Guardian Pause Attempt', () => {
  const engine = new GovernanceEngine({ guardianAddress: GUARDIAN });

  assert.throws(
    () => engine.pause(ATTACKER, 1000),
    /UNAUTHORIZED_GUARDIAN/
  );
});

test('Negative Control 12: Defensive Copy Immutability Guarantee', () => {
  const engine = new GovernanceEngine({ proposalThreshold: 100_000n * 10n ** 18n });
  engine.recordVotingPower(PROPOSER, 1, 500_000n * 10n ** 18n);

  const proposalId = engine.createProposal({
    proposer: PROPOSER,
    description: 'Immutable Proposal',
    actions: [{ target: '0xTarget', value: 0n, signature: 'test()', calldata: '0x' }],
    currentBlock: 10,
    currentTime: 1000
  });

  const prop = engine.getProposal(proposalId);
  assert.ok(prop);
  assert.ok(Object.isFrozen(prop));

  assert.throws(() => {
    prop.executed = true;
  });

  assert.throws(() => {
    prop.actions[0].target = '0xHacked';
  });
});
