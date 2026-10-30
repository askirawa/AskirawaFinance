// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {TreasuryRecovery} from "../../v2/TreasuryRecovery.sol";
import {TreasuryRecoveryBase} from "./TreasuryRecovery.Base.t.sol";

/// @dev Drives random recovery, veto, payroll and time actions. Every call is wrapped so reverts are not failures.
/// Only the functions listed in the invariant test's selector list are fuzz targets.
contract RecoveryHandler is Test {
    AskirawaTreasury internal t;
    TreasuryRecovery internal rec;
    address internal constant PAYEE = address(0x1234abcd);
    bytes32 internal constant MEMO = keccak256("INV_MEMO");

    uint256 public paidTotal;
    uint64[] public executedAt;

    constructor(AskirawaTreasury t_, TreasuryRecovery r_) {
        t = t_;
        rec = r_;
    }

    function _accts(uint256 n, uint256 start) internal pure returns (address[] memory r) {
        r = new address[](n);
        for (uint256 i; i < n; ++i) r[i] = vm.addr(1000 + start + i);
    }

    function _pickCouncil(uint256 s) internal view returns (address) {
        address[] memory m = rec.councilMembers();
        return m[s % m.length];
    }

    function _pickApprover(uint256 s) internal view returns (address) {
        address[] memory a = t.approvers();
        return a[s % a.length];
    }

    function warp(uint256 secs) external { vm.warp(vm.getBlockTimestamp() + (secs % 25 days)); }

    function initiate(uint256 s, uint256 salt) external {
        AskirawaTreasury.GovernancePayload memory c;
        // a fresh, unique roster each time so replacement councils never collide with earlier ones
        c.approvers = _accts(3, 1000 + (salt % 50) * 10);
        c.proposers = new address[](0);
        c.quorum = 2;
        c.payrollDelay = t.payrollDelay();
        c.configDelay = t.configDelay();
        address[] memory nc = _accts(3, 2000 + (salt % 50) * 10);
        address who = _pickCouncil(s);
        vm.prank(who);
        try rec.initiateRecovery(c, nc, 2) {} catch {}
    }

    // NOTE: every external read happens BEFORE vm.prank, because a prank applies to the very next call.
    function approve(uint256 s) external {
        uint256 id = rec.nextRecoveryId() - 1;
        address who = _pickCouncil(s);
        vm.prank(who);
        try rec.approveRecovery(id) {} catch {}
    }

    function veto(uint256 s) external {
        uint256 id = rec.nextRecoveryId() - 1;
        address who = _pickApprover(s);
        vm.prank(who);
        try rec.vetoRecovery(id) {} catch {}
    }

    function cancel(uint256 s) external {
        uint256 id = rec.nextRecoveryId() - 1;
        address who = _pickCouncil(s);
        vm.prank(who);
        try rec.cancelRecovery(id) {} catch {}
    }

    function expire() external { try rec.expireRecovery(rec.activeRecoveryId()) {} catch {} }

    function execute() external {
        uint256 id = rec.nextRecoveryId() - 1;
        uint256 epochBefore = t.currentEpoch();
        try rec.executeRecovery(id) {
            if (t.currentEpoch() == epochBefore + 1) executedAt.push(uint64(vm.getBlockTimestamp()));
        } catch {}
    }

    /// @dev Ordinary activity by the current approvers: a small payroll that may or may not pass the gates.
    function payroll(uint256 s) external {
        address[] memory a = t.approvers();
        if (a.length < 2) return;
        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](1);
        items[0] = AskirawaTreasury.Payment(PAYEE, 1e6);
        uint64 exp = uint64(vm.getBlockTimestamp()) + 30 days;
        address proposer = a[s % a.length];
        address second = a[(s + 1) % a.length];
        vm.prank(proposer);
        try t.proposePayroll(items, exp, MEMO) returns (uint256 id) {
            vm.prank(second);
            try t.approve(id) {} catch {}
            uint32 delay = t.payrollDelay();
            vm.warp(vm.getBlockTimestamp() + delay);
            try t.execute(id) { paidTotal += 1e6; } catch {}
        } catch {}
    }

    function executedLength() external view returns (uint256) { return executedAt.length; }
}

/// @notice REC invariants: the recovery contract never moves value, only one recovery is live, recoveries are spaced.
/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 120
contract TreasuryRecoveryInvariantTest is StdInvariant, TreasuryRecoveryBase {
    RecoveryHandler internal h;
    uint256 internal initialFunds;

    function setUp() public override {
        super.setUp();
        h = new RecoveryHandler(t, rec);
        initialFunds = _fundsOf();
        targetContract(address(h));
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = RecoveryHandler.warp.selector;
        selectors[1] = RecoveryHandler.initiate.selector;
        selectors[2] = RecoveryHandler.approve.selector;
        selectors[3] = RecoveryHandler.veto.selector;
        selectors[4] = RecoveryHandler.cancel.selector;
        selectors[5] = RecoveryHandler.execute.selector;
        selectors[6] = RecoveryHandler.payroll.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: selectors}));
    }

    /// @dev Guards against a vacuous campaign: the handler can really drive a recovery to execution.
    function test_Handler_CanReachAnExecutedRecoveryAndAVeto() public {
        h.warp(24 days);
        h.initiate(0, 0);
        h.approve(1);
        h.warp(14 days);
        h.execute();
        assertEq(h.executedLength(), 1);
        assertEq(t.currentEpoch(), 2);
        // second recovery: after 30 quiet days, vetoed by two of the new approvers
        h.warp(24 days);
        h.warp(24 days);
        h.initiate(2, 1);
        h.approve(0);
        h.veto(0);
        h.veto(1);
        assertEq(uint8(_rs(2).status), uint8(TreasuryRecovery.Status.Vetoed));
    }

    function invariant_TreasuryFundsOnlyChangeThroughOrdinaryPayroll() public view {
        assertEq(_fundsOf(), initialFunds - h.paidTotal());
        assertEq(usdc.balanceOf(address(rec)), 0);
    }

    function invariant_AtMostOneLiveRecoveryAndItIsInAnOpenState() public view {
        uint256 live = rec.activeRecoveryId();
        if (live == 0) return;
        TreasuryRecovery.Status s = _rs(live).status;
        assertTrue(s == TreasuryRecovery.Status.Voting || s == TreasuryRecovery.Status.Timelocked);
        uint256 open;
        for (uint256 id = 1; id < rec.nextRecoveryId(); ++id) {
            TreasuryRecovery.Status st = _rs(id).status;
            if (st == TreasuryRecovery.Status.Voting || st == TreasuryRecovery.Status.Timelocked) ++open;
        }
        assertEq(open, 1);
    }

    function invariant_EpochAdvancesOnlyThroughExecutedRecoveries() public view {
        assertEq(t.currentEpoch(), 1 + h.executedLength());
    }

    function invariant_ExecutedRecoveriesAreAtLeastFortyFourDaysApart() public view {
        for (uint256 i = 1; i < h.executedLength(); ++i) {
            assertGe(uint256(h.executedAt(i)) - uint256(h.executedAt(i - 1)), uint256(INACTIVITY + DELAY));
        }
    }

    function invariant_CouncilIsNeverAnApproverOrTheGuardian() public view {
        address[] memory members = rec.councilMembers();
        for (uint256 i; i < members.length; ++i) {
            assertFalse(t.isApprover(members[i]));
            assertTrue(members[i] != t.guardian());
        }
    }
}
