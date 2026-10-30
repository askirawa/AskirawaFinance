// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VmSafe} from "forge-std/Vm.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {TreasuryRecovery} from "../../v2/TreasuryRecovery.sol";
import {TreasuryRecoveryBase} from "./TreasuryRecovery.Base.t.sol";

/// @notice Authorization and fund-safety verification of the external recovery contract.
/// The state-diff tests record EVERY call the recovery contract makes during full recovery lifecycles
/// (initiate, cancel, approve, veto, expire, execute) and assert the complete call surface.
contract TreasuryRecoveryAuthTest is TreasuryRecoveryBase {
    function _allowed(bytes4 s) internal pure returns (bool) {
        return s == AskirawaTreasury.validateGovernance.selector || s == AskirawaTreasury.installRecovery.selector
            || s == bytes4(keccak256("currentEpoch()")) || s == bytes4(keccak256("quorum()"))
            || s == bytes4(keccak256("isApproverAt(uint256,address)")) || s == bytes4(keccak256("lastActivityAt()"))
            || s == bytes4(keccak256("coolingEnd()"));
    }

    /// @dev Runs every recovery path while recording all account accesses.
    function _lifecycle() internal {
        _warpEligible();
        uint256 a = _initiate(council1);
        vm.prank(council1);
        rec.cancelRecovery(a); // path: cancel

        uint256 b = _initiate(council1);
        _councilApprove(b, council2);
        _veto(b, approver1);
        _veto(b, approver2); // path: veto (resets the gate)

        _warpEligible();
        uint256 c = _initiate(council1);
        vm.warp(vm.getBlockTimestamp() + VOTING_WINDOW + 1);
        rec.expireRecovery(c); // path: time expiry

        uint256 d = _initiate(council2);
        _councilApprove(d, council3);
        vm.warp(vm.getBlockTimestamp() + DELAY);
        _execRecovery(d); // path: execute
    }

    function test_AUTH01_RecoveryContractOnlyCallsTheRestrictedTreasuryHooks() public {
        vm.startStateDiffRecording();
        _lifecycle();
        VmSafe.AccountAccess[] memory acc = vm.stopAndReturnStateDiff();

        uint256 sawInstall;
        uint256 sawValidate;
        uint256 outgoing;
        for (uint256 i; i < acc.length; ++i) {
            VmSafe.AccountAccess memory x = acc[i];
            if (x.accessor != address(rec)) continue;
            // every outgoing interaction of the recovery contract, no matter how deep
            if (x.kind == VmSafe.AccountAccessKind.Create || x.kind == VmSafe.AccountAccessKind.SelfDestruct
                || x.kind == VmSafe.AccountAccessKind.DelegateCall || x.kind == VmSafe.AccountAccessKind.CallCode) {
                fail("recovery contract used a forbidden call kind");
            }
            if (x.kind == VmSafe.AccountAccessKind.Call || x.kind == VmSafe.AccountAccessKind.StaticCall) {
                ++outgoing;
                assertEq(x.account, address(t), "recovery called something other than its treasury");
                assertEq(x.value, 0, "recovery sent native value");
                bytes4 sel = bytes4(x.data);
                assertTrue(_allowed(sel), "recovery called a non-allowlisted treasury function");
                if (sel == AskirawaTreasury.installRecovery.selector) ++sawInstall;
                if (sel == AskirawaTreasury.validateGovernance.selector) ++sawValidate;
            }
        }
        assertGt(outgoing, 0, "recording captured nothing");
        assertEq(sawInstall, 1, "exactly one install, from the single executed recovery");
        assertGt(sawValidate, 3, "every initiation and the execution validate the configuration");
    }

    function test_AUTH02_RecoveryNeverTouchesTheTokenAndMovesNoFunds() public {
        uint256 funds = _fundsOf();
        uint256 supply = usdc.totalSupply();
        vm.startStateDiffRecording();
        _lifecycle();
        VmSafe.AccountAccess[] memory acc = vm.stopAndReturnStateDiff();
        for (uint256 i; i < acc.length; ++i) {
            if (acc[i].accessor == address(rec) || acc[i].accessor == address(t)) {
                assertTrue(acc[i].account != address(usdc), "recovery path touched the token");
            }
        }
        assertEq(_fundsOf(), funds, "treasury balance changed");
        assertEq(usdc.totalSupply(), supply);
        assertEq(usdc.balanceOf(address(rec)), 0);
        assertEq(address(rec).balance, 0);
    }

    function test_AUTH03_OnlyTheBoundRecoveryCanInstall_AndOnlyOnItsOwnTreasury() public {
        // a second treasury wired to its own recovery contract (note: _newRecovery() reassigns `rec`)
        TreasuryRecovery first = rec;
        TreasuryRecovery rec2 = _newRecovery();
        AskirawaTreasury t2 = new AskirawaTreasury(address(usdc), MIN_CONFIG_DELAY, _arr(approver1, approver2, approver3),
            new address[](0), 2, guardian, PAYROLL_DELAY, CONFIG_DELAY, address(rec2));
        vm.warp(vm.getBlockTimestamp() + 40 days);
        AskirawaTreasury.GovernancePayload memory c = _replacement();
        // the first treasury's recovery contract is not t2's recovery contract
        vm.prank(address(first));
        vm.expectRevert(AskirawaTreasury.NotRecovery.selector);
        t2.installRecovery(c);
        // nobody else is either: approvers, council, guardian, the treasury itself, this test
        address[6] memory others = [approver1, council1, guardian, address(t2), address(this), address(0xBEEF)];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(AskirawaTreasury.NotRecovery.selector);
            t2.installRecovery(c);
        }
        // and the bound recovery contract cannot be re-bound to anything else
        vm.expectRevert(TreasuryRecovery.AlreadyBound.selector);
        vm.prank(address(0xBEEF));
        first.bindTreasury(_arr(approver1, approver2), guardian);
    }

    function test_AUTH04_TreasuryRecoveryAddressIsImmutableAndMatches() public view {
        assertEq(t.recovery(), address(rec));
        assertEq(address(rec.treasury()), address(t));
    }

    function test_AUTH05_LIMITATION_OrdinaryGovernanceCanMakeACouncilMemberAnApprover() public {
        // Documented residual: council independence is checked at deployment and inside recovery,
        // not on ordinary governance. A quorum of approvers can knowingly add a council member as approver.
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        c.approvers = _arr(approver1, approver2, council1);
        uint256 id = _proposeGov(approver1, c);
        _reachQuorum(id);
        _warpToExecutable(id);
        t.execute(id);
        assertTrue(t.isApprover(council1));
        assertTrue(rec.isCouncilMember(council1));
    }

    function test_AUTH06_LIMITATION_CouncilCanOnlyBeReplacedByARecovery() public {
        // There is no function that rotates the council outside executeRecovery. Replacement happens only
        // through a full recovery (30 day gate + 14 day timelock), which also resets the gate.
        _recoverNow();
        assertTrue(rec.isCouncilMember(nC1));
        assertFalse(rec.isCouncilMember(council1));
        // the old council is powerless
        vm.prank(council1);
        vm.expectRevert(TreasuryRecovery.NotCouncilMember.selector);
        rec.initiateRecovery(_replacement(), _newCouncil(), 2);
    }

    function test_AUTH07_FailedExecuteIsAtomic() public {
        uint256 id = _timelocked();
        vm.warp(vm.getBlockTimestamp() + DELAY);
        // an executed proposal during the window voids the recovery; the revert must not change state
        uint256 pid = _proposePayrollExp(approver1, outsider, 1e6, uint64(vm.getBlockTimestamp() + 20 days));
        _reachQuorum(pid);
        _warpToExecutable(pid);
        uint256 epochBefore = t.currentEpoch();
        // execute payroll: this is activity AFTER initiation
        t.execute(pid);
        vm.expectRevert(abi.encodeWithSelector(TreasuryRecovery.RecoveryStale.selector, id, uint8(3)));
        _execRecovery(id);
        assertEq(t.currentEpoch(), epochBefore);
        assertEq(uint8(_recStatus(id)), uint8(TreasuryRecovery.Status.Timelocked), "state unchanged by the failed call");
        assertTrue(rec.isCouncilMember(council1), "council unchanged");
    }
}
