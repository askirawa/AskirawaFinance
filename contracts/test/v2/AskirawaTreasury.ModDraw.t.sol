// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";
import {V2ConfigurableModule, V2PlainContract} from "./mocks/V2ConfigurableModule.sol";

/// @notice G-MOD 02-06: payFromModule / fundModule budgets, window rollover, caller and state gates.
contract AskirawaTreasuryModDrawTest is AskirawaTreasuryTestBase {
    bytes32 internal constant REF = keccak256("PLACEHOLDER_REF");

    function setUp() public override {
        super.setUp();
        _enableModule();
    }

    function _payAs(address who, address to, uint256 amount) internal {
        vm.prank(who);
        t.payFromModule(to, amount, REF);
    }

    function _fundAs(address who, uint256 amount) internal {
        vm.prank(who);
        t.fundModule(amount, REF);
    }

    function _start() internal view returns (uint64 start) { (,,,,, start,) = t.modules(address(mod)); }

    function _spent() internal view returns (uint96 spent) { (,,,,,, spent) = t.modules(address(mod)); }

    // ------------------------------------------------------------ happy paths and events
    function test_MOD_PayFromModuleSendsToRecipientAndEmits() public {
        vm.expectEmit(true, true, false, true, address(t));
        emit AskirawaTreasury.ModulePaid(address(mod), payee1, 123e6, REF);
        _payAs(address(mod), payee1, 123e6);
        assertEq(usdc.balanceOf(payee1), 123e6);
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS - 123e6);
        assertEq(_spent(), 123e6);
    }

    function test_MOD_FundModuleSendsToModuleCustodyAndEmits() public {
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.ModuleFunded(address(mod), 77e6, REF);
        _fundAs(address(mod), 77e6);
        assertEq(usdc.balanceOf(address(mod)), 77e6);
        assertEq(_spent(), 77e6);
    }

    function test_MOD_PayAndFundShareTheSameBudget() public {
        _payAs(address(mod), payee1, 600e6);
        _fundAs(address(mod), 400e6);
        assertEq(_spent(), 1_000e6);
        assertEq(t.moduleSpendRemaining(address(mod)), WINDOW_MAX - 1_000e6);
    }

    // ------------------------------------------------------------ perTxMax / windowMax
    function test_MOD02_PerTxMaxBoundary() public {
        _payAs(address(mod), payee1, PER_TX);
        vm.prank(address(mod));
        vm.expectRevert(AskirawaTreasury.BudgetExceeded.selector);
        t.payFromModule(payee1, uint256(PER_TX) + 1, REF);
        vm.prank(address(mod));
        vm.expectRevert(AskirawaTreasury.BudgetExceeded.selector);
        t.fundModule(uint256(PER_TX) + 1, REF);
        assertEq(_spent(), PER_TX);
    }

    function test_MOD02_ZeroAmountReverts() public {
        vm.prank(address(mod));
        vm.expectRevert(AskirawaTreasury.ZeroAmount.selector);
        t.payFromModule(payee1, 0, REF);
        vm.prank(address(mod));
        vm.expectRevert(AskirawaTreasury.ZeroAmount.selector);
        t.fundModule(0, REF);
    }

    function test_MOD02_WindowMaxBoundary() public {
        for (uint256 i; i < 5; ++i) _payAs(address(mod), payee1, PER_TX);
        assertEq(_spent(), WINDOW_MAX);
        assertEq(t.moduleSpendRemaining(address(mod)), 0);
        vm.prank(address(mod));
        vm.expectRevert(AskirawaTreasury.BudgetExceeded.selector);
        t.payFromModule(payee1, 1, REF);
        assertEq(usdc.balanceOf(payee1), WINDOW_MAX);
    }

    function test_MOD02_WindowRolloverAtExactBoundarySecond() public {
        for (uint256 i; i < 5; ++i) _payAs(address(mod), payee1, PER_TX);
        uint64 start = _start();
        uint256 end = uint256(start) + WINDOW_LEN;
        vm.warp(end - 1);
        vm.prank(address(mod));
        vm.expectRevert(AskirawaTreasury.BudgetExceeded.selector);
        t.payFromModule(payee1, 1, REF);
        vm.warp(end);
        _payAs(address(mod), payee1, 1);
        assertEq(_start(), end, "new window anchors at the first draw at/after expiry");
        assertEq(_spent(), 1);
        assertEq(t.moduleSpendRemaining(address(mod)), WINDOW_MAX - 1);
    }

    function test_MOD02_NewWindowAnchorsToDrawTimeNotOldEnd() public {
        _payAs(address(mod), payee1, 1e6);
        uint64 start = _start();
        vm.warp(uint256(start) + 3 * WINDOW_LEN + 123);
        _payAs(address(mod), payee1, 1e6);
        assertEq(_start(), start + 3 * WINDOW_LEN + 123);
        assertEq(_spent(), 1e6);
    }

    function testFuzz_MOD02_BudgetNeverExceededInAnyWindow(uint8 seedA, uint8 seedB) public {
        uint256 ghostSpent;
        uint64 ghostStart = _start();
        uint256 paid;
        for (uint256 i; i < 24; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seedA, seedB, i)));
            skip(bound(r, 0, 2 days));
            uint256 amount = bound(r >> 64, 0, uint256(PER_TX) * 3 / 2);
            vm.prank(address(mod));
            (bool ok,) = address(t).call(abi.encodeCall(AskirawaTreasury.payFromModule, (payee1, amount, REF)));
            // mirror: new window if due
            if (_now() >= uint256(ghostStart) + WINDOW_LEN && ok) { ghostStart = _now(); ghostSpent = 0; }
            if (ok) { ghostSpent += amount; paid += amount; }
            assertLe(_spent(), WINDOW_MAX, "windowSpent <= windowMax");
            if (ok) assertEq(_spent(), ghostSpent);
        }
        assertEq(usdc.balanceOf(payee1), paid);
        assertLe(ghostSpent, WINDOW_MAX);
    }

    function test_MOD02_ExecuteInsufficientTreasuryBalanceRollsBackBudget() public {
        _payrollPass(payee2, uint96(TREASURY_FUNDS - 100e6));
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InsufficientBalance.selector, 100e6, 200e6));
        t.payFromModule(payee1, 200e6, REF);
        assertEq(_spent(), 0, "failed draw consumed no budget");
        assertEq(usdc.balanceOf(payee1), 0);
    }

    // ------------------------------------------------------------ recipients
    function test_MOD_ZeroRecipientAndTreasuryRecipientRevert() public {
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(0)));
        t.payFromModule(address(0), 1e6, REF);
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(t)));
        t.payFromModule(address(t), 1e6, REF);
        assertEq(_spent(), 0);
    }

    // ------------------------------------------------------------ G-MOD-06 non-module callers
    function test_MOD06_NonModuleCallersRevertModuleDisabled() public {
        address[5] memory who = [outsider, approver1, guardian, proposerOnly, address(usdc)];
        for (uint256 i; i < who.length; ++i) {
            vm.prank(who[i]);
            vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, who[i]));
            t.payFromModule(payee1, 1e6, REF);
            vm.prank(who[i]);
            vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, who[i]));
            t.fundModule(1e6, REF);
        }
        assertEq(usdc.balanceOf(payee1), 0);
    }

    function test_MOD06_UnregisteredButValidLookingModuleReverts() public {
        V2ConfigurableModule other_ = new V2ConfigurableModule(address(t), true, true, false, false, false, false);
        vm.prank(address(other_));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, address(other_)));
        t.payFromModule(payee1, 1e6, REF);
    }

    // ------------------------------------------------------------ G-MOD-04 disabled
    function test_MOD04_DisabledModuleCannotDraw() public {
        _pass(_proposeModuleConfig(approver1, false));
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, address(mod)));
        t.payFromModule(payee1, 1e6, REF);
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, address(mod)));
        t.fundModule(1e6, REF);
        // and can draw again after re-enabling
        _pass(_proposeModuleConfig(approver1, true));
        _payAs(address(mod), payee1, 1e6);
        assertEq(usdc.balanceOf(payee1), 1e6);
    }

    // ------------------------------------------------------------ G-MOD-03 codehash
    function test_MOD03_CodehashChangeBlocksPayAndFund() public {
        _payAs(address(mod), payee1, 1e6); // control
        vm.etch(address(mod), address(new V2PlainContract()).code);
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCodeChanged.selector, address(mod)));
        t.payFromModule(payee1, 1e6, REF);
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCodeChanged.selector, address(mod)));
        t.fundModule(1e6, REF);
        assertEq(usdc.balanceOf(payee1), 1e6);
    }

    function test_MOD03_RemovedCodeBlocksDraw() public {
        vm.etch(address(mod), hex"");
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCodeChanged.selector, address(mod)));
        t.payFromModule(payee1, 1e6, REF);
    }

    function test_MOD03_RestoringOriginalCodeRestoresAccess() public {
        bytes memory original = address(mod).code;
        vm.etch(address(mod), address(new V2PlainContract()).code);
        vm.prank(address(mod));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCodeChanged.selector, address(mod)));
        t.payFromModule(payee1, 1e6, REF);
        vm.etch(address(mod), original);
        _payAs(address(mod), payee1, 1e6);
        assertEq(usdc.balanceOf(payee1), 1e6);
    }

    // ------------------------------------------------------------ paused
    function test_MOD_PausedRevertsBothDrawsBeforeAnyOtherCheck() public {
        _pause();
        vm.prank(address(mod));
        vm.expectRevert(AskirawaTreasury.TreasuryPaused.selector);
        t.payFromModule(payee1, 1e6, REF);
        vm.prank(address(mod));
        vm.expectRevert(AskirawaTreasury.TreasuryPaused.selector);
        t.fundModule(1e6, REF);
        // pause check precedes the module check
        vm.prank(outsider);
        vm.expectRevert(AskirawaTreasury.TreasuryPaused.selector);
        t.payFromModule(payee1, 1e6, REF);
        assertEq(_spent(), 0);
    }
}
