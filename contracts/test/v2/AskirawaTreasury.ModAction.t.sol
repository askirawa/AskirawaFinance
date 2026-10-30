// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";
import {V2MockModule} from "./mocks/V2MockModule.sol";
import {V2PlainContract} from "./mocks/V2ConfigurableModule.sol";

/// @notice G-MOD 05/07 and S-REENT-02 (module callback): ModuleAction execution and hostile modules.
contract AskirawaTreasuryModActionTest is AskirawaTreasuryTestBase {
    bytes4 internal constant REENT = 0x3ee5aeb5; // ReentrancyGuardReentrantCall()

    function setUp() public override {
        super.setUp();
        _enableModule();
    }

    function _spent() internal view returns (uint96 spent) { (,,,,,, spent) = t.modules(address(mod)); }

    function _readyAction(uint96 funding) internal returns (uint256 id) {
        id = _proposeModuleAction(approver1, funding);
        _reachQuorum(id);
        _warpToExecutable(id);
    }

    // ------------------------------------------------------------ happy path
    function test_MODACTION_FundsModuleThenCallsOnApprovedWithExactArguments() public {
        uint256 id = _readyAction(300e6);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.ModuleFunded(address(mod), 300e6, MEMO);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.Executed(id, AskirawaTreasury.Action.ModuleAction, 300e6);
        _exec(id);
        assertEq(usdc.balanceOf(address(mod)), 300e6);
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS - 300e6);
        assertEq(_spent(), 300e6, "prefunding consumes the module budget");
        assertEq(mod.callCount(), 1);
        V2MockModule.Call memory c = mod.callAt(0);
        assertEq(c.sender, address(t));
        assertEq(c.proposalId, id);
        assertEq(uint256(c.actionCode), 7);
        assertEq(c.data, hex"c0ffee");
    }

    function test_MODACTION_ZeroFundingStillCallsBack() public {
        uint256 id = _readyAction(0);
        _exec(id);
        assertEq(mod.callCount(), 1);
        assertEq(usdc.balanceOf(address(mod)), 0);
        assertEq(_spent(), 0);
        assertEq(mod.callAt(0).proposalId, id);
    }

    function test_MODACTION_PayloadStoredAndHashed() public {
        uint256 id = _proposeModuleAction(proposerOnly, 5e6);
        bytes memory expected = abi.encode(AskirawaTreasury.ModuleActionPayload(address(mod), 7, hex"c0ffee", 5e6));
        assertEq(t.getPayload(id), expected);
        assertEq(t.getProposal(id).payloadHash, keccak256(expected));
        assertEq(t.getProposal(id).totalAmount, 5e6);
    }

    function test_MODACTION_ProposeRejectsFundingAbovePerTxAndDisabledModule() public {
        uint64 exp = _exp();
        address m = address(mod);
        vm.prank(approver1);
        vm.expectRevert(AskirawaTreasury.BudgetExceeded.selector);
        t.proposeModuleAction(m, 1, hex"", PER_TX + 1, exp, MEMO);
        vm.prank(approver1);
        t.proposeModuleAction(m, 1, hex"", PER_TX, exp, MEMO);
        _pass(_proposeModuleConfig(approver1, false));
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, m));
        t.proposeModuleAction(m, 1, hex"", 0, exp, MEMO);
    }

    function test_MODACTION_ExecutionBudgetExhaustedByEarlierDrawsRevertsAndStaysPending() public {
        uint256 id = _readyAction(PER_TX);
        for (uint256 i; i < 5; ++i) {
            vm.prank(address(mod));
            t.payFromModule(payee1, PER_TX, bytes32(0));
        }
        vm.expectRevert(AskirawaTreasury.BudgetExceeded.selector);
        t.execute(id);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
        assertEq(mod.callCount(), 0);
        // a new window frees the budget and the same proposal can run
        (,,,,, uint64 start,) = t.modules(address(mod));
        vm.warp(uint256(start) + WINDOW_LEN);
        t.execute(id);
        assertEq(mod.callCount(), 1);
    }

    function test_MODACTION_ModuleDisabledOrCodeChangedAtExecutionReverts() public {
        uint256 id = _readyAction(10e6);
        uint256 z = _readyAction(0);
        vm.etch(address(mod), address(new V2PlainContract()).code);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCodeChanged.selector, address(mod)));
        t.execute(id);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
        // zero funding path is pinned too
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCodeChanged.selector, address(mod)));
        t.execute(z);
    }

    function test_MODACTION_ModuleDisabledAtExecutionRevertsModuleDisabled() public {
        uint256 id = _readyAction(10e6);
        _pass(_proposeModuleConfig(approver1, false));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleDisabled.selector, address(mod)));
        t.execute(id);
    }

    // ------------------------------------------------------------ callback failure bubbles
    function test_MODACTION_CallbackRevertBubblesAsModuleCallbackFailedAndChangesNothing() public {
        uint256 id = _readyAction(250e6);
        bytes memory reason = abi.encodeWithSignature("Error(string)", "module says no");
        mod.setRevert(true, reason);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCallbackFailed.selector, id, reason));
        t.execute(id);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executable));
        assertEq(usdc.balanceOf(address(mod)), 0, "prefunding rolled back");
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS);
        assertEq(_spent(), 0, "budget rolled back");
        assertEq(mod.callCount(), 0);
        // fix the module, the identical proposal then executes
        mod.setRevert(false, "");
        t.execute(id);
        assertEq(usdc.balanceOf(address(mod)), 250e6);
        assertEq(mod.callCount(), 1);
    }

    function test_MODACTION_EmptyRevertDataIsWrappedToo() public {
        uint256 id = _readyAction(0);
        mod.setRevert(true, "");
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCallbackFailed.selector, id, bytes("")));
        t.execute(id);
    }

    // ------------------------------------------------------------ hostile module re-entry (S-REENT-02)
    function _reenterCalls(uint256 victimId) internal view returns (bytes[10] memory c) {
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 1e6);
        uint64 exp = uint64(vm.getBlockTimestamp()) + 30 days;
        c[0] = abi.encodeCall(AskirawaTreasury.execute, (victimId));
        c[1] = abi.encodeCall(AskirawaTreasury.approve, (victimId));
        c[2] = abi.encodeCall(AskirawaTreasury.reject, (victimId));
        c[3] = abi.encodeCall(AskirawaTreasury.cancel, (victimId));
        c[4] = abi.encodeCall(AskirawaTreasury.proposePayroll, (items, exp, MEMO));
        c[5] = abi.encodeCall(AskirawaTreasury.proposeModuleConfig, (address(mod), true, PER_TX, WINDOW_MAX, WINDOW_LEN, exp, MEMO));
        c[6] = abi.encodeCall(AskirawaTreasury.proposeRescue, (address(other), rescueTo, 1e6, exp, MEMO));
        c[7] = abi.encodeCall(AskirawaTreasury.deposit, (1e6));
        c[8] = abi.encodeCall(AskirawaTreasury.payFromModule, (payee1, 1e6, MEMO));
        c[9] = abi.encodeCall(AskirawaTreasury.fundModule, (1e6, MEMO));
    }

    function test_SREENT02_EveryCoreEntryPointBlockedDuringOnApproved() public {
        uint256 victim = _proposePayroll(approver1, payee2, 40e6); // approved but we never execute it first
        _reachQuorum(victim);
        _warpToExecutable(victim);
        uint256 id = _readyAction(100e6);
        bytes[10] memory calls = _reenterCalls(victim);
        for (uint256 i; i < calls.length; ++i) {
            uint256 snap = vm.snapshotState();
            mod.setReenter(calls[i]);
            _exec(id);
            assertTrue(mod.reenterAttempted(), "attempted");
            assertFalse(mod.reenterSuccess(), "re-entry must fail");
            assertEq(bytes4(mod.reenterReturn()), REENT, "blocked by the shared lock");
            assertEq(usdc.balanceOf(payee2), 0, "victim payroll not paid via re-entry");
            assertEq(usdc.balanceOf(address(mod)), 100e6, "only the approved funding moved");
            assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS - 100e6);
            assertEq(mod.callCount(), 1);
            vm.revertToState(snap);
        }
    }

    function test_SREENT02_ReenteringTheSameProposalDoesNotDoubleFund() public {
        uint256 id = _readyAction(100e6);
        mod.setReenter(abi.encodeCall(AskirawaTreasury.execute, (id)));
        _exec(id);
        assertFalse(mod.reenterSuccess());
        assertEq(usdc.balanceOf(address(mod)), 100e6);
        assertEq(_spent(), 100e6);
        assertEq(mod.callCount(), 1);
    }

    function test_SREENT02_BubblingHostileModuleRollsEverythingBack() public {
        uint256 id = _readyAction(100e6);
        mod.setReenter(abi.encodeCall(AskirawaTreasury.execute, (id)));
        mod.setBubble(true);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCallbackFailed.selector, id, abi.encodePacked(REENT)));
        t.execute(id);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
        assertEq(usdc.balanceOf(address(mod)), 0);
        assertEq(_spent(), 0);
    }

    function test_SREENT02_CallbackPayAndFundAttemptsAreBlockedNoExtraFunds() public {
        uint256 id = _readyAction(100e6);
        mod.setPay(payee1, 500e6);
        mod.setFund(500e6);
        _exec(id);
        assertTrue(mod.payAttempted());
        assertFalse(mod.paySuccess(), "payFromModule inside onApproved is blocked");
        assertTrue(mod.fundAttempted());
        assertFalse(mod.fundSuccess(), "fundModule inside onApproved is blocked");
        assertEq(usdc.balanceOf(payee1), 0);
        assertEq(usdc.balanceOf(address(mod)), 100e6);
        assertEq(_spent(), 100e6);
    }

    function test_SREENT02_ModuleCannotCallOnApprovedExceptViaCoreExecution() public {
        // onApproved is an ordinary function on the module; the core only ever calls it from execute.
        // The core exposes no function that lets anyone trigger it without an approved proposal.
        (bool ok,) = address(t).call(abi.encodeWithSignature("callModule(address,uint8,bytes)", address(mod), uint8(7), hex"c0ffee"));
        assertFalse(ok);
        assertEq(mod.callCount(), 0);
    }

    // ------------------------------------------------------------ G-MOD-05 hostile module budget
    function testFuzz_MOD05_HostileModuleNeverExceedsWindowMaxAcrossManyCalls(uint256 seed) public {
        uint64 start;
        uint256 inWindow;
        (,,,,, start,) = t.modules(address(mod));
        for (uint256 i; i < 40; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            skip(bound(r, 0, 1 days));
            uint256 amt = bound(r >> 32, 1, uint256(PER_TX) + 5);
            vm.prank(address(mod));
            bool useFund = (r >> 100) & 1 == 1;
            (bool ok,) = address(t).call(useFund
                ? abi.encodeCall(AskirawaTreasury.fundModule, (amt, bytes32(0)))
                : abi.encodeCall(AskirawaTreasury.payFromModule, (payee1, amt, bytes32(0))));
            (,,,,, uint64 s2, uint96 spent) = t.modules(address(mod));
            if (s2 != start) { start = s2; inWindow = 0; }
            if (ok) inWindow += amt;
            assertEq(spent, inWindow, "ghost window accounting");
            assertLe(inWindow, WINDOW_MAX, "never above windowMax in a window");
            assertTrue(!ok || amt <= PER_TX);
        }
    }
}
