// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";

/// @notice Timing: expiry bounds per action type, executableAt gating, exact-boundary seconds.
contract AskirawaTreasuryTimingTest is AskirawaTreasuryTestBase {
    function _badExpiry(uint64 e) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(AskirawaTreasury.InvalidExpiry.selector, e);
    }

    function _delayNotElapsed(uint64 at) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(AskirawaTreasury.DelayNotElapsed.selector, at);
    }

    // ------------------------------------------------------------ expiry bounds per action type
    function _expiryBounds(Kind k) internal {
        _prep(k);
        uint64 nowTs = _now();
        uint64 minExp = nowTs + _delayOf(k) + 1 hours;
        uint64 maxExp = nowTs + 30 days;

        vm.expectRevert(_badExpiry(minExp - 1));
        _proposeKind(k, approver1, minExp - 1);
        vm.expectRevert(_badExpiry(maxExp + 1));
        _proposeKind(k, approver1, maxExp + 1);
        vm.expectRevert(_badExpiry(0));
        _proposeKind(k, approver1, 0);
        vm.expectRevert(_badExpiry(nowTs));
        _proposeKind(k, approver1, nowTs);
        vm.expectRevert(_badExpiry(type(uint64).max));
        _proposeKind(k, approver1, type(uint64).max);

        uint256 lo = _proposeKind(k, approver1, minExp);
        uint256 hi = _proposeKind(k, approver1, maxExp);
        assertEq(t.getProposal(lo).expiresAt, minExp);
        assertEq(t.getProposal(hi).expiresAt, maxExp);
        assertEq(t.getProposal(lo).createdAt, nowTs);
    }

    function test_TIME_ExpiryBounds_Payroll() public { _expiryBounds(Kind.Payroll); }
    function test_TIME_ExpiryBounds_Governance() public { _expiryBounds(Kind.Governance); }
    function test_TIME_ExpiryBounds_ModuleConfig() public { _expiryBounds(Kind.ModuleConfig); }
    function test_TIME_ExpiryBounds_ModuleAction() public { _expiryBounds(Kind.ModuleAction); }
    function test_TIME_ExpiryBounds_Rescue() public { _expiryBounds(Kind.Rescue); }
    function test_TIME_ExpiryBounds_Unpause() public { _expiryBounds(Kind.Unpause); }

    function testFuzz_TIME_ExpiryBoundsFollowDelayClass(uint32 pdRaw, uint32 cdRaw, uint8 sel, uint64 e) public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.payrollDelay = uint32(bound(pdRaw, 0, 14 days));
        c.configDelay = uint32(bound(cdRaw, MIN_CONFIG_DELAY, 14 days));
        _govPass(c);
        Kind k = sel % 2 == 0 ? Kind.Payroll : Kind.Governance;
        uint64 nowTs = _now();
        e = uint64(bound(e, nowTs, nowTs + 31 days));
        uint64 delay = k == Kind.Payroll ? c.payrollDelay : c.configDelay;
        bool expectOk = e >= nowTs + delay + 1 hours && e <= nowTs + 30 days;
        bool ok;
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 1e6);
        AskirawaTreasury.GovernancePayload memory g = _cfg();
        vm.prank(approver1);
        if (k == Kind.Payroll) {
            try t.proposePayroll(items, e, MEMO) returns (uint256) { ok = true; } catch { ok = false; }
        } else {
            try t.proposeGovernance(g, e, MEMO) returns (uint256) { ok = true; } catch { ok = false; }
        }
        assertEq(ok, expectOk);
    }

    // ------------------------------------------------------------ executableAt gating per kind
    function _gate(Kind k) internal {
        _prep(k);
        uint256 id = _proposeKind(k, approver1, _exp());
        _approve(id, approver2);
        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        assertEq(p.executableAt, p.approvedAt + _delayOf(k));
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Approved));

        vm.warp(p.approvedAt); // same second as quorum
        vm.expectRevert(_delayNotElapsed(p.executableAt));
        t.execute(id);
        vm.warp(p.executableAt - 1);
        vm.expectRevert(_delayNotElapsed(p.executableAt));
        t.execute(id);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Approved));

        vm.warp(p.executableAt); // exact boundary second is executable
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executable));
        t.execute(id);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executed));
    }

    function test_TIME_Gate_Payroll() public { _gate(Kind.Payroll); }
    function test_TIME_Gate_Governance() public { _gate(Kind.Governance); }
    function test_TIME_Gate_ModuleConfig() public { _gate(Kind.ModuleConfig); }
    function test_TIME_Gate_ModuleAction() public { _gate(Kind.ModuleAction); }
    function test_TIME_Gate_Rescue() public { _gate(Kind.Rescue); }
    function test_TIME_Gate_Unpause() public { _gate(Kind.Unpause); }

    function test_TIME_DelayStartsAtQuorumNotAtCreation() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        uint64 created = _now();
        vm.warp(created + 10 hours);
        _approve(id, approver2);
        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        assertEq(p.approvedAt, created + 10 hours);
        assertEq(p.executableAt, created + 10 hours + PAYROLL_DELAY);
        vm.warp(created + PAYROLL_DELAY); // creation + delay would have been enough, quorum + delay is not
        vm.expectRevert(_delayNotElapsed(p.executableAt));
        t.execute(id);
    }

    function test_TIME_ZeroPayrollDelayExecutesInSameBlockAsQuorum() public {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.payrollDelay = 0;
        _govPass(c);
        uint64 nowTs = _now();
        vm.expectRevert(_badExpiry(nowTs + 1 hours - 1));
        _proposePayrollExp(approver1, payee1, 5e6, nowTs + 1 hours - 1);
        uint256 id = _proposePayrollExp(approver1, payee1, 5e6, nowTs + 1 hours);
        _approve(id, approver2);
        assertEq(t.getProposal(id).executableAt, t.getProposal(id).approvedAt);
        t.execute(id);
        assertEq(usdc.balanceOf(payee1), 5e6);
    }

    // ------------------------------------------------------------ exact expiry boundary at execution
    function test_TIME_ExecuteAtExpiryMinusOneVsExpiry() public {
        uint64 start = _now();
        uint64 exp = start + PAYROLL_DELAY + 1 hours; // tightest legal expiry
        uint256 ok = _proposePayrollExp(approver1, payee1, 5e6, exp);
        uint256 late = _proposePayrollExp(approver1, payee2, 5e6, exp);

        vm.warp(start + 1 hours - 1);
        _approve(ok, approver2); // executableAt == exp - 1
        assertEq(t.getProposal(ok).executableAt, exp - 1);
        vm.warp(start + 1 hours);
        _approve(late, approver2); // executableAt == exp
        assertEq(t.getProposal(late).executableAt, exp);

        vm.warp(exp - 1);
        t.execute(ok); // the single executable second
        assertEq(usdc.balanceOf(payee1), 5e6);
        vm.expectRevert(_delayNotElapsed(exp));
        t.execute(late);

        vm.warp(exp);
        assertEq(uint8(_status(late)), uint8(AskirawaTreasury.ProposalStatus.Expired));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.Expired.selector, late));
        t.execute(late);
        assertEq(usdc.balanceOf(payee2), 0);
    }

    function test_TIME_StatusProgressionAtExactSeconds() public {
        uint64 start = _now();
        uint64 exp = start + 3 days;
        uint256 id = _proposePayrollExp(proposerOnly, payee1, 5e6, exp);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Pending));
        _approve(id, approver1);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Pending), "1 of 2");
        _approve(id, approver2);
        uint64 at = t.getProposal(id).executableAt;
        assertEq(at, start + PAYROLL_DELAY);
        vm.warp(at - 1);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Approved));
        vm.warp(at);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executable));
        vm.warp(exp - 1);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executable));
        vm.warp(exp);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Expired));
    }

    function test_TIME_ExpiredProposalNeverExecutesEvenWithQuorum() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        _approve(id, approver2);
        vm.warp(t.getProposal(id).expiresAt);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.Expired.selector, id));
        t.execute(id);
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS);
    }

    function test_TIME_PendingProposalExpiresWithoutQuorum() public {
        uint256 id = _proposePayroll(approver1, payee1, 5e6);
        uint64 exp = t.getProposal(id).expiresAt;
        vm.warp(exp - 1);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Pending));
        vm.warp(exp);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Expired));
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending), "stored status not rewritten");
    }

    function test_TIME_StoredCreatedAtAndSequentialIds() public {
        uint256 a = _proposePayroll(approver1, payee1, 1e6);
        vm.warp(_now() + 123);
        uint256 b = _proposePayroll(approver1, payee1, 1e6);
        assertEq(b, a + 1);
        assertEq(t.getProposal(b).createdAt, t.getProposal(a).createdAt + 123);
        assertEq(t.nextProposalId(), b + 1);
    }
}
