// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";

/// @notice G-PAUSE 01-05: who can pause, what pause blocks, what it must not block, unpause rules.
contract AskirawaTreasuryPauseTest is AskirawaTreasuryTestBase {
    function _paused() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(AskirawaTreasury.TreasuryPaused.selector);
    }

    function _readyPayroll(uint96 amount) internal returns (uint256 id) {
        id = _proposePayroll(approver1, payee1, amount);
        _reachQuorum(id);
        _warpToExecutable(id);
    }

    // ------------------------------------------------------------ G-PAUSE-01
    function test_PAUSE01_GuardianCanPause() public {
        vm.expectEmit(true, false, false, false, address(t));
        emit AskirawaTreasury.Paused(guardian);
        _pause();
        assertTrue(t.paused());
    }

    function test_PAUSE01_EveryCurrentApproverCanPause() public {
        address[3] memory who = [approver1, approver2, approver3];
        for (uint256 i; i < who.length; ++i) {
            uint256 snap = vm.snapshotState();
            vm.expectEmit(true, false, false, false, address(t));
            emit AskirawaTreasury.Paused(who[i]);
            vm.prank(who[i]);
            t.pause();
            assertTrue(t.paused());
            vm.revertToState(snap);
            assertFalse(t.paused());
        }
    }

    function test_PAUSE01_PausingTwiceReverts() public {
        _pause();
        vm.prank(approver1);
        vm.expectRevert(_paused());
        t.pause();
        vm.prank(guardian);
        vm.expectRevert(_paused());
        t.pause();
    }

    // ------------------------------------------------------------ G-PAUSE-02
    function test_PAUSE02_OthersCannotPause() public {
        address[5] memory nobody = [outsider, proposerOnly, payee1, rescueTo, address(mod)];
        for (uint256 i; i < nobody.length; ++i) {
            vm.prank(nobody[i]);
            vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
            t.pause();
        }
        assertFalse(t.paused());
    }

    function test_PAUSE02_TreasuryItselfCannotPause() public {
        vm.prank(address(t));
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.pause();
    }

    // ------------------------------------------------------------ G-PAUSE-03 (zero guardian disabled)
    function test_PAUSE03_ZeroGuardianIsDisabledButApproversStillPause() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.guardian = address(0);
        _govPass(c);
        assertEq(t.guardian(), address(0));
        vm.prank(guardian); // the former guardian has no power left
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.pause();
        vm.prank(outsider);
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.pause();
        vm.prank(approver2);
        t.pause();
        assertTrue(t.paused());
    }

    function test_PAUSE03_GuardianAloneHasNoSpendOrVotePower() public {
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        vm.prank(guardian);
        vm.expectRevert(AskirawaTreasury.NotApprover.selector);
        t.approve(id);
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 1e6);
        uint64 exp = _exp();
        vm.prank(guardian);
        vm.expectRevert(AskirawaTreasury.NotProposer.selector);
        t.proposePayroll(items, exp, MEMO);
        _pause();
        vm.prank(guardian);
        vm.expectRevert(AskirawaTreasury.NotProposer.selector);
        t.proposeUnpause(exp, MEMO);
    }

    // ------------------------------------------------------------ G-PAUSE-04 (what pause blocks)
    function test_PAUSE04_PausedBlocksPayrollExecuteThenResumes() public {
        uint256 id = _readyPayroll(5e6);
        _pause();
        vm.expectRevert(_paused());
        t.execute(id);
        assertEq(usdc.balanceOf(payee1), 0);
        // pause does not alter the derived lifecycle state
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executable));
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
        _unpausePass();
        _exec(id);
        assertEq(usdc.balanceOf(payee1), 5e6);
    }

    function test_PAUSE04_EarlierChecksPrecedencePause() public {
        // quorum / delay errors are reported before the pause error
        _pause();
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.QuorumNotReached.selector, id, 1, 2));
        t.execute(id);
        _approve(id, approver2);
        uint64 at = t.getProposal(id).executableAt;
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.DelayNotElapsed.selector, at));
        t.execute(id);
    }

    function test_PAUSE04_PausedBlocksPayFromModuleAndFundModule() public {
        _enableModule();
        // control: works while unpaused
        mod.pay(payee1, 10e6, bytes32(0));
        mod.fund(10e6, bytes32(0));
        assertEq(usdc.balanceOf(payee1), 10e6);
        assertEq(usdc.balanceOf(address(mod)), 10e6);
        _pause();
        vm.expectRevert(_paused());
        mod.pay(payee1, 10e6, bytes32(0));
        vm.expectRevert(_paused());
        mod.fund(10e6, bytes32(0));
        assertEq(usdc.balanceOf(payee1), 10e6, "unchanged while paused");
        assertEq(usdc.balanceOf(address(mod)), 10e6);
        _unpausePass();
        mod.pay(payee1, 10e6, bytes32(0));
        assertEq(usdc.balanceOf(payee1), 20e6);
    }

    function test_PAUSE04_PausedBlocksModuleActionExecutionIncludingZeroFunding() public {
        uint256 a = _proposeAny(Kind.ModuleAction, approver1);
        uint256 b = _proposeModuleAction(approver1, 50e6);
        _reachQuorum(a);
        _reachQuorum(b);
        _warpToExecutable(a);
        _warpToExecutable(b);
        _pause();
        vm.expectRevert(_paused());
        t.execute(a);
        vm.expectRevert(_paused());
        t.execute(b);
        assertEq(mod.callCount(), 0, "callback never ran");
        assertEq(usdc.balanceOf(address(mod)), 0);
        _unpausePass();
        t.execute(a);
        t.execute(b);
        assertEq(mod.callCount(), 2);
        assertEq(usdc.balanceOf(address(mod)), 50e6);
    }

    function test_PAUSE04_PausedAlsoBlocksModuleConfigAndRescueExecution() public {
        uint256 m = _proposeAny(Kind.ModuleConfig, approver1);
        uint256 r = _proposeAny(Kind.Rescue, approver1);
        _reachQuorum(m);
        _reachQuorum(r);
        _warpToExecutable(m);
        _warpToExecutable(r);
        _pause();
        vm.expectRevert(_paused());
        t.execute(m);
        vm.expectRevert(_paused());
        t.execute(r);
        assertEq(other.balanceOf(rescueTo), 0);
    }

    function test_PAUSE04_GovernanceStillExecutesWhilePaused() public {
        uint256 id = _proposeGov(approver1, _cfg());
        _reachQuorum(id);
        _warpToExecutable(id);
        _pause();
        _exec(id);
        assertEq(t.currentEpoch(), 2);
        assertTrue(t.paused(), "governance does not unpause");
    }

    function test_PAUSE04_UnpauseStillExecutesWhilePaused() public {
        _pause();
        uint256 id = _unpausePass();
        assertFalse(t.paused());
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executed));
    }

    function test_PAUSE04_ProposingVotingCancellingAndDepositingWorkWhilePaused() public {
        _enableModule();
        _pause();
        uint256 p = _proposePayroll(approver1, payee1, 5e6);
        _approve(p, approver2);
        uint256 q = _proposePayroll(proposerOnly, payee1, 5e6);
        _reject(q, approver1);
        vm.prank(proposerOnly);
        t.cancel(q);
        uint256 q2 = _proposePayroll(proposerOnly, payee1, 5e6);
        _cancel(q2, guardian);
        _proposeGov(approver1, _cfg());
        _proposeRescue(approver1);
        _proposeModuleAction(approver1, 0);
        _proposeModuleConfig(approver1, false);
        assertEq(uint8(_status(p)), uint8(AskirawaTreasury.ProposalStatus.Approved));
        assertEq(uint8(_status(q)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
        // deposits are inflows and remain open
        usdc.mint(outsider, 7e6);
        vm.startPrank(outsider);
        usdc.approve(address(t), 7e6);
        t.deposit(7e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS + 7e6);
    }

    function _cancel(uint256 id, address by) internal { vm.prank(by); t.cancel(id); }

    // ------------------------------------------------------------ G-PAUSE-05 (unpause rules)
    function test_PAUSE05_ProposeUnpauseOnlyWhilePaused() public {
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(AskirawaTreasury.NotPaused.selector);
        t.proposeUnpause(exp, MEMO);
    }

    function test_PAUSE05_UnpauseNeedsQuorum() public {
        _pause();
        uint256 id = _proposeUnpause(approver1); // 1 of 2
        vm.warp(t.getProposal(id).expiresAt - 1); // far past any delay, still unexpired: only quorum blocks
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.QuorumNotReached.selector, id, 1, 2));
        t.execute(id);
        assertTrue(t.paused());
    }

    function test_PAUSE05_UnpauseUsesConfigDelayNotPayrollDelay() public {
        _pause();
        uint256 id = _proposeUnpause(approver1);
        _approve(id, approver2);
        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        assertEq(p.executableAt - p.approvedAt, CONFIG_DELAY);
        assertTrue(CONFIG_DELAY > PAYROLL_DELAY);
        vm.warp(p.approvedAt + PAYROLL_DELAY); // payroll-class delay elapsed: not enough
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.DelayNotElapsed.selector, p.executableAt));
        t.execute(id);
        vm.warp(p.executableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.DelayNotElapsed.selector, p.executableAt));
        t.execute(id);
        vm.warp(p.executableAt);
        vm.expectEmit(true, false, false, false, address(t));
        emit AskirawaTreasury.Unpaused(id);
        t.execute(id);
        assertFalse(t.paused());
    }

    function test_PAUSE05_GuardianCannotCancelUnpause() public {
        _pause();
        uint256 id = _proposeUnpause(approver1);
        vm.prank(guardian);
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.cancel(id);
        _approve(id, approver2);
        vm.prank(guardian);
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.cancel(id);
        _warpToExecutable(id);
        _exec(id);
        assertFalse(t.paused());
    }

    function test_PAUSE05_GuardianCannotUnpauseDirectly() public {
        _pause();
        vm.prank(guardian);
        (bool ok,) = address(t).call(abi.encodeWithSignature("unpause()"));
        assertFalse(ok);
        assertTrue(t.paused());
    }

    function test_PAUSE05_SecondUnpauseProposalRevertsStaleAndStaysPending() public {
        _pause();
        uint256 a = _proposeUnpause(approver1);
        uint256 b = _proposeUnpause(approver2);
        _reachQuorum(a);
        _reachQuorum(b);
        _warpToExecutable(a);
        _warpToExecutable(b);
        _exec(a);
        // not paused any more: bound pause 1, current count still 1
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.StalePauseUnpause.selector, b, 1, 1));
        t.execute(b);
        assertEq(uint8(t.getProposal(b).status), uint8(AskirawaTreasury.Status.Pending));
        // re-pause (pause 2): the old unpause for pause 1 must NOT undo it
        _pause();
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.StalePauseUnpause.selector, b, 1, 2));
        t.execute(b);
        assertTrue(t.paused());
        assertEq(uint8(t.getProposal(b).status), uint8(AskirawaTreasury.Status.Pending));
    }

    // ------------------------------------------------------------ G-PAUSE-06 (pauseCount binding)
    function test_PAUSE06_PauseCountStartsAtZeroAndIncrementsOnlyOnFalseToTrue() public {
        assertEq(t.pauseCount(), 0);
        _pause();
        assertEq(t.pauseCount(), 1);
        // failed re-pauses (both roles) do not increment
        vm.prank(approver1);
        vm.expectRevert(_paused());
        t.pause();
        vm.prank(guardian);
        vm.expectRevert(_paused());
        t.pause();
        // unauthorised attempt does not increment
        vm.prank(outsider);
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.pause();
        assertEq(t.pauseCount(), 1);
        // unpausing does not change the count
        _unpausePass();
        assertEq(t.pauseCount(), 1);
        _pause();
        assertEq(t.pauseCount(), 2);
        vm.prank(approver2);
        vm.expectRevert(_paused());
        t.pause();
        assertEq(t.pauseCount(), 2);
    }

    function test_PAUSE06_ProposeUnpauseBindsCurrentPauseCountInPayload() public {
        _pause();
        uint256 a = _proposeUnpause(approver1);
        bytes memory payload = t.getPayload(a);
        assertEq(payload, abi.encode(AskirawaTreasury.UnpausePayload(true, 1)));
        assertEq(t.getProposal(a).payloadHash, keccak256(payload));
        _pass(a);
        _pause();
        uint256 b = _proposeUnpause(approver1);
        assertEq(t.getPayload(b), abi.encode(AskirawaTreasury.UnpausePayload(true, 2)));
        assertTrue(t.getProposal(a).payloadHash != t.getProposal(b).payloadHash);
    }

    function test_PAUSE06_UnpauseApprovedForPauseNCannotUndoPauseNPlus1() public {
        _pause(); // pause 1
        uint256 old = _proposeUnpause(approver1);
        _reachQuorum(old);
        _warpToExecutable(old);
        // an independent unpause (also bound to 1) is executed first, resuming the core
        uint256 other1 = _proposeUnpause(approver2);
        _reachQuorum(other1);
        _warpToExecutable(other1);
        _exec(other1);
        assertFalse(t.paused());
        // a new incident: pause 2. The stale, fully approved, unexpired unpause must not lift it.
        _pause();
        assertEq(t.pauseCount(), 2);
        assertEq(uint8(_status(old)), uint8(AskirawaTreasury.ProposalStatus.Executable));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.StalePauseUnpause.selector, old, 1, 2));
        t.execute(old);
        assertTrue(t.paused());
        assertEq(uint8(t.getProposal(old).status), uint8(AskirawaTreasury.Status.Pending));
    }

    function test_PAUSE06_FreshUnpauseForPauseNPlus1Works() public {
        _pause();
        _unpausePass(); // pause 1 resolved
        _pause(); // pause 2
        uint256 fresh = _proposeUnpause(approver1);
        _reachQuorum(fresh);
        _warpToExecutable(fresh);
        vm.expectEmit(true, false, false, false, address(t));
        emit AskirawaTreasury.Unpaused(fresh);
        _exec(fresh);
        assertFalse(t.paused());
        assertEq(t.pauseCount(), 2);
        assertEq(uint8(_status(fresh)), uint8(AskirawaTreasury.ProposalStatus.Executed));
    }

    function test_PAUSE06_UnpauseNotPausedAnymoreRevertsStale() public {
        // fresh pause then a different unpause already resolved it -> stale with bound == current
        _pause();
        uint256 a = _proposeUnpause(approver1);
        uint256 b = _proposeUnpause(approver1);
        _reachQuorum(a);
        _reachQuorum(b);
        _warpToExecutable(b);
        _exec(a);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.StalePauseUnpause.selector, b, 1, 1));
        t.execute(b);
    }

    // ------------------------------------------------------------ G-PAUSE-07 (disabled guardian = address zero)
    function test_PAUSE07_DisabledGuardianCannotPauseEvenFromAddressZero() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.guardian = address(0);
        _govPass(c);
        vm.prank(address(0));
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.pause();
        assertFalse(t.paused());
        assertEq(t.pauseCount(), 0);
    }

    function test_PAUSE07_DisabledGuardianCannotCancelEvenFromAddressZero() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.guardian = address(0);
        _govPass(c);
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        vm.prank(address(0));
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.cancel(id);
        vm.prank(guardian); // former guardian
        vm.expectRevert(AskirawaTreasury.Unauthorized.selector);
        t.cancel(id);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Pending));
        // the proposer retains its own cancel power
        vm.prank(proposerOnly);
        t.cancel(id);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
    }

    function test_PAUSE07_ActiveGuardianCanCancelNonProtectedProposal() public {
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        vm.expectEmit(true, true, false, false, address(t));
        emit AskirawaTreasury.Cancelled(id, guardian);
        _cancel(id, guardian);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
    }

    function test_PAUSE05_PauseUnpauseCycleRestoresPayrollAndEmitsEvents() public {
        _pause();
        uint256 up = _proposeUnpause(approver1);
        _reachQuorum(up);
        _warpToExecutable(up);
        vm.expectEmit(true, false, false, false, address(t));
        emit AskirawaTreasury.Unpaused(up);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.Executed(up, AskirawaTreasury.Action.Unpause, 0);
        _exec(up);
        assertFalse(t.paused());
        _payrollPass(payee2, 3e6);
        assertEq(usdc.balanceOf(payee2), 3e6);
        _pause(); // can pause again
        assertTrue(t.paused());
    }
}
