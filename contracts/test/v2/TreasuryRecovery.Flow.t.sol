// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {TreasuryRecovery} from "../../v2/TreasuryRecovery.sol";
import {TreasuryRecoveryBase} from "./TreasuryRecovery.Base.t.sol";

/// @notice REC group, part 1: the recovery state machine, authorization, timing and validation.
contract TreasuryRecoveryFlowTest is TreasuryRecoveryBase {
    // ------------------------------------------------------------ normal recovery
    function test_REC01_NormalRecoveryInstallsReplacementGovernance() public {
        _warpEligible();
        uint64 t0 = _now();
        vm.expectEmit(true, true, true, false, address(rec));
        emit TreasuryRecovery.RecoveryInitiated(1, council1, 1, bytes32(0), 0);
        uint256 id = _initiate(council1);
        assertEq(id, 1);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Voting));
        assertEq(_rs(id).approvals, 1, "initiator's approval counts");
        assertEq(rec.activeRecoveryId(), id);

        vm.expectEmit(true, false, false, true, address(rec));
        emit TreasuryRecovery.RecoveryQuorumReached(id, t0, t0 + DELAY, t0 + DELAY + EXEC_WINDOW);
        _councilApprove(id, council2);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Timelocked));
        assertEq(_rs(id).executableAt, t0 + DELAY);

        vm.warp(t0 + DELAY);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.RecoveryInstalled(2, t0 + DELAY + COOLING);
        vm.expectEmit(true, true, false, true, address(rec));
        emit TreasuryRecovery.RecoveryExecuted(id, 2, t0 + DELAY + COOLING);
        _execRecovery(id);

        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Executed));
        assertEq(t.currentEpoch(), 2);
        address[] memory a = t.approvers();
        assertEq(a.length, 3);
        assertEq(a[0], nA1);
        assertEq(t.quorum(), 2);
        assertEq(t.guardian(), nGuardian);
        assertTrue(t.isProposer(nA1));
        assertFalse(t.isApprover(approver1), "old approvers lose power");
        assertTrue(rec.isCouncilMember(nC1));
        assertFalse(rec.isCouncilMember(council1), "old council replaced");
        assertEq(rec.councilMembers().length, 3);
        assertEq(rec.activeRecoveryId(), 0);
        assertEq(t.lastActivityAt(), t0 + DELAY);
        assertEq(t.coolingEnd(), t0 + DELAY + COOLING);
    }

    function test_REC02_LostTwoOfThreeApproverKeysThenRecovery() public {
        // approver2 and approver3 are lost: approver1 alone can never reach quorum 2
        uint256 pid = _proposePayroll(approver1, payee1, 10e6);
        vm.warp(_now() + 3 days);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.QuorumNotReached.selector, pid, 1, 2));
        _exec(pid);
        // governance cannot rotate the lost keys either
        uint256 gid = _proposeGov(approver1, _replacement());
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.QuorumNotReached.selector, gid, 1, 2));
        _exec(gid);

        uint256 id = _recoverNow();
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Executed));
        // new approvers can operate after the cooling period, with the normal timelock
        vm.warp(t.coolingEnd());
        uint256 p2 = _newPayroll(nA1, payee1, 25e6);
        _newApprove(p2, nA1, nA2);
        vm.warp(_now() + PAYROLL_DELAY);
        _exec(p2);
        assertEq(usdc.balanceOf(payee1), 25e6);
    }

    // ------------------------------------------------------------ council votes
    function test_REC03_InsufficientCouncilVotes() public {
        _warpEligible();
        uint256 id = _initiate(council1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.WrongState.selector, id, TreasuryRecovery.Status.Voting));
        _execRecovery(id);
        vm.warp(_now() + VOTING_WINDOW);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.RecoveryStale.selector, id, 1));
        _councilApprove(id, council2);
        rec.expireRecovery(id);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Expired));
        assertEq(rec.activeRecoveryId(), 0);
        // a fresh attempt is possible and still needs two approvals
        uint256 id2 = _initiate(council3);
        assertEq(uint8(_recStatus(id2)), uint8(TreasuryRecovery.Status.Voting));
    }

    function test_REC04_DuplicateCouncilAndVetoVotesRejected() public {
        _warpEligible();
        uint256 id = _initiate(council1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.AlreadyVoted.selector, id, council1));
        _councilApprove(id, council1);
        _veto(id, approver1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.AlreadyVoted.selector, id, approver1));
        _veto(id, approver1);
        assertEq(_rs(id).vetoes, 1);
        assertEq(_rs(id).approvals, 1);
        _councilApprove(id, council2);
        // timelocked now: approving again is a wrong-state error, never a second count
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.WrongState.selector, id, TreasuryRecovery.Status.Timelocked));
        _councilApprove(id, council3);
        assertEq(_rs(id).approvals, 2);
    }

    // ------------------------------------------------------------ authorization
    function test_REC05_OnlyCouncilMembersCanInitiateOrApprove() public {
        _warpEligible();
        address[5] memory nobody = [outsider, approver1, guardian, proposerOnly, nC1];
        for (uint256 i; i < nobody.length; ++i) {
            AskirawaTreasury.GovernancePayload memory c = _replacement();
            address[] memory council = _newCouncil();
            vm.prank(nobody[i]);
            vm.expectRevert(TreasuryRecovery.NotCouncilMember.selector);
            rec.initiateRecovery(c, council, 2);
        }
        uint256 id = _initiate(council1);
        for (uint256 i; i < nobody.length; ++i) {
            vm.prank(nobody[i]);
            vm.expectRevert(TreasuryRecovery.NotCouncilMember.selector);
            rec.approveRecovery(id);
        }
    }

    function test_REC05_OnlyCurrentApproversCanVetoAndOnlyInitiatorCanCancel() public {
        _warpEligible();
        uint256 id = _initiate(council1);
        address[4] memory notApprovers = [outsider, guardian, council2, proposerOnly];
        for (uint256 i; i < notApprovers.length; ++i) {
            vm.prank(notApprovers[i]);
            vm.expectRevert(TreasuryRecovery.NotApprover.selector);
            rec.vetoRecovery(id);
        }
        vm.prank(council2);
        vm.expectRevert(TreasuryRecovery.Unauthorized.selector);
        rec.cancelRecovery(id);
        vm.prank(approver1);
        vm.expectRevert(TreasuryRecovery.Unauthorized.selector);
        rec.cancelRecovery(id);
        vm.expectEmit(true, true, false, false, address(rec));
        emit TreasuryRecovery.RecoveryCancelled(id, council1);
        vm.prank(council1);
        rec.cancelRecovery(id);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Cancelled));
        assertEq(rec.activeRecoveryId(), 0);
    }

    function test_REC05_OnlyTheRecoveryContractCanCallInstallRecovery() public {
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        address[5] memory callers = [outsider, approver1, guardian, council1, address(this)];
        vm.warp(rec.recoveryEligibleAt());
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(AskirawaTreasury.NotRecovery.selector);
            t.installRecovery(c);
        }
    }

    // ------------------------------------------------------------ inactivity gate
    function test_REC06_NoRecoveryBeforeThirtyDaysOfInactivity() public {
        uint64 eligible = rec.recoveryEligibleAt();
        vm.warp(eligible - 1);
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        address[] memory council = _newCouncil();
        vm.prank(council1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InactivityNotMet.selector, eligible));
        rec.initiateRecovery(c, council, 2);
        vm.warp(eligible);
        assertEq(_initiate(council1), 1, "allowed exactly at the boundary");
    }

    function test_REC06_AnyExecutedProposalRestartsTheClock() public {
        uint64 before_ = rec.recoveryEligibleAt();
        vm.warp(before_ - 5 days);
        uint256 pid = _proposePayroll(approver1, payee1, 1e6);
        _pass(pid);
        uint64 afterExec = _now();
        assertEq(t.lastActivityAt(), afterExec);
        assertEq(rec.recoveryEligibleAt(), afterExec + INACTIVITY);
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        address[] memory council = _newCouncil();
        vm.warp(before_);
        vm.prank(council1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InactivityNotMet.selector, afterExec + INACTIVITY));
        rec.initiateRecovery(c, council, 2);
    }

    function test_REC06_DepositsVotesAndProposalsDoNotCountAsActivity() public {
        uint64 start = t.lastActivityAt();
        usdc.mint(address(this), 5e6);
        usdc.approve(address(t), 5e6);
        t.deposit(5e6);
        uint256 pid = _proposePayroll(approver1, payee1, 1e6);
        _reachQuorum(pid);
        assertEq(t.lastActivityAt(), start, "only an executed proposal restarts the clock");
    }

    // ------------------------------------------------------------ veto
    function test_REC07_ApproverQuorumVetoesDuringTheTimelock() public {
        uint256 id = _timelocked();
        vm.warp(_now() + 5 days);
        vm.expectEmit(true, true, false, true, address(rec));
        emit TreasuryRecovery.RecoveryVetoVoted(id, approver1, 1, 2);
        _veto(id, approver1);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Timelocked), "one veto is not enough");
        vm.expectEmit(true, false, false, false, address(rec));
        emit TreasuryRecovery.RecoveryVetoed(id);
        _veto(id, approver2);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Vetoed));
        assertEq(rec.activeRecoveryId(), 0);
        assertEq(rec.lastResetAt(), _now());
        vm.warp(_rs(id).executableAt);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.WrongState.selector, id, TreasuryRecovery.Status.Vetoed));
        _execRecovery(id);
        assertEq(t.currentEpoch(), 1, "vetoed recovery changed nothing");
    }

    function test_REC07_VetoAlsoWorksWhileCouncilIsStillVoting() public {
        _warpEligible();
        uint256 id = _initiate(council1);
        _veto(id, approver1);
        _veto(id, approver3);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Vetoed));
    }

    function test_REC07_VetoRestartsTheInactivityClock() public {
        uint256 id = _timelocked();
        _veto(id, approver1);
        _veto(id, approver2);
        assertEq(rec.recoveryEligibleAt(), _now() + INACTIVITY);
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        address[] memory council = _newCouncil();
        vm.prank(council1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InactivityNotMet.selector, _now() + INACTIVITY));
        rec.initiateRecovery(c, council, 2);
        _warpEligible();
        assertEq(_initiate(council1), 2);
    }

    function test_REC07_TheVetoQuorumIsTheTreasuryQuorumSnapshottedAtInitiation() public {
        _warpEligible();
        uint256 id = _initiate(council1);
        assertEq(_rs(id).vetoQuorum, 2);
        assertEq(_rs(id).epoch, 1);
    }

    // ------------------------------------------------------------ timelock
    function test_REC08_ExecutionBeforeTheFourteenDayDelayReverts() public {
        uint256 id = _timelocked();
        uint64 executableAt = _rs(id).executableAt;
        address[3] memory callers = [outsider, council1, approver1];
        for (uint256 i; i < callers.length; ++i) {
            vm.warp(executableAt - 1);
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.DelayNotElapsed.selector, executableAt));
            rec.executeRecovery(id);
        }
        assertEq(t.currentEpoch(), 1);
    }

    function testFuzz_REC08_NoExecutionAtAnyTimeBeforeTheDelay(uint32 early) public {
        uint256 id = _timelocked();
        uint64 executableAt = _rs(id).executableAt;
        vm.warp(executableAt - 1 - (early % DELAY));
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.DelayNotElapsed.selector, executableAt));
        _execRecovery(id);
    }

    function testFuzz_REC06_NoInitiationAtAnyTimeBeforeTheGate(uint32 early) public {
        uint64 eligible = rec.recoveryEligibleAt();
        vm.warp(eligible - 1 - (early % INACTIVITY));
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        address[] memory council = _newCouncil();
        vm.prank(council1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InactivityNotMet.selector, eligible));
        rec.initiateRecovery(c, council, 2);
    }

    function test_REC09_ExecutionAfterTheDelayAndOnlyOnce() public {
        uint256 id = _timelocked();
        vm.warp(_rs(id).executableAt + 3 days);
        _execRecovery(id);
        assertEq(t.currentEpoch(), 2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.WrongState.selector, id, TreasuryRecovery.Status.Executed));
        _execRecovery(id);
        assertEq(t.currentEpoch(), 2);
    }

    function test_REC09_ExecutionWindowCloses() public {
        uint256 id = _timelocked();
        vm.warp(_rs(id).expiresAt);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.RecoveryStale.selector, id, 1));
        _execRecovery(id);
        vm.expectEmit(true, false, false, true, address(rec));
        emit TreasuryRecovery.RecoveryExpired(id, 1);
        rec.expireRecovery(id);
        assertEq(rec.activeRecoveryId(), 0);
    }

    // ------------------------------------------------------------ invalid configurations
    function _expectInitiateReverts(AskirawaTreasury.GovernancePayload memory c, address[] memory council, uint8 thr, bytes memory err)
        internal {
        _warpEligible();
        vm.prank(council1);
        vm.expectRevert(err);
        rec.initiateRecovery(c, council, thr);
    }

    function test_REC10_InvalidGovernanceConfigurationsAreRejected() public {
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        c.approvers = new address[](1);
        c.approvers[0] = nA1;
        _expectInitiateReverts(c, _newCouncil(), 2, abi.encodeWithSelector(AskirawaTreasury.InvalidRoleCount.selector, 1, 1));
        c = _replacement();
        c.quorum = 1;
        _expectInitiateReverts(c, _newCouncil(), 2, abi.encodeWithSelector(AskirawaTreasury.InvalidQuorum.selector, 1, 3));
        c = _replacement();
        c.quorum = 4;
        _expectInitiateReverts(c, _newCouncil(), 2, abi.encodeWithSelector(AskirawaTreasury.InvalidQuorum.selector, 4, 3));
        c = _replacement();
        c.approvers = _arr(nA1, nA2, nA1);
        _expectInitiateReverts(c, _newCouncil(), 2, abi.encodeWithSelector(AskirawaTreasury.DuplicateRole.selector, nA1));
        c = _replacement();
        c.approvers[1] = address(0);
        _expectInitiateReverts(c, _newCouncil(), 2, abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(0)));
        c = _replacement();
        c.approvers[2] = address(t);
        _expectInitiateReverts(c, _newCouncil(), 2, abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(t)));
        c = _replacement();
        c.configDelay = MIN_CONFIG_DELAY - 1;
        _expectInitiateReverts(c, _newCouncil(), 2, abi.encodeWithSelector(AskirawaTreasury.InvalidDelay.selector, PAYROLL_DELAY, MIN_CONFIG_DELAY - 1));
        c = _replacement();
        c.payrollDelay = 14 days + 1;
        _expectInitiateReverts(c, _newCouncil(), 2, abi.encodeWithSelector(AskirawaTreasury.InvalidDelay.selector, 14 days + 1, CONFIG_DELAY));
        assertEq(rec.activeRecoveryId(), 0, "nothing was created");
    }

    function test_REC10_InvalidCouncilConfigurationsAreRejected() public {
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        _expectInitiateReverts(c, _arr(nC1, nC2), 2, abi.encodeWithSelector(TreasuryRecovery.InvalidCouncil.selector, 2, 2));
        _expectInitiateReverts(c, _newCouncil(), 1, abi.encodeWithSelector(TreasuryRecovery.InvalidCouncil.selector, 3, 1));
        _expectInitiateReverts(c, _newCouncil(), 3, abi.encodeWithSelector(TreasuryRecovery.InvalidCouncil.selector, 3, 3));
        _expectInitiateReverts(c, _arr(nC1, nC2, nC1), 2, abi.encodeWithSelector(TreasuryRecovery.DuplicateMember.selector, nC1));
        _expectInitiateReverts(c, _arr(nC1, address(0), nC3), 2, abi.encodeWithSelector(TreasuryRecovery.InvalidAddress.selector, address(0)));
        _expectInitiateReverts(c, _arr(nC1, nC2, address(t)), 2, abi.encodeWithSelector(TreasuryRecovery.InvalidAddress.selector, address(t)));
        _expectInitiateReverts(c, _arr(nC1, nC2, nA2), 2, abi.encodeWithSelector(TreasuryRecovery.CouncilRoleConflict.selector, nA2));
        _expectInitiateReverts(c, _arr(nC1, nC2, nGuardian), 2, abi.encodeWithSelector(TreasuryRecovery.CouncilRoleConflict.selector, nGuardian));
        address[] memory eight = _accts(8, 700);
        _expectInitiateReverts(c, eight, 2, abi.encodeWithSelector(TreasuryRecovery.InvalidCouncil.selector, 8, 2));
        assertEq(rec.activeRecoveryId(), 0);
    }

    function test_REC10_DisabledGuardianAndMaximumSizesAreAccepted() public {
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        c.guardian = address(0);
        c.approvers = _accts(20, 300);
        c.quorum = 11;
        _warpEligible();
        uint256 id = _initiateCfg(council1, c, _accts(7, 400), 4);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Voting));
    }

    // ------------------------------------------------------------ governance epochs and invalidation
    function test_REC11_EpochChangesAndOldRolesStopWorking() public {
        _recoverNow();
        assertEq(t.currentEpoch(), 2);
        // old approvers can no longer propose; new ones can
        vm.warp(t.coolingEnd());
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 1e6);
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(AskirawaTreasury.NotProposer.selector);
        t.proposePayroll(items, exp, MEMO);
        vm.prank(nA1);
        assertEq(t.proposePayroll(items, exp, MEMO), 1);
        // the old guardian is powerless, the new one is not
        vm.prank(guardian);
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.pause();
        vm.prank(nGuardian);
        t.pause();
        assertTrue(t.paused());
    }

    function test_REC12_PendingProposalsFromThePreviousEpochAreVoided() public {
        uint256 id = _timelocked();
        // proposals created while the recovery waits are still pending when it installs the new epoch
        uint256 pid = _proposePayroll(approver1, payee1, 5e6);
        _reachQuorum(pid);
        uint256 gid = _proposeGov(approver1, _cfg());
        _reachQuorum(gid);
        vm.warp(_rs(id).executableAt);
        _execRecovery(id);
        assertEq(uint8(_status(pid)), uint8(AskirawaTreasury.ProposalStatus.Fenced));
        assertEq(uint8(_status(gid)), uint8(AskirawaTreasury.ProposalStatus.Fenced));
        vm.warp(t.coolingEnd());
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.WrongEpoch.selector, 1, 2));
        _exec(pid);
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.WrongEpoch.selector, 1, 2));
        t.approve(gid);
    }

    function test_REC12_AnExecutedProposalAfterInitiationVoidsTheRecovery() public {
        // approvers are alive after all: an executed proposal proves it, and the recovery dies
        uint256 pid = _proposePayroll(approver1, payee1, 1e6);
        _reachQuorum(pid);
        _warpEligible(); // eligible only because the payroll above has not executed yet
        assertGe(_now(), rec.recoveryEligibleAt());
        uint256 id = _initiate(council1);
        _councilApprove(id, council2);
        vm.warp(_now() + 2 days);
        _exec(pid); // approvers (or anyone) execute an already-approved proposal
        vm.warp(_rs(id).executableAt);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.RecoveryStale.selector, id, 3));
        _execRecovery(id);
        rec.expireRecovery(id);
        assertEq(rec.activeRecoveryId(), 0);
        assertEq(t.currentEpoch(), 1);
    }

    function test_REC12_OrdinaryGovernanceDuringTheTimelockVoidsTheRecovery() public {
        uint256 id = _timelocked();
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.quorum = 3;
        _govPass(c);
        vm.warp(_rs(id).executableAt);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.RecoveryStale.selector, id, 2));
        _execRecovery(id);
    }

    // ------------------------------------------------------------ pause interplay and defense in depth
    function test_REC13_RecoveryWorksWhileTheTreasuryIsPaused() public {
        _pause();
        _recoverNow();
        assertEq(t.currentEpoch(), 2);
        assertTrue(t.paused(), "recovery does not unpause");
    }

    function test_REC13_TheTreasuryReenforcesTheInactivityGateItself() public {
        uint64 eligibleAt = t.lastActivityAt() + INACTIVITY;
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        vm.prank(address(rec));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InactivityNotMet.selector, eligibleAt));
        t.installRecovery(c);
        vm.warp(t.lastActivityAt() + INACTIVITY);
        vm.prank(address(rec));
        t.installRecovery(_replacement());
        assertEq(t.currentEpoch(), 2);
    }

    // ------------------------------------------------------------ helpers for the replacement epoch
    function _newPayroll(address by, address to, uint96 amount) internal returns (uint256) {
        AskirawaTreasury.Payment[] memory items = _pay(to, amount);
        uint64 exp = _exp();
        vm.prank(by);
        return t.proposePayroll(items, exp, MEMO);
    }

    function _newApprove(uint256 id, address, address second) internal { _approve(id, second); }
}
