# QMOOSA Governance Tests (`qmoosa-governance-tests`)

## Overview
Part of the **QMOOSA 1,000 Crypto Projects Mission — Domain 1 (DeFi & Financial Invariants)**.
Repository ID: `050/1000`.

`qmoosa-governance-tests` enforces the multi-repository reality gates, hermetic build reproducibility, and adversarial negative controls across Batch 10 (`qmoosa-governance-*`):
- **Gate 1: Archive Integrity**: Verifies SHA-256 hashes of pinned tarballs (`@qmoosa/governance-protocol`, `@qmoosa/governance-engine`, `@qmoosa/governance-sdk`).
- **Gate 2: Source Provenance**: Verifies pinned commit ancestry in sibling source repositories.
- **Gate 3: Hermetic Rebuild & Canonical Comparison**: Cleanly rebuilds every package from source and enforces 100% byte-for-byte equality against distributed tarball artifacts.
- **Gate: Current-HEAD Alignment**: Ensures sibling git HEADs strictly align with pinned manifest commits.
- **Integration Test Suite**: Verifies end-to-end governance lifecycle from proposal creation, signed intent verification, voting checkpoints, timelock queueing, and execution.
- **Adversarial Negative Control Suite**: 12 exploit vectors covering flash-loan vote borrowing, double voting, forged intent signatures, premature execution, expired execution, threshold deficits, and unauthorized guardian interventions.

## Verification
- Gate 1 (Archive): PASS
- Gate 2 (Provenance): PASS
- Gate 3 (Canonical Rebuild): PASS
- Integration Tests: 2 passing
- Negative Controls: 12 passing
- Zero-Spend Invariant: $0.00 spent on live networks. Mainnet and public testnets remain strictly locked.
