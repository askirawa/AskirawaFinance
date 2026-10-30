// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";
import {V2ConfigurableModule, V2PlainContract} from "./mocks/V2ConfigurableModule.sol";
import {V2MockModule} from "./mocks/V2MockModule.sol";

/// @notice G-MOD 01 (ModuleConfig validation) and budget updates.
contract AskirawaTreasuryModTest is AskirawaTreasuryTestBase {
    function _cfgModule(address m, bool en, uint96 perTx, uint96 winMax, uint32 len) internal returns (uint256) {
        uint64 exp = _exp();
        vm.prank(approver1);
        return t.proposeModuleConfig(m, en, perTx, winMax, len, exp, MEMO);
    }

    function _expectInvalid(address m) internal {
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidModule.selector, m));
        t.proposeModuleConfig(m, true, PER_TX, WINDOW_MAX, WINDOW_LEN, exp, MEMO);
    }

    function _mk(bool erc165, bool module_, bool ffff, bool revSup, bool hog, bool revTre)
        internal returns (V2ConfigurableModule) {
        return new V2ConfigurableModule(address(t), erc165, module_, ffff, revSup, hog, revTre);
    }

    function _draw(uint256 amount) internal {
        vm.prank(address(mod));
        t.payFromModule(payee1, amount, bytes32(0));
    }

    function _spentAndStart() internal view returns (uint96 spent, uint64 start) {
        (,,,,, start, spent) = t.modules(address(mod));
    }

    // ------------------------------------------------------------ G-MOD-01 enable requires ERC-165 + code + treasury()
    function test_MOD01_ValidModuleEnablesAndEmitsExactEvent() public {
        uint256 id = _proposeModuleConfig(approver1, true);
        _reachQuorum(id);
        _warpToExecutable(id);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.ModuleConfigured(address(mod), true, address(mod).codehash, PER_TX, WINDOW_MAX, WINDOW_LEN);
        _exec(id);
        (bool en, bytes32 ch, uint96 ptx, uint96 wmax, uint32 wlen, uint64 wstart, uint96 spent) = t.modules(address(mod));
        assertTrue(en);
        assertEq(ch, address(mod).codehash);
        assertEq(ptx, PER_TX);
        assertEq(wmax, WINDOW_MAX);
        assertEq(wlen, WINDOW_LEN);
        assertEq(wstart, _now());
        assertEq(spent, 0);
    }

    function test_MOD01_ContractWithoutErc165Rejected() public {
        _expectInvalid(address(new V2PlainContract()));
    }

    function test_MOD01_ModuleWithoutErc165IdRejected() public {
        _expectInvalid(address(_mk(false, true, false, false, false, false)));
    }

    function test_MOD01_ModuleNotSupportingModuleInterfaceRejected() public {
        _expectInvalid(address(_mk(true, false, false, false, false, false)));
    }

    function test_MOD01_ModuleAnsweringTrueToFFFFFFFFRejected() public {
        _expectInvalid(address(_mk(true, true, true, false, false, false)));
    }

    function test_MOD01_RevertingSupportsInterfaceRejected() public {
        _expectInvalid(address(_mk(true, true, false, true, false, false)));
    }

    function test_MOD01_GasHoggingSupportsInterfaceRejectedWithinBoundedGas() public {
        V2ConfigurableModule hog = _mk(true, true, false, false, true, false);
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidModule.selector, address(hog)));
        t.proposeModuleConfig(address(hog), true, PER_TX, WINDOW_MAX, WINDOW_LEN, exp, MEMO);
    }

    function test_MOD01_RevertingTreasuryGetterRejected() public {
        _expectInvalid(address(_mk(true, true, false, false, false, true)));
    }

    function test_MOD01_WrongTreasuryRejected() public {
        V2MockModule wrong = new V2MockModule(makeAddr("otherCore"));
        _expectInvalid(address(wrong));
    }

    function test_MOD01_EoaRejectedWithNoCode() public {
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NoCode.selector, outsider));
        t.proposeModuleConfig(outsider, true, PER_TX, WINDOW_MAX, WINDOW_LEN, exp, MEMO);
    }

    function test_MOD01_ZeroAndTreasuryAddressRejected() public {
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(0)));
        t.proposeModuleConfig(address(0), true, PER_TX, WINDOW_MAX, WINDOW_LEN, exp, MEMO);
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(t)));
        t.proposeModuleConfig(address(t), true, PER_TX, WINDOW_MAX, WINDOW_LEN, exp, MEMO);
    }

    function test_MOD01_BrokenModuleCanStillBeDisabledButNotEnabled() public {
        V2PlainContract plain = new V2PlainContract();
        uint256 id = _cfgModule(address(plain), false, PER_TX, WINDOW_MAX, WINDOW_LEN); // disable path: no ERC-165 needed
        _pass(id);
        (bool en,,,,,,) = t.modules(address(plain));
        assertFalse(en);
    }

    function test_MOD01_ValidationRerunsAtExecution() public {
        uint256 id = _proposeModuleConfig(approver1, true);
        _reachQuorum(id);
        _warpToExecutable(id);
        // the module's code is swapped for a contract without ERC-165 before execution
        vm.etch(address(mod), address(new V2PlainContract()).code);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidModule.selector, address(mod)));
        t.execute(id);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
    }

    function test_MOD01_NonProposerCannotProposeModuleConfig() public {
        uint64 exp = _exp();
        address m = address(mod);
        vm.prank(outsider);
        vm.expectRevert(AskirawaTreasury.NotProposer.selector);
        t.proposeModuleConfig(m, true, PER_TX, WINDOW_MAX, WINDOW_LEN, exp, MEMO);
    }

    // ------------------------------------------------------------ budget validation
    function test_MOD01_BudgetValidation() public {
        uint64 exp = _exp();
        address m = address(mod);
        vm.startPrank(approver1);
        vm.expectRevert(AskirawaTreasury.InvalidBudget.selector);
        t.proposeModuleConfig(m, true, 0, WINDOW_MAX, WINDOW_LEN, exp, MEMO); // perTx 0
        vm.expectRevert(AskirawaTreasury.InvalidBudget.selector);
        t.proposeModuleConfig(m, true, WINDOW_MAX + 1, WINDOW_MAX, WINDOW_LEN, exp, MEMO); // perTx > window
        vm.expectRevert(AskirawaTreasury.InvalidBudget.selector);
        t.proposeModuleConfig(m, true, PER_TX, WINDOW_MAX, 0, exp, MEMO); // window length 0
        vm.expectRevert(AskirawaTreasury.InvalidBudget.selector);
        t.proposeModuleConfig(m, true, PER_TX, WINDOW_MAX, 365 days + 1, exp, MEMO); // too long
        vm.expectRevert(AskirawaTreasury.InvalidBudget.selector);
        t.proposeModuleConfig(m, false, 0, 0, 0, exp, MEMO); // also invalid when disabling
        // boundaries accepted
        t.proposeModuleConfig(m, true, WINDOW_MAX, WINDOW_MAX, 365 days, exp, MEMO);
        t.proposeModuleConfig(m, true, 1, 1, 1, exp, MEMO);
        vm.stopPrank();
    }

    function testFuzz_MOD01_BudgetShapeAcceptedIffValid(uint96 ptx, uint96 wmax, uint32 wlen) public {
        uint64 exp = _exp();
        address m = address(mod);
        bool valid = ptx != 0 && ptx <= wmax && wlen != 0 && wlen <= 365 days;
        vm.prank(approver1);
        if (!valid) vm.expectRevert(AskirawaTreasury.InvalidBudget.selector);
        t.proposeModuleConfig(m, true, ptx, wmax, wlen, exp, MEMO);
    }

    // ------------------------------------------------------------ budget updates preserve spend
    function test_MOD02_UpdatePreservesWindowSpendAndStart() public {
        _enableModule();
        _draw(800e6);
        (uint96 spent0, uint64 start0) = _spentAndStart();
        skip(1 days);
        uint256 id = _cfgModule(address(mod), true, 500e6, 2_000e6, WINDOW_LEN);
        _pass(id);
        (uint96 spent1, uint64 start1) = _spentAndStart();
        assertEq(spent1, spent0, "spend retained");
        assertEq(start1, start0, "window start retained (no free fresh window)");
        assertEq(t.moduleSpendRemaining(address(mod)), 2_000e6 - 800e6);
        // new per-tx cap is live immediately
        vm.prank(address(mod));
        vm.expectRevert(AskirawaTreasury.BudgetExceeded.selector);
        t.payFromModule(payee1, 500e6 + 1, bytes32(0));
    }

    function test_MOD02_CannotLowerWindowMaxBelowRetainedSpend() public {
        _enableModule();
        _draw(800e6);
        uint256 id = _cfgModule(address(mod), true, 100e6, 799e6, WINDOW_LEN);
        _reachQuorum(id);
        _warpToExecutable(id);
        vm.expectRevert(AskirawaTreasury.BudgetExceeded.selector);
        t.execute(id);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
        (,, uint96 ptx, uint96 wmax,,,) = t.modules(address(mod));
        assertEq(ptx, PER_TX);
        assertEq(wmax, WINDOW_MAX);
    }

    function test_MOD02_WindowMaxEqualToRetainedSpendIsAllowedAndExhaustsBudget() public {
        _enableModule();
        _draw(800e6);
        _pass(_cfgModule(address(mod), true, 100e6, 800e6, WINDOW_LEN));
        assertEq(t.moduleSpendRemaining(address(mod)), 0);
        vm.prank(address(mod));
        vm.expectRevert(AskirawaTreasury.BudgetExceeded.selector);
        t.payFromModule(payee1, 1, bytes32(0));
    }

    function test_MOD02_UpdateAfterWindowExpiryRollsUnderOldDuration() public {
        _enableModule();
        _draw(800e6);
        (, uint64 start0) = _spentAndStart();
        // propose first, then jump beyond the end of the window before executing the update
        uint256 id = _cfgModule(address(mod), true, 500e6, 900e6, WINDOW_LEN);
        _reachQuorum(id);
        vm.warp(uint256(start0) + WINDOW_LEN + 1);
        _exec(id);
        (uint96 spent, uint64 start) = _spentAndStart();
        assertEq(spent, 0, "expired window rolled before applying limits (so 900 < 800 check passes trivially)");
        assertEq(start, _now());
    }

    function test_MOD02_DisableThenReenableRetainsUsage() public {
        _enableModule();
        _draw(800e6);
        _pass(_cfgModule(address(mod), false, PER_TX, WINDOW_MAX, WINDOW_LEN));
        assertEq(t.moduleSpendRemaining(address(mod)), 0, "disabled reports zero");
        _pass(_cfgModule(address(mod), true, PER_TX, WINDOW_MAX, WINDOW_LEN));
        (uint96 spent,) = _spentAndStart();
        assertEq(spent, 800e6);
        assertEq(t.moduleSpendRemaining(address(mod)), WINDOW_MAX - 800e6);
    }

    function test_MOD02_ReenableRepinsCurrentCodehash() public {
        _enableModule();
        _pass(_cfgModule(address(mod), false, PER_TX, WINDOW_MAX, WINDOW_LEN));
        // a different valid module implementation at the same address, enabled afresh, is accepted and re-pinned
        V2MockModule fresh = new V2MockModule(address(t));
        bytes memory code = address(fresh).code;
        vm.etch(address(mod), code);
        _pass(_cfgModule(address(mod), true, PER_TX, WINDOW_MAX, WINDOW_LEN));
        (, bytes32 ch,,,,,) = t.modules(address(mod));
        assertEq(ch, address(mod).codehash);
    }

    // ------------------------------------------------------------ moduleSpendRemaining
    function test_MOD_SpendRemainingCorrectness() public {
        assertEq(t.moduleSpendRemaining(address(mod)), 0, "unregistered");
        assertEq(t.moduleSpendRemaining(outsider), 0, "eoa");
        _enableModule();
        assertEq(t.moduleSpendRemaining(address(mod)), WINDOW_MAX);
        _draw(PER_TX);
        assertEq(t.moduleSpendRemaining(address(mod)), WINDOW_MAX - PER_TX);
        _pause();
        assertEq(t.moduleSpendRemaining(address(mod)), WINDOW_MAX - PER_TX, "pause does not alter reported budget");
        (, uint64 start) = _spentAndStart();
        vm.warp(uint256(start) + WINDOW_LEN - 1);
        assertEq(t.moduleSpendRemaining(address(mod)), WINDOW_MAX - PER_TX);
        vm.warp(uint256(start) + WINDOW_LEN);
        assertEq(t.moduleSpendRemaining(address(mod)), WINDOW_MAX, "rolled over at the exact boundary second");
        (uint96 spent,) = _spentAndStart();
        assertEq(spent, PER_TX, "view does not mutate storage");
    }

    function test_MOD_SpendRemainingZeroForCodeChange() public {
        _enableModule();
        vm.etch(address(mod), address(new V2PlainContract()).code);
        assertEq(t.moduleSpendRemaining(address(mod)), 0);
        vm.etch(address(mod), hex"");
        assertEq(t.moduleSpendRemaining(address(mod)), 0, "no code");
    }
}
