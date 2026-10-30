// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";

/// @notice G-CANCEL 01-06: cancellation authority and absence of owner/withdraw-style surface.
contract AskirawaTreasuryCancelTest is AskirawaTreasuryTestBase {
    function _cancel(uint256 id, address by) internal { vm.prank(by); t.cancel(id); }

    function _cancelReverts(uint256 id, address by, bytes memory err) internal {
        vm.prank(by);
        vm.expectRevert(err);
        t.cancel(id);
    }

    function _unauthorized() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(AskirawaTreasury.Unauthorized.selector);
    }

    function _notPending(uint256 id) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(AskirawaTreasury.NotPending.selector, id);
    }

    // ------------------------------------------------------------ G-CANCEL-01
    function test_CANCEL01_ProposerCancelsOwnEveryKind() public {
        for (uint256 k; k < 6; ++k) {
            uint256 id = _proposeAny(Kind(k), approver2);
            vm.expectEmit(true, true, false, false, address(t));
            emit AskirawaTreasury.Cancelled(id, approver2);
            _cancel(id, approver2);
            assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
            assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Cancelled));
        }
    }

    function test_CANCEL01_NonApproverProposerCancelsOwn() public {
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        _cancel(id, proposerOnly);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
    }

    function test_CANCEL01_ProposerCancelsEvenAfterQuorumAndDelay() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        _reachQuorum(id);
        _warpToExecutable(id);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executable));
        _cancel(id, approver1);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
        vm.expectRevert(_notPending(id));
        t.execute(id);
        assertEq(usdc.balanceOf(payee1), 0);
    }

    // ------------------------------------------------------------ G-CANCEL-02
    function test_CANCEL02_OtherProposerCannotCancel() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        _cancelReverts(id, proposerOnly, _unauthorized()); // another explicit proposer
        _cancelReverts(id, approver2, _unauthorized()); // another approver (who may also propose)
        _cancelReverts(id, outsider, _unauthorized());
        _cancelReverts(id, payee1, _unauthorized());
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Pending));
    }

    function test_CANCEL02_ApproversCannotCancelGovernanceOrUnpauseOfOthers() public {
        uint256 g = _proposeAny(Kind.Governance, proposerOnly);
        _cancelReverts(g, approver1, _unauthorized());
        _cancelReverts(g, approver2, _unauthorized());
        uint256 u = _proposeAny(Kind.Unpause, proposerOnly);
        _cancelReverts(u, approver1, _unauthorized());
        assertEq(uint8(_status(g)), uint8(AskirawaTreasury.ProposalStatus.Pending));
        assertEq(uint8(_status(u)), uint8(AskirawaTreasury.ProposalStatus.Pending));
    }

    // ------------------------------------------------------------ G-CANCEL-03
    function test_CANCEL03_GuardianCancelsPayrollModuleConfigModuleActionRescue() public {
        Kind[4] memory ks = [Kind.Payroll, Kind.ModuleConfig, Kind.ModuleAction, Kind.Rescue];
        for (uint256 i; i < ks.length; ++i) {
            uint256 id = _proposeAny(ks[i], proposerOnly);
            vm.expectEmit(true, true, false, false, address(t));
            emit AskirawaTreasury.Cancelled(id, guardian);
            _cancel(id, guardian);
            assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
        }
    }

    function test_CANCEL03_GuardianCancelsAfterQuorumReached() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        _reachQuorum(id);
        _cancel(id, guardian);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
    }

    function test_CANCEL03_GuardianCancelWorksWhilePaused() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        _pause();
        _cancel(id, guardian);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
    }

    function test_CANCEL03_OnlyCurrentGuardianCancelsAfterEpochChange() public {
        uint256 old = _proposePayroll(approver1, payee1, 5e6); // epoch 1 (will be fenced)
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        address newGuardian = makeAddr("newGuardian");
        c.guardian = newGuardian;
        _govPass(c);
        uint256 fresh = _proposePayroll(approver1, payee2, 5e6);
        _cancelReverts(fresh, guardian, _unauthorized());
        _cancel(fresh, newGuardian);
        // fenced proposals can still be cancelled by the *current* guardian
        _cancelReverts(old, guardian, _unauthorized());
        _cancel(old, newGuardian);
        assertEq(uint8(_status(old)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
    }

    function test_CANCEL03_NoGuardianMeansNobodyElseCancels() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.guardian = address(0);
        _govPass(c);
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        _cancelReverts(id, guardian, _unauthorized());
        _cancelReverts(id, approver1, _unauthorized());
        _cancel(id, proposerOnly);
    }

    // ------------------------------------------------------------ G-CANCEL-04
    function test_CANCEL04_GuardianCannotCancelGovernance() public {
        uint256 id = _proposeAny(Kind.Governance, proposerOnly);
        _cancelReverts(id, guardian, _unauthorized());
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Pending));
        _reachQuorum(id);
        _cancelReverts(id, guardian, _unauthorized());
    }

    function test_CANCEL04_GuardianCannotCancelUnpause() public {
        uint256 id = _proposeAny(Kind.Unpause, proposerOnly);
        _cancelReverts(id, guardian, _unauthorized());
        _reachQuorum(id);
        _warpToExecutable(id);
        _cancelReverts(id, guardian, _unauthorized());
        _exec(id); // still executes
        assertFalse(t.paused());
    }

    function test_CANCEL04_ProposerCanStillCancelOwnGovernanceAndUnpause() public {
        uint256 g = _proposeAny(Kind.Governance, proposerOnly);
        _cancel(g, proposerOnly);
        uint256 u = _proposeAny(Kind.Unpause, approver3);
        _cancel(u, approver3);
        assertEq(uint8(_status(g)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
        assertEq(uint8(_status(u)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
    }

    // ------------------------------------------------------------ G-CANCEL-05
    function test_CANCEL05_NoCancelAfterExecute() public {
        uint256 id = _payrollPass(payee1, 5e6);
        _cancelReverts(id, approver1, _notPending(id));
        _cancelReverts(id, guardian, _notPending(id));
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executed));
    }

    function test_CANCEL05_NoCancelAtOrAfterExpiry() public {
        uint64 exp = _now() + PAYROLL_DELAY + 1 hours;
        uint256 a = _proposePayrollExp(approver1, payee1, 5e6, exp);
        uint256 b = _proposePayrollExp(approver1, payee1, 5e6, exp);
        vm.warp(exp - 1);
        _cancel(a, approver1); // last valid second
        vm.warp(exp);
        bytes memory err = abi.encodeWithSelector(AskirawaTreasury.Expired.selector, b);
        _cancelReverts(b, approver1, err);
        _cancelReverts(b, guardian, err);
        vm.warp(exp + 30 days);
        _cancelReverts(b, approver1, err);
    }

    function test_CANCEL05_CancelTwiceReverts() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        _cancel(id, approver1);
        _cancelReverts(id, approver1, _notPending(id));
        _cancelReverts(id, guardian, _notPending(id));
    }

    function test_CANCEL05_CancelNonexistentReverts() public {
        _cancelReverts(77, approver1, _notPending(77));
    }

    function test_CANCEL05_CannotCancelRejected() public {
        uint256 id = _proposePayroll(proposerOnly, payee1, 5e6);
        _reject(id, approver1);
        _reject(id, approver2);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Rejected));
        _cancelReverts(id, proposerOnly, _notPending(id));
    }

    function test_CANCEL05_CancelledProposalCannotBeVotedOrExecuted() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        _approve(id, approver2); // quorum reached
        _cancel(id, approver1);
        vm.prank(approver3);
        vm.expectRevert(_notPending(id));
        t.approve(id);
        vm.prank(approver3);
        vm.expectRevert(_notPending(id));
        t.reject(id);
        _warpToExecutable(id);
        vm.warp(_now() + 1 days);
        vm.expectRevert(_notPending(id));
        t.execute(id);
        assertEq(usdc.balanceOf(payee1), 0);
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS);
    }

    // ------------------------------------------------------------ G-CANCEL-06
    function _forbidden() internal pure returns (string[40] memory s) {
        s = [
            "owner()", "pendingOwner()", "transferOwnership(address)", "renounceOwnership()",
            "acceptOwnership()", "setOwner(address)", "withdraw(uint256)", "withdraw(address,uint256)",
            "withdrawAll()", "withdrawTo(address,uint256)", "emergencyWithdraw()",
            "emergencyWithdraw(address,uint256)", "sweep(address)", "sweepAll(address)", "drain()",
            "recover(address,uint256)", "recoverFunds()", "rescueFunds()", "execute(address,uint256,bytes)",
            "call(address,bytes)", "delegatecall(address,bytes)", "upgradeTo(address)",
            "upgradeToAndCall(address,bytes)", "initialize()", "initialize(address)", "selfdestruct(address)",
            "kill()", "setGuardian(address)", "setPaused(bool)", "unpause()", "transfer(address,uint256)",
            "skipPayment(uint256,uint256)", "executePartial(uint256)", "executeBatch(uint256[])",
            "forceExecute(uint256)", "setQuorum(uint8)", "setApprovers(address[])", "setUsdc(address)",
            "mint(address,uint256)", "grantRole(bytes32,address)"];
    }

    function test_CANCEL06_NoOwnerOrWithdrawStyleSelectorResponds() public {
        string[40] memory sigs = _forbidden();
        address[4] memory callers = [approver1, guardian, proposerOnly, outsider];
        for (uint256 i; i < sigs.length; ++i) {
            bytes memory data = abi.encodePacked(bytes4(keccak256(bytes(sigs[i]))), new bytes(128));
            for (uint256 j; j < callers.length; ++j) {
                vm.prank(callers[j]);
                (bool ok, bytes memory ret) = address(t).call(data);
                assertFalse(ok, sigs[i]);
                assertEq(ret.length, 0, sigs[i]);
            }
        }
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS, "no funds moved by any probe");
    }

    function test_CANCEL06_ControlRealSelectorsRespond() public {
        // proves the probe method can distinguish a present selector from an absent one
        (bool ok, bytes memory ret) = address(t).call(abi.encodeWithSignature("MIN_QUORUM()"));
        assertTrue(ok);
        assertEq(abi.decode(ret, (uint8)), 2);
        (ok,) = address(t).call(abi.encodeWithSignature("currentEpoch()"));
        assertTrue(ok);
        (ok,) = address(t).call(abi.encodeWithSignature("guardian()"));
        assertTrue(ok);
    }

    function test_CANCEL06_NoFallbackNoReceive() public {
        vm.deal(outsider, 1 ether);
        vm.prank(outsider);
        (bool ok,) = address(t).call{value: 1 ether}("");
        assertFalse(ok, "plain ETH transfer rejected");
        vm.prank(outsider);
        (ok,) = address(t).call{value: 1 ether}(hex"deadbeef");
        assertFalse(ok, "unknown selector with value rejected");
        vm.prank(outsider);
        (ok,) = address(t).call(hex"deadbeef");
        assertFalse(ok, "unknown selector rejected");
        assertEq(address(t).balance, 0);
    }
}
