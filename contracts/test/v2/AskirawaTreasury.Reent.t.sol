// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryPayBase} from "./AskirawaTreasury.PayBase.t.sol";
import {V2MockModule} from "./mocks/V2MockModule.sol";
import {V2ReentrantToken} from "./mocks/V2ReentrantToken.sol";

/// @notice S-REENT 01-03 (core part): re-entrancy through a hostile token. The module-callback
/// side lives in AskirawaTreasury.ModAction.t.sol (test_SREENT02_*).
contract AskirawaTreasuryReentTest is AskirawaTreasuryPayBase {
    bytes4 internal constant REENT = 0x3ee5aeb5; // ReentrancyGuardReentrantCall()
    uint256 internal constant FUNDS = 1_000_000e6;

    V2ReentrantToken internal rt;

    function setUp() public override {
        super.setUp();
        rt = new V2ReentrantToken();
        t = _deployWith(address(rt));
        mod = new V2MockModule(address(t));
        rt.mint(address(t), FUNDS);
    }

    function _balRT(AskirawaTreasury.Payment[] memory items, uint256 i) internal view returns (uint256) {
        return rt.balanceOf(items[i].to);
    }

    function _assertBlocked() internal view {
        assertFalse(rt.hookOk(), "re-entry must fail");
        assertEq(bytes4(rt.hookRet()), REENT, "rejected by the reentrancy lock");
    }

    // ------------------------------------------------------------ S-REENT-01 token re-enters execute
    function test_SREENT01_TokenReentersSameExecuteDuringTransfer() public {
        AskirawaTreasury.Payment[] memory items = _batch(3, 10e6);
        uint256 id = _ready(items);
        rt.arm(address(t), abi.encodeCall(AskirawaTreasury.execute, (id)), true, false, false);
        rt.setOnce(false);
        _exec(id);
        assertEq(rt.hookCount(), 3, "hook fired on every payment");
        _assertBlocked();
        for (uint256 i; i < 3; ++i) assertEq(_balRT(items, i), 10e6, "paid exactly once");
        assertEq(rt.balanceOf(address(t)), FUNDS - 30e6);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executed));
    }

    function test_SREENT01_ReentryAfterBalancesMovedIsAlsoBlocked() public {
        AskirawaTreasury.Payment[] memory items = _batch(2, 7e6);
        uint256 id = _ready(items);
        rt.arm(address(t), abi.encodeCall(AskirawaTreasury.execute, (id)), true, false, true);
        _exec(id);
        _assertBlocked();
        assertEq(_balRT(items, 0), 7e6);
        assertEq(_balRT(items, 1), 7e6);
        assertEq(rt.balanceOf(address(t)), FUNDS - 14e6);
    }

    function test_SREENT01_TokenCannotPullAnotherApprovedProposalThroughReentry() public {
        AskirawaTreasury.Payment[] memory a = _batch(2, 5e6);
        AskirawaTreasury.Payment[] memory b = _pay(payee2, 99e6);
        uint256 ida = _ready(a);
        uint256 idb = _ready(b);
        rt.arm(address(t), abi.encodeCall(AskirawaTreasury.execute, (idb)), true, false, false);
        _exec(ida);
        _assertBlocked();
        assertEq(rt.balanceOf(payee2), 0, "second proposal not paid by re-entry");
        assertEq(uint8(t.getProposal(idb).status), uint8(AskirawaTreasury.Status.Pending));
        // it still executes normally afterwards, exactly once
        rt.arm(address(0), "", false, false, false);
        _exec(idb);
        assertEq(rt.balanceOf(payee2), 99e6);
        assertEq(rt.balanceOf(address(t)), FUNDS - 10e6 - 99e6);
    }

    function test_SREENT01_TokenReentersDepositDuringPayroll() public {
        AskirawaTreasury.Payment[] memory items = _batch(2, 3e6);
        uint256 id = _ready(items);
        rt.mint(address(rt), 50e6);
        rt.selfApprove(address(t), 50e6);
        rt.arm(address(t), abi.encodeCall(AskirawaTreasury.deposit, (20e6)), true, false, false);
        _exec(id);
        _assertBlocked();
        assertEq(rt.balanceOf(address(t)), FUNDS - 6e6, "no stray deposit landed");
        assertEq(rt.balanceOf(address(rt)), 50e6);
    }

    function test_SREENT01_EnabledModuleCannotDrawThroughTokenCallbackDuringPayroll() public {
        _enableModule();
        AskirawaTreasury.Payment[] memory items = _batch(2, 3e6);
        uint256 id = _ready(items);
        rt.arm(address(mod), abi.encodeCall(V2MockModule.pay, (payee2, 100e6, bytes32(0))), true, false, false);
        _exec(id);
        _assertBlocked();
        assertEq(rt.balanceOf(payee2), 0);
        (,,,,,, uint96 spent) = t.modules(address(mod));
        assertEq(spent, 0, "no budget consumed");
        assertEq(rt.balanceOf(address(t)), FUNDS - 6e6);
        // fundModule from the same position
        rt.arm(address(mod), abi.encodeCall(V2MockModule.fund, (100e6, bytes32(0))), true, false, false);
        uint256 id2 = _ready(_pay(payee1, 1e6));
        _exec(id2);
        _assertBlocked();
        assertEq(rt.balanceOf(address(mod)), 0);
    }

    function test_SREENT01_TokenReentersDuringModuleActionFunding() public {
        _enableModule();
        uint256 id = _proposeModuleAction(approver1, 100e6);
        _reachQuorum(id);
        _warpToExecutable(id);
        rt.arm(address(mod), abi.encodeCall(V2MockModule.fund, (100e6, bytes32(0))), true, false, false);
        _exec(id);
        _assertBlocked();
        assertEq(rt.balanceOf(address(mod)), 100e6, "only the approved funding");
        (,,,,,, uint96 spent) = t.modules(address(mod));
        assertEq(spent, 100e6);
    }

    function test_SREENT01_ReentryDuringModuleDrawIsBlocked() public {
        _enableModule();
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 1e6);
        uint256 id = _ready(items);
        rt.arm(address(t), abi.encodeCall(AskirawaTreasury.execute, (id)), true, false, false);
        vm.prank(address(mod));
        t.payFromModule(payee2, 50e6, bytes32(0));
        _assertBlocked();
        assertEq(rt.balanceOf(payee2), 50e6);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
    }

    // ------------------------------------------------------------ reentry through transferFrom (deposit)
    function test_SREENT01_TokenReentersExecuteAndDepositDuringDeposit() public {
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 4e6);
        uint256 id = _ready(items);
        rt.mint(outsider, 100e6);
        vm.prank(outsider);
        rt.approve(address(t), 100e6);
        rt.arm(address(t), abi.encodeCall(AskirawaTreasury.execute, (id)), false, true, false);
        vm.prank(outsider);
        t.deposit(100e6);
        _assertBlocked();
        assertEq(rt.balanceOf(address(t)), FUNDS + 100e6);
        assertEq(rt.balanceOf(payee1), 0);
        // and a nested deposit
        rt.mint(address(rt), 10e6);
        rt.selfApprove(address(t), 10e6);
        rt.mint(outsider, 5e6);
        vm.prank(outsider);
        rt.approve(address(t), 5e6);
        rt.arm(address(t), abi.encodeCall(AskirawaTreasury.deposit, (10e6)), false, true, true);
        vm.prank(outsider);
        t.deposit(5e6);
        _assertBlocked();
        assertEq(rt.balanceOf(address(t)), FUNDS + 105e6);
    }

    // ------------------------------------------------------------ S-REENT-03 / recipients have no hook
    function test_SREENT03_ContractRecipientReceivesNoCallback() public {
        // standard token fixture: a contract recipient only gains a balance; none of its code runs
        usdc.mint(address(t), 1e6); // keep the treasury non-trivially funded for the original USDC
        AskirawaTreasury plain = _deployWith(address(usdc));
        usdc.mint(address(plain), 100e6);
        t = plain;
        mod = new V2MockModule(address(plain));
        AskirawaTreasury.Payment[] memory items = _pay(address(mod), 25e6);
        uint256 id = _ready(items);
        _exec(id);
        assertEq(usdc.balanceOf(address(mod)), 25e6);
        assertEq(mod.callCount(), 0, "no onApproved/receive hook invoked");
        assertFalse(mod.reenterAttempted());
    }

    function test_SREENT01_ExecuteTwiceViaHookStillPaysOnce() public {
        AskirawaTreasury.Payment[] memory items = _batch(5, 1e6);
        uint256 id = _ready(items);
        rt.setOnce(false);
        rt.arm(address(t), abi.encodeCall(AskirawaTreasury.execute, (id)), true, true, true);
        _exec(id);
        uint256 total;
        for (uint256 i; i < 5; ++i) total += _balRT(items, i);
        assertEq(total, 5e6);
        assertEq(rt.balanceOf(address(t)), FUNDS - 5e6);
    }
}
