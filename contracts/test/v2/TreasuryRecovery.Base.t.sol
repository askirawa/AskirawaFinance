// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {TreasuryRecovery} from "../../v2/TreasuryRecovery.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";

/// @notice Shared fixtures for the Treasury v2 recovery suite (B-c on B-a).
/// Default deployment (see AskirawaTreasuryTestBase): approvers approver1..3 quorum 2, guardian, and the recovery
/// council council1..3 with threshold 2. The replacement configuration installs nA1..nA3 (quorum 2), nGuardian
/// and the replacement council nC1..nC3. Time is always read with vm.getBlockTimestamp().
abstract contract TreasuryRecoveryBase is AskirawaTreasuryTestBase {
    uint64 internal constant INACTIVITY = 30 days;
    uint64 internal constant DELAY = 14 days;
    uint64 internal constant COOLING = 7 days;
    uint64 internal constant VOTING_WINDOW = 7 days;
    uint64 internal constant EXEC_WINDOW = 14 days;

    address internal nA1 = makeAddr("replacementApprover1");
    address internal nA2 = makeAddr("replacementApprover2");
    address internal nA3 = makeAddr("replacementApprover3");
    address internal nGuardian = makeAddr("replacementGuardian");
    address internal nC1 = makeAddr("replacementCouncil1");
    address internal nC2 = makeAddr("replacementCouncil2");
    address internal nC3 = makeAddr("replacementCouncil3");

    function setUp() public virtual override {
        super.setUp();
    }

    // ------------------------------------------------------------ configuration builders
    function _replacement() internal view returns (AskirawaTreasury.GovernancePayload memory c) {
        c.approvers = _arr(nA1, nA2, nA3);
        c.proposers = new address[](1);
        c.proposers[0] = nA1;
        c.quorum = 2;
        c.guardian = nGuardian;
        c.payrollDelay = PAYROLL_DELAY;
        c.configDelay = CONFIG_DELAY;
    }

    function _newCouncil() internal view returns (address[] memory) { return _arr(nC1, nC2, nC3); }

    // ------------------------------------------------------------ time
    function _warpEligible() internal { vm.warp(rec.recoveryEligibleAt()); }

    // ------------------------------------------------------------ recovery actions
    function _initiateCfg(address by, AskirawaTreasury.GovernancePayload memory c, address[] memory council, uint8 thr)
        internal returns (uint256 id) {
        vm.prank(by);
        id = rec.initiateRecovery(c, council, thr);
    }

    function _initiate(address by) internal returns (uint256) {
        return _initiateCfg(by, _replacement(), _newCouncil(), 2);
    }

    function _councilApprove(uint256 id, address by) internal { vm.prank(by); rec.approveRecovery(id); }

    function _veto(uint256 id, address by) internal { vm.prank(by); rec.vetoRecovery(id); }

    function _execRecovery(uint256 id) internal { vm.prank(outsider); rec.executeRecovery(id); }

    /// @dev Eligible, initiated by council1, approved by council2: now in the 14 day timelock.
    function _timelocked() internal returns (uint256 id) {
        _warpEligible();
        id = _initiate(council1);
        _councilApprove(id, council2);
    }

    /// @dev Full successful recovery. Returns the recovery id.
    function _recoverNow() internal returns (uint256 id) {
        id = _timelocked();
        vm.warp(_now() + DELAY);
        _execRecovery(id);
    }

    function _rs(uint256 id) internal view returns (TreasuryRecovery.Recovery memory r) {
        (r.status, r.epoch, r.vetoQuorum, r.initiator, r.initiatedAt, r.approvedAt, r.executableAt, r.expiresAt,
            r.approvals, r.vetoes, r.payloadHash) = rec.recoveries(id);
    }

    function _recStatus(uint256 id) internal view returns (TreasuryRecovery.Status) { return _rs(id).status; }

    function _fundsOf() internal view returns (uint256) { return usdc.balanceOf(address(t)); }
}
