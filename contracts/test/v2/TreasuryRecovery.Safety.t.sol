// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {TreasuryRecovery} from "../../v2/TreasuryRecovery.sol";
import {TreasuryRecoveryBase} from "./TreasuryRecovery.Base.t.sol";

/// @notice REC group, part 2: cooling period, repeated attempts, compromised actors, binding and fund safety.
contract TreasuryRecoverySafetyTest is TreasuryRecoveryBase {
    // ------------------------------------------------------------ helpers (replacement epoch)
    function _payNew(address to, uint96 amount) internal returns (uint256 id) {
        AskirawaTreasury.Payment[] memory items = _pay(to, amount);
        uint64 exp = _exp();
        vm.prank(nA1);
        id = t.proposePayroll(items, exp, MEMO);
        _approve(id, nA2);
    }

    function _passNew(uint256 id) internal {
        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        if (_now() < p.executableAt) vm.warp(p.executableAt);
        _exec(id);
    }

    // ------------------------------------------------------------ seven day cooling
    function test_COOL01_PayrollIsBlockedForSevenDaysThenAllowed() public {
        _recoverNow();
        uint64 end = t.coolingEnd();
        uint256 id = _payNew(payee1, 40e6);
        vm.warp(_now() + PAYROLL_DELAY);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executable));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.SpendingCoolingOff.selector, end));
        _exec(id);
        vm.warp(end - 1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.SpendingCoolingOff.selector, end));
        _exec(id);
        assertEq(usdc.balanceOf(payee1), 0);
        vm.warp(end);
        _exec(id);
        assertEq(usdc.balanceOf(payee1), 40e6);
    }

    function testFuzz_COOL01_NoPayrollAtAnyTimeInsideTheCoolingPeriod(uint32 into) public {
        _recoverNow();
        uint64 end = t.coolingEnd();
        uint256 id = _payNew(payee1, 1e6);
        vm.warp(end - 1 - (into % (COOLING - PAYROLL_DELAY - 1)));
        if (_now() < t.getProposal(id).executableAt) vm.warp(t.getProposal(id).executableAt);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.SpendingCoolingOff.selector, end));
        _exec(id);
    }

    function test_COOL02_ModuleDrawsAndFundingAreBlockedDuringCooling() public {
        _enableModule();
        _recoverNow();
        uint64 end = t.coolingEnd();
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.SpendingCoolingOff.selector, end));
        t.payFromModule(payee1, 1e6, bytes32(0));
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.SpendingCoolingOff.selector, end));
        t.fundModule(1e6, bytes32(0));
        // a quorum-approved module action that would prefund the module is blocked too
        uint64 exp = _exp();
        address m = address(mod);
        vm.prank(nA1);
        uint256 aid = t.proposeModuleAction(m, 7, hex"c0ffee", 5e6, exp, MEMO);
        _approve(aid, nA2);
        vm.warp(_now() + PAYROLL_DELAY);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.SpendingCoolingOff.selector, end));
        _exec(aid);
        vm.warp(end);
        vm.prank(address(mod));
        t.payFromModule(payee1, 1e6, bytes32(0));
        assertEq(usdc.balanceOf(payee1), 1e6);
    }

    function test_COOL03_DepositsAndEssentialGovernanceStayAvailable() public {
        _enableModule();
        _recoverNow();
        // deposits
        usdc.mint(address(this), 9e6);
        usdc.approve(address(t), 9e6);
        uint256 before_ = _fundsOf();
        t.deposit(9e6);
        assertEq(_fundsOf(), before_ + 9e6);
        // pause, then quorum unpause, both during cooling
        vm.prank(nGuardian);
        t.pause();
        uint64 exp = _exp();
        vm.prank(nA1);
        uint256 uid = t.proposeUnpause(exp, MEMO);
        _approve(uid, nA2);
        vm.warp(_now() + CONFIG_DELAY);
        _exec(uid);
        assertFalse(t.paused());
        // a module action without funding and a governance rotation also execute during cooling
        vm.prank(nA1);
        uint256 aid = t.proposeModuleAction(address(mod), 7, hex"c0ffee", 0, _exp(), MEMO);
        _approve(aid, nA2);
        vm.warp(_now() + PAYROLL_DELAY);
        _exec(aid);
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        c.quorum = 3;
        vm.prank(nA1);
        uint256 gid = t.proposeGovernance(c, _exp(), MEMO);
        _approve(gid, nA2);
        vm.warp(_now() + CONFIG_DELAY);
        assertLt(_now(), t.coolingEnd(), "still cooling");
        _exec(gid);
        assertEq(t.currentEpoch(), 3);
        assertEq(t.quorum(), 3);
    }

    function test_COOL04_CompleteCoolingEmitsOnceAfterTheEnd() public {
        _recoverNow();
        uint64 end = t.coolingEnd();
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.CoolingNotFinished.selector, end));
        t.completeCooling();
        vm.warp(end);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.CoolingPeriodCompleted(2, end);
        t.completeCooling();
        assertEq(t.coolingEnd(), 0);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.CoolingNotFinished.selector, 0));
        t.completeCooling();
    }

    function test_COOL05_NoCoolingBeforeAnyRecovery() public {
        assertEq(t.coolingEnd(), 0);
        uint256 id = _proposePayroll(approver1, payee1, 1e6);
        _pass(id);
        assertEq(usdc.balanceOf(payee1), 1e6);
    }

    // ------------------------------------------------------------ repeated attempts
    function test_REP01_NoSecondRecoveryRightAfterOne() public {
        _recoverNow();
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        c.quorum = 3;
        address[] memory council = _arr(council1, council2, council3);
        uint64 eligible = rec.recoveryEligibleAt();
        assertEq(eligible, _now() + INACTIVITY);
        vm.prank(nC1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InactivityNotMet.selector, eligible));
        rec.initiateRecovery(c, council, 2);
        vm.warp(eligible - 1);
        vm.prank(nC1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InactivityNotMet.selector, eligible));
        rec.initiateRecovery(c, council, 2);
        vm.warp(eligible);
        vm.prank(nC1);
        assertEq(rec.initiateRecovery(c, council, 2), 2);
    }

    function test_REP02_OnlyOneLiveRecoveryAndStaleOnesAreReplaced() public {
        _warpEligible();
        uint256 id = _initiate(council1);
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        address[] memory council = _newCouncil();
        vm.prank(council2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.RecoveryInProgress.selector, id));
        rec.initiateRecovery(c, council, 2);
        vm.warp(_now() + VOTING_WINDOW);
        vm.expectEmit(true, false, false, true, address(rec));
        emit TreasuryRecovery.RecoveryExpired(id, 1);
        uint256 id2 = _initiate(council2);
        assertEq(id2, 2);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Expired));
        assertEq(rec.activeRecoveryId(), 2);
    }

    function test_REP03_CancelAndReinitiateNeedsAFreshFullApproval() public {
        _warpEligible();
        uint256 id = _initiate(council1);
        vm.prank(council1);
        rec.cancelRecovery(id);
        uint256 id2 = _initiate(council1);
        assertEq(_rs(id2).approvals, 1);
        assertFalse(rec.councilVoted(id2, council2));
        vm.warp(_now() + DELAY);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.WrongState.selector, id2, TreasuryRecovery.Status.Voting));
        _execRecovery(id2);
        // a cancelled recovery can never be approved or executed
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.WrongState.selector, id, TreasuryRecovery.Status.Cancelled));
        _councilApprove(id, council2);
    }

    function test_REP04_ATimelockedRecoveryCannotBeCancelledOrShortened() public {
        uint256 id = _timelocked();
        vm.prank(council1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.WrongState.selector, id, TreasuryRecovery.Status.Timelocked));
        rec.cancelRecovery(id);
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        address[] memory council = _newCouncil();
        vm.prank(council3);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.RecoveryInProgress.selector, id));
        rec.initiateRecovery(c, council, 2);
        assertEq(_rs(id).executableAt, _rs(id).approvedAt + DELAY, "the delay is fixed");
    }

    function test_REP05_AfterExecutionTheChainOfRecoveriesNeedsThirtyQuietDaysEach() public {
        _recoverNow();
        uint64 first = _now();
        vm.warp(rec.recoveryEligibleAt());
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        c.guardian = address(0);
        address[] memory council = _arr(council1, council2, council3);
        vm.prank(nC1);
        uint256 id = rec.initiateRecovery(c, council, 2);
        vm.prank(nC2);
        rec.approveRecovery(id);
        vm.warp(_now() + DELAY);
        _execRecovery(id);
        assertGe(_now() - first, INACTIVITY + DELAY, "two recoveries are at least 44 days apart");
        assertEq(t.currentEpoch(), 3);
    }

    // ------------------------------------------------------------ compromised council
    function test_COMP01_CompromisedCouncilIsStoppedByTheApproverVeto() public {
        uint256 id = _timelocked(); // council1 and council2 are the attackers
        vm.warp(_now() + 10 days);
        _veto(id, approver2);
        _veto(id, approver3);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Vetoed));
        vm.warp(_rs(id).executableAt);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.WrongState.selector, id, TreasuryRecovery.Status.Vetoed));
        _execRecovery(id);
        assertEq(t.currentEpoch(), 1);
        assertTrue(t.isApprover(approver1));
    }

    function test_COMP01_ActiveApproversKeepTheGateClosedAgainstACompromisedCouncil() public {
        vm.warp(rec.recoveryEligibleAt() - 1 days);
        _pass(_proposePayroll(approver1, payee1, 1e6)); // a quorum acts: the clock restarts
        uint64 eligible = rec.recoveryEligibleAt();
        vm.warp(eligible - 1);
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        address[] memory council = _newCouncil();
        vm.prank(council1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InactivityNotMet.selector, eligible));
        rec.initiateRecovery(c, council, 2);
    }

    /// @dev RESIDUAL RISK, asserted on purpose: a council that is compromised while the approvers are unreachable
    /// for 44 days takes over governance. It still cannot move money immediately.
    function test_COMP02_RESIDUAL_CompromisedCouncilWithUnreachableApproversTakesOverGovernanceButNotFundsAtOnce() public {
        uint256 fundsBefore = _fundsOf();
        uint256 id = _timelocked();
        vm.warp(_rs(id).executableAt);
        _execRecovery(id);
        assertEq(t.currentEpoch(), 2, "governance was taken over");
        assertEq(_fundsOf(), fundsBefore, "but no funds moved");
        uint256 pid = _payNew(council1, 1_000e6); // the attacker's approvers propose a payout to themselves
        vm.warp(_now() + PAYROLL_DELAY + 1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.SpendingCoolingOff.selector, t.coolingEnd()));
        _exec(pid);
        assertEq(_fundsOf(), fundsBefore, "still nothing could be paid inside the cooling period");
        vm.warp(t.coolingEnd());
        _exec(pid);
        assertEq(_fundsOf(), fundsBefore - 1_000e6, "after cooling the attacker must also have used the normal flow");
    }

    function test_COMP03_CouncilMembersHaveNoPathToFunds() public {
        uint256 fundsBefore = _fundsOf();
        address[3] memory members = [council1, council2, council3];
        AskirawaTreasury.Payment[] memory items = _pay(council1, 1e6);
        uint64 exp = _exp();
        uint256 pid = _proposePayroll(approver1, payee1, 1e6);
        for (uint256 i; i < members.length; ++i) {
            vm.startPrank(members[i]);
            vm.expectRevert(AskirawaTreasury.NotProposer.selector);
            t.proposePayroll(items, exp, MEMO);
            vm.expectRevert(AskirawaTreasury.NotApprover.selector);
            t.approve(pid);
            vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
            t.pause();
            vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, members[i]));
            t.payFromModule(members[i], 1e6, bytes32(0));
            vm.expectRevert(AskirawaTreasury.NotRecovery.selector);
            t.installRecovery(_replacement());
            vm.stopPrank();
        }
        assertEq(_fundsOf(), fundsBefore);
    }

    function test_COMP03_ARecoveryNeverMovesFundsOrTokens() public {
        uint256 funds = _fundsOf();
        uint256 other_ = other.balanceOf(address(t));
        uint256 supply = usdc.totalSupply();
        _recoverNow();
        assertEq(_fundsOf(), funds);
        assertEq(other.balanceOf(address(t)), other_);
        assertEq(usdc.totalSupply(), supply);
        assertEq(usdc.balanceOf(address(rec)), 0);
    }

    // ------------------------------------------------------------ compromised guardian
    function test_COMP04_CompromisedGuardianCannotBlockOrDriveARecovery() public {
        _warpEligible();
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        address[] memory council = _newCouncil();
        vm.startPrank(guardian);
        vm.expectRevert(TreasuryRecovery.NotCouncilMember.selector);
        rec.initiateRecovery(c, council, 2);
        vm.stopPrank();
        uint256 id = _initiate(council1);
        vm.prank(guardian);
        vm.expectRevert(TreasuryRecovery.NotCouncilMember.selector);
        rec.approveRecovery(id);
        vm.prank(guardian);
        vm.expectRevert(TreasuryRecovery.NotApprover.selector);
        rec.vetoRecovery(id);
        vm.prank(guardian);
        vm.expectRevert(TreasuryRecovery.Unauthorized.selector);
        rec.cancelRecovery(id);
        // the guardian can pause, which is its only lever, and recovery still completes
        _pause();
        _councilApprove(id, council2);
        vm.warp(_now() + DELAY);
        _execRecovery(id);
        assertEq(t.currentEpoch(), 2);
        assertTrue(t.paused());
    }

    function test_COMP04_ACompromisedGuardianCannotCancelGovernanceOrTheEffectOfRecovery() public {
        uint256 gid = _proposeGov(approver1, _cfg());
        vm.prank(guardian);
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.cancel(gid);
        _recoverNow();
        vm.prank(guardian); // the old guardian after recovery
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.pause();
    }

    // ------------------------------------------------------------ binding and construction
    function test_BIND01_TheRecoveryContractServesExactlyOneTreasury() public {
        assertEq(address(rec.treasury()), address(t));
        assertEq(t.recovery(), address(rec));
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        vm.expectRevert(TreasuryRecovery.AlreadyBound.selector);
        new AskirawaTreasury(address(usdc), MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum, c.guardian,
            c.payrollDelay, c.configDelay, address(rec));
    }

    function test_BIND02_CouncilMustBeIndependentOfInitialApproversAndGuardian() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        TreasuryRecovery bad = new TreasuryRecovery(_arr(approver2, council2, council3), 2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.CouncilRoleConflict.selector, approver2));
        new AskirawaTreasury(address(usdc), MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum, c.guardian,
            c.payrollDelay, c.configDelay, address(bad));
        TreasuryRecovery bad2 = new TreasuryRecovery(_arr(council1, guardian, council3), 2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.CouncilRoleConflict.selector, guardian));
        new AskirawaTreasury(address(usdc), MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum, c.guardian,
            c.payrollDelay, c.configDelay, address(bad2));
    }

    function test_BIND03_RecoveryAddressMustBeAContract() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        address eoa = makeAddr("notARecoveryContract");
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NoCode.selector, eoa));
        new AskirawaTreasury(address(usdc), MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum, c.guardian,
            c.payrollDelay, c.configDelay, eoa);
    }

    function test_BIND04_AnUnboundRecoveryContractDoesNothing() public {
        TreasuryRecovery fresh = new TreasuryRecovery(_council(), 2);
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        address[] memory council = _newCouncil();
        vm.prank(council1);
        vm.expectRevert(TreasuryRecovery.NotBound.selector);
        fresh.initiateRecovery(c, council, 2);
        vm.expectRevert(TreasuryRecovery.NotBound.selector);
        fresh.approveRecovery(1);
        vm.expectRevert(TreasuryRecovery.NotBound.selector);
        fresh.recoveryEligibleAt();
    }

    function test_BIND05_AStrangerBindingFirstOnlyGriefsAndTheTreasuryDeploymentFailsLoudly() public {
        TreasuryRecovery fresh = new TreasuryRecovery(_council(), 2);
        vm.prank(outsider);
        fresh.bindTreasury(new address[](0), address(0));
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        vm.expectRevert(TreasuryRecovery.AlreadyBound.selector);
        new AskirawaTreasury(address(usdc), MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum, c.guardian,
            c.payrollDelay, c.configDelay, address(fresh));
        // the stranger cannot use it: the real treasury never accepts calls from a non-bound address
        assertEq(address(fresh.treasury()), outsider);
    }

    function test_BIND06_CouncilConstructionRules() public {
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InvalidCouncil.selector, 3, 1));
        new TreasuryRecovery(_council(), 1);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InvalidCouncil.selector, 3, 3));
        new TreasuryRecovery(_council(), 3);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InvalidCouncil.selector, 2, 2));
        new TreasuryRecovery(_arr(council1, council2), 2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.DuplicateMember.selector, council1));
        new TreasuryRecovery(_arr(council1, council2, council1), 2);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.InvalidAddress.selector, address(0)));
        new TreasuryRecovery(_arr(council1, address(0), council3), 2);
    }

    // ------------------------------------------------------------ fuzz: recovery actions never move funds
    function testFuzz_REC14_NoSequenceOfRecoveryActionsMovesFunds(uint256 seed) public {
        uint256 funds = _fundsOf();
        uint256 supply = usdc.totalSupply();
        address[3] memory councilNow = [council1, council2, council3];
        address[3] memory approversNow = [approver1, approver2, approver3];
        for (uint256 i; i < 24; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            uint256 action = r % 7;
            address who = councilNow[(r >> 8) % 3];
            address appr = approversNow[(r >> 16) % 3];
            uint256 id = rec.nextRecoveryId() - 1;
            AskirawaTreasury.GovernancePayload memory c = _replacement();
            address[] memory nc = _newCouncil();
            if (action == 0) {
                vm.warp(_now() + ((r >> 24) % 20 days));
            } else if (action == 1) {
                vm.prank(who);
                try rec.initiateRecovery(c, nc, 2) {} catch {}
            } else if (action == 2) {
                vm.prank(who);
                try rec.approveRecovery(id) {} catch {}
            } else if (action == 3) {
                vm.prank(appr);
                try rec.vetoRecovery(id) {} catch {}
            } else if (action == 4) {
                vm.prank(who);
                try rec.cancelRecovery(id) {} catch {}
            } else if (action == 5) {
                try rec.executeRecovery(id) {} catch {}
            } else {
                try rec.expireRecovery(id) {} catch {}
            }
            assertEq(_fundsOf(), funds, "treasury USDC never changes");
            assertEq(usdc.totalSupply(), supply);
            assertEq(usdc.balanceOf(address(rec)), 0);
            // governance epoch only moves forward through an executed recovery
            assertLe(t.currentEpoch(), 1 + uint256(_executedCount()));
        }
    }

    function _executedCount() internal view returns (uint256 n) {
        for (uint256 id = 1; id < rec.nextRecoveryId(); ++id) {
            if (_rs(id).status == TreasuryRecovery.Status.Executed) ++n;
        }
    }
}
