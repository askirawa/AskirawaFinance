// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {RpmP2Base} from "./RecurringPaymentModule.P2Base.t.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {IRecurringPaymentModule as IRPM} from "../../v2/interfaces/IRecurringPaymentModule.sol";
import {V2MockUSDC} from "./mocks/V2MockUSDC.sol";

/// @notice Action 3 (ACTION_RECOVER_FUNDS): quorum-only return of the module's whole USDC balance to the bound
/// treasury. Funds get into the module only through a prefunded ModuleAction (budget-consuming) or a donation.
contract RecurringPaymentModuleRecoverTest is RpmP2Base {
    uint8 internal constant RECOVER = 3;
    uint96 internal constant FUND = 300e6;

    // ------------------------------------------------------------ helpers
    function _createFunded(IRPM.ScheduleParams memory p, uint96 funding) internal returns (uint256 sid) {
        uint64 exp = _exp();
        vm.prank(approver1);
        uint256 pid = t.proposeModuleAction(address(rpm), CREATE, abi.encode(p), funding, exp, MEMO);
        _pass(pid);
        sid = rpm.scheduleCount();
    }

    function _proposeRecover(uint96 funding) internal returns (uint256 pid) {
        uint64 exp = _exp();
        vm.prank(approver1);
        pid = t.proposeModuleAction(address(rpm), RECOVER, "", funding, exp, MEMO);
    }

    /// @dev Full quorum recovery asserting the USDC transfer and FundsReturned(pid, amount) exactly.
    function _recover() internal returns (uint256 pid, uint256 amount) {
        pid = _proposeRecover(0);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        amount = usdc.balanceOf(address(rpm));
        vm.expectEmit(true, true, false, true, address(usdc));
        emit V2MockUSDC.Transfer(address(rpm), address(t), amount);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.FundsReturned(pid, amount);
        _exec(pid);
    }

    function _bystanders() internal view returns (address[12] memory a) {
        a = [approver1, approver2, approver3, proposerOnly, guardian, outsider, payee1, payee2, rescueTo, keeper,
            payeeA, sink];
    }

    function _bystanderTotal() internal view returns (uint256 total) {
        address[12] memory a = _bystanders();
        for (uint256 i; i < a.length; ++i) total += usdc.balanceOf(a[i]);
    }

    function _funded() internal returns (uint256 sid) {
        IRPM.ScheduleParams memory p = _p(payee1, AMOUNT, DAILY, _execTs() + 30 days);
        p.executor = keeper;
        sid = _createFunded(p, FUND);
    }

    // ------------------------------------------------------------ prefunding lands USDC in the module
    function test_Recover_PrefundedCreateConsumesBudgetAndLeavesUsdcInTheModule() public {
        uint256 treasuryBefore = t.balance();
        assertEq(_windowSpent(), 0);
        uint256 sid = _funded();
        assertEq(sid, 1, "the schedule was created by the same proposal");
        assertEq(usdc.balanceOf(address(rpm)), FUND, "funding sits in the module");
        assertEq(t.balance(), treasuryBefore - FUND);
        assertEq(_windowSpent(), FUND, "prefunding consumed core budget");
        assertEq(uint8(_st(sid)), uint8(IRPM.ScheduleStatus.Active));
    }

    // ------------------------------------------------------------ recovery happy paths
    function test_Recover_QuorumProposalReturnsTheWholeBalanceToTheTreasury() public {
        uint256 treasuryBefore = t.balance();
        uint256 bystanders = _bystanderTotal();
        _funded();
        assertEq(t.balance(), treasuryBefore - FUND);
        (, uint256 amount) = _recover();
        assertEq(amount, FUND);
        assertEq(usdc.balanceOf(address(rpm)), 0, "module emptied");
        assertEq(t.balance(), treasuryBefore, "treasury has every unit back");
        assertEq(_bystanderTotal(), bystanders, "nobody else received anything");
    }

    function test_Recover_PlainDonationIsRecoveredToo_WithoutTouchingBudget() public {
        usdc.mint(address(rpm), 77e6); // anyone can send tokens to the module
        uint256 treasuryBefore = t.balance();
        uint96 spent = _windowSpent();
        (, uint256 amount) = _recover();
        assertEq(amount, 77e6);
        assertEq(usdc.balanceOf(address(rpm)), 0);
        assertEq(t.balance(), treasuryBefore + 77e6);
        assertEq(_windowSpent(), spent, "recovery is not a budgeted draw");
    }

    function test_Recover_PrefundPlusDonationAreReturnedTogether() public {
        _funded();
        usdc.mint(address(rpm), 5e6);
        uint256 treasuryBefore = t.balance();
        (, uint256 amount) = _recover();
        assertEq(amount, FUND + 5e6);
        assertEq(t.balance(), treasuryBefore + FUND + 5e6);
        assertEq(usdc.balanceOf(address(rpm)), 0);
    }

    function test_Recover_ZeroBalanceRevertsNothingToRecover_AlsoRightAfterARecovery() public {
        uint256 pid = _proposeRecover(0);
        _expectCallbackRevert(pid, abi.encodeWithSelector(IRPM.NothingToRecover.selector));
        _funded();
        _recover();
        pid = _proposeRecover(0);
        _expectCallbackRevert(pid, abi.encodeWithSelector(IRPM.NothingToRecover.selector));
        assertEq(usdc.balanceOf(address(rpm)), 0);
    }

    function test_Recover_ProposalCarryingItsOwnFundingReturnsThatFundingAndBurnsBudget() public {
        uint256 treasuryBefore = t.balance();
        uint256 pid = _proposeRecover(200e6);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.FundsReturned(pid, 200e6);
        _exec(pid);
        assertEq(usdc.balanceOf(address(rpm)), 0);
        assertEq(t.balance(), treasuryBefore, "funded then returned within one proposal");
        assertEq(_windowSpent(), 200e6, "the budget used by the funding is gone for this window");
    }

    function test_Recover_RecoveryDoesNotTouchSchedulesAndTheyKeepPaying() public {
        uint256 sid = _funded();
        bytes32 d = _digest(sid);
        _recover();
        assertEq(_digest(sid), d, "schedule state untouched by recovery");
        vm.warp(_s(sid).nextDue);
        assertEq(_payOnce(sid, keeper), 0);
    }

    // ------------------------------------------------------------ recovered funds go ONLY to the treasury
    function test_Recover_EveryUsdcTransferInTheExecutionIsModuleToTreasury() public {
        _funded();
        usdc.mint(address(rpm), 1e6);
        uint256 pid = _proposeRecover(0);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        vm.recordLogs();
        _exec(pid);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 transfers;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(usdc)) continue;
            assertEq(logs[i].topics[0], V2MockUSDC.Transfer.selector, "only Transfer events");
            ++transfers;
            assertEq(address(uint160(uint256(logs[i].topics[1]))), address(rpm), "from the module");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), address(t), "to the treasury only");
            assertEq(abi.decode(logs[i].data, (uint256)), FUND + 1e6);
        }
        assertEq(transfers, 1, "a single transfer");
    }

    function test_Recover_BlockedTreasuryTokenTransferRevertsWholeProposalAndFundsStayRecoverable() public {
        _funded();
        uint256 pid = _proposeRecover(0);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        usdc.setBlocked(address(t), true);
        vm.expectRevert();
        _exec(pid);
        assertEq(usdc.balanceOf(address(rpm)), FUND, "nothing moved");
        usdc.setBlocked(address(t), false);
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.FundsReturned(pid, FUND);
        _exec(pid); // the same proposal is still executable
        assertEq(usdc.balanceOf(address(rpm)), 0);
    }

    function test_Recover_RequiresTheModuleToBeEnabledInTheCore() public {
        _funded();
        _configureRpm(false, RPM_PER_TX, RPM_WINDOW_MAX, RPM_WINDOW_LEN);
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, address(rpm)));
        t.proposeModuleAction(address(rpm), RECOVER, "", 0, exp, MEMO);
        assertEq(usdc.balanceOf(address(rpm)), FUND, "stuck until the module is re-enabled");
        _configureRpm(true, RPM_PER_TX, RPM_WINDOW_MAX, RPM_WINDOW_LEN);
        (, uint256 amount) = _recover();
        assertEq(amount, FUND);
    }

    // ------------------------------------------------------------ budget is NOT restored (documented)
    function test_Recover_WindowSpendIsNotRestored_SoPrefundingReducesWhatSchedulesCanDrawThisWindow() public {
        _configureRpm(true, FUND, 4 * AMOUNT, 7 days); // window cap 400e6
        uint256 sid = _createFunded(_p(payee1, AMOUNT, DAILY, _execTs()), FUND);
        assertEq(_windowSpent(), FUND);
        _recover();
        assertEq(usdc.balanceOf(address(rpm)), 0);
        assertEq(_windowSpent(), FUND, "documented: recovery does not refund budget usage");
        // headroom is only 100e6: one payment fits, the next one is a BUDGET soft failure in this window
        assertEq(_payOnce(sid, outsider), 0);
        assertEq(_windowSpent(), 4 * AMOUNT);
        assertEq(_s(sid).nextDue, _dueOf(sid, 1));
        assertLe(_s(sid).nextDue, _now(), "period 1 is due");
        _failOnce(sid, outsider, R_BUDGET);
    }

    // ------------------------------------------------------------ schedule execution never uses module funds
    function test_Recover_ExecutionPaysFromTheTreasuryAndNeverFromTheModuleBalance() public {
        uint256 sid = _funded();
        vm.warp(_s(sid).nextDue);
        PaySnap memory k = _snap(sid);
        _expectPaid(sid, k.period, k.s.nextDue, keeper, k.s.totalPaid + k.s.amount);
        _run(sid, keeper);
        assertEq(k.period, 0);
        assertEq(usdc.balanceOf(payee1), k.payeeBal + AMOUNT, "recipient paid");
        assertEq(t.balance(), k.coreBal - AMOUNT, "treasury paid");
        assertEq(usdc.balanceOf(address(rpm)), FUND, "module balance unchanged");
        assertEq(_s(sid).executedCount, 1);
    }

    function test_Recover_CorePauseBlocksRecoveryUntilUnpaused() public {
        _funded();
        uint256 pid = _proposeRecover(0);
        _reachQuorum(pid);
        _warpToExecutable(pid);
        _pause();
        vm.expectRevert(AskirawaTreasury.TreasuryPaused.selector);
        _exec(pid);
        assertEq(usdc.balanceOf(address(rpm)), FUND, "funds stay put while the core is paused");
        _unpausePass();
        vm.expectEmit(true, false, false, true, address(rpm));
        emit IRPM.FundsReturned(pid, FUND);
        _exec(pid);
        assertEq(usdc.balanceOf(address(rpm)), 0);
    }

    function test_Recover_EmptyTreasuryMakesExecutionSoftFailEvenWhenTheModuleHoldsFunds() public {
        uint256 sid = _funded();
        vm.warp(_s(sid).nextDue);
        _drain();
        _failOnce(sid, keeper, R_INSUFFICIENT);
        assertEq(usdc.balanceOf(address(rpm)), FUND, "module funds are not a fallback source");
        assertEq(usdc.balanceOf(payee1), 0);
    }

    // ------------------------------------------------------------ nothing but action 3 can move module funds
    function test_Recover_OnlyTheCoreMayCallOnApproved() public {
        _funded();
        address[10] memory callers = [keeper, approver1, approver2, approver3, guardian, outsider, payee1,
            proposerOnly, address(rpm), address(usdc)];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(IRPM.OnlyTreasury.selector);
            rpm.onApproved(1, RECOVER, "");
        }
        assertEq(usdc.balanceOf(address(rpm)), FUND);
    }

    function test_Recover_UnderQuorumOrBeforeDelayTheProposalCannotExecute() public {
        _funded();
        uint256 pid = _proposeRecover(0);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.QuorumNotReached.selector, pid, uint16(1), uint8(2)));
        _exec(pid);
        _approve(pid, approver2);
        AskirawaTreasury.Proposal memory pr = t.getProposal(pid);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.DelayNotElapsed.selector, pr.executableAt));
        _exec(pid);
        assertEq(usdc.balanceOf(address(rpm)), FUND);
    }

    function test_Recover_NoRoleCanMoveModuleFundsThroughAnyStateChangingEntryPoint() public {
        uint256 sid = _funded();
        uint256 treasuryBefore = t.balance();
        uint256 bystanders = _bystanderTotal();
        address[9] memory callers = [keeper, approver1, approver2, approver3, guardian, outsider, payee1,
            proposerOnly, address(0xdead)];
        for (uint256 i; i < callers.length; ++i) {
            bytes[6] memory calls = [
                abi.encodeCall(rpm.execute, (sid)),
                abi.encodeCall(rpm.pause, (sid)),
                abi.encodeCall(rpm.cancel, (sid)),
                abi.encodeCall(rpm.onApproved, (99, RECOVER, bytes(""))),
                abi.encodeCall(rpm.onApproved, (99, CREATE, abi.encode(_p(payee2, AMOUNT, DAILY, 0)))),
                abi.encodeCall(rpm.onApproved, (99, RESUME, abi.encode(sid, true)))
            ];
            for (uint256 j; j < calls.length; ++j) {
                vm.prank(callers[i]);
                (bool ok,) = address(rpm).call(calls[j]);
                if (j >= 3) assertFalse(ok, "onApproved rejects every non-core caller");
                assertEq(usdc.balanceOf(address(rpm)), FUND, "module balance unchanged");
            }
        }
        assertEq(t.balance(), treasuryBefore, "treasury unchanged");
        assertEq(_bystanderTotal(), bystanders, "no account gained funds");
    }

    function testFuzz_Recover_ArbitraryCallsFromAnyoneButTheCoreNeverMoveFunds(address caller, bytes calldata data)
        public
    {
        vm.assume(caller != address(t));
        assumeNotForgeAddress(caller);
        _funded();
        uint256 treasuryBefore = t.balance();
        vm.prank(caller);
        address(rpm).call(data);
        assertEq(usdc.balanceOf(address(rpm)), FUND);
        assertEq(t.balance(), treasuryBefore);
    }

    /// @dev ABI scan on the deployed bytecode: the dispatcher routes exactly the documented 22 functions. Of those,
    /// only onApproved / pause / cancel / execute are state-changing (the other 18 are constants, immutables,
    /// mapping getters and views), and none of them is an ERC-20 style withdrawal.
    function test_Recover_AbiScanShowsNoFunctionBesidesTheDocumentedOnes() public {
        bytes4[] memory pushed = _push4s(address(rpm).code);
        bytes4[] memory fns = _expectedFunctions();
        bytes4[] memory known = _knownNonFunctions();
        assertEq(fns.length, 22);
        for (uint256 i; i < fns.length; ++i) assertTrue(_contains(pushed, fns[i]), "documented selector present");
        for (uint256 i; i < pushed.length; ++i) {
            bytes4 x = pushed[i];
            if (x == bytes4(0xffffffff) || x == bytes4(0) || _contains(known, x)) continue;
            assertTrue(_contains(fns, x), "routable selector is documented");
        }
        string[8] memory withdrawals = [
            "transfer(address,uint256)", "transferFrom(address,address,uint256)", "approve(address,uint256)",
            "withdraw(uint256)", "withdraw(address,uint256)", "sweep(address)", "rescue(address,uint256)",
            "recoverFunds(address)"
        ];
        for (uint256 i; i < withdrawals.length; ++i) {
            bytes4 sel = bytes4(keccak256(bytes(withdrawals[i])));
            assertFalse(_contains(fns, sel), withdrawals[i]);
            (bool ok, bytes memory ret) = address(rpm).call(abi.encodePacked(sel, new bytes(96)));
            assertFalse(ok, withdrawals[i]);
            assertEq(ret.length, 0, "unknown selector: no fallback");
        }
    }
}
