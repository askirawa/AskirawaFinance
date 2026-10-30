// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryPayBase} from "./AskirawaTreasury.PayBase.t.sol";
import {V2FeeToken} from "./mocks/V2FeeToken.sol";

/// @notice G-PAY 07, 08, 10, 11, 12 plus competing proposals, deposit and gas.
contract AskirawaTreasuryPayExecTest is AskirawaTreasuryPayBase {
    // ------------------------------------------------------------ G-PAY-07 one bad recipient reverts everything
    function _assertAllUntouched(AskirawaTreasury.Payment[] memory items, uint256 id, uint256 treasuryBal) internal view {
        for (uint256 i; i < items.length; ++i) assertEq(usdc.balanceOf(items[i].to), 0, "recipient unchanged");
        assertEq(usdc.balanceOf(address(t)), treasuryBal, "treasury unchanged");
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executable));
    }

    function testFuzz_PAY07_AnyFailingIndexRevertsWholeBatchThenSucceedsAfterUnblock(uint8 nRaw, uint8 idxRaw) public {
        uint256 n = bound(nRaw, 1, 30);
        uint256 bad = bound(idxRaw, 0, n - 1);
        AskirawaTreasury.Payment[] memory items = _batch(n, 3e6);
        uint256 id = _ready(items);
        usdc.setBlocked(items[bad].to, true);
        vm.expectRevert(bytes("blocked"));
        t.execute(id);
        _assertAllUntouched(items, id, TREASURY_FUNDS);
        usdc.setBlocked(items[bad].to, false);
        t.execute(id);
        for (uint256 i; i < n; ++i) assertEq(usdc.balanceOf(items[i].to), 3e6);
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS - 3e6 * n);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Executed));
    }

    function test_PAY07_EveryIndexOfFiveBlocksEverything() public {
        AskirawaTreasury.Payment[] memory items = _batch(5, 2e6);
        uint256 id = _ready(items);
        for (uint256 bad; bad < 5; ++bad) {
            usdc.setBlocked(items[bad].to, true);
            vm.expectRevert(bytes("blocked"));
            t.execute(id);
            _assertAllUntouched(items, id, TREASURY_FUNDS);
            usdc.setBlocked(items[bad].to, false);
        }
        t.execute(id);
        assertEq(usdc.balanceOf(items[4].to), 2e6);
    }

    function test_PAY07_FailedExecutionKeepsVotesAndTimesAndAllowsCancel() public {
        AskirawaTreasury.Payment[] memory items = _batch(4, 1e6);
        uint256 id = _ready(items);
        AskirawaTreasury.Proposal memory before_ = t.getProposal(id);
        usdc.setBlocked(items[3].to, true);
        (bool ok,) = address(t).call(abi.encodeCall(AskirawaTreasury.execute, (id)));
        assertFalse(ok);
        AskirawaTreasury.Proposal memory after_ = t.getProposal(id);
        assertEq(after_.approvals, before_.approvals);
        assertEq(after_.executableAt, before_.executableAt);
        assertEq(after_.expiresAt, before_.expiresAt);
        // the remedy is cancel and re-propose without the bad recipient
        vm.prank(approver1);
        t.cancel(id);
        assertEq(uint8(_status(id)), uint8(AskirawaTreasury.ProposalStatus.Cancelled));
    }

    function test_PAY07_GlobalTokenPauseAlsoRevertsAtomically() public {
        AskirawaTreasury.Payment[] memory items = _batch(3, 1e6);
        uint256 id = _ready(items);
        usdc.setGlobalPause(true);
        vm.expectRevert(bytes("paused"));
        t.execute(id);
        _assertAllUntouched(items, id, TREASURY_FUNDS);
        usdc.setGlobalPause(false);
        t.execute(id);
        assertEq(usdc.balanceOf(items[2].to), 1e6);
    }

    // ------------------------------------------------------------ G-PAY-08 insufficient balance
    function test_PAY08_InsufficientBalanceRevertsWithHaveAndNeed() public {
        AskirawaTreasury.Payment[] memory items = _pay(payee1, uint96(TREASURY_FUNDS + 1));
        uint256 id = _ready(items);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InsufficientBalance.selector, TREASURY_FUNDS, TREASURY_FUNDS + 1));
        t.execute(id);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
        assertEq(usdc.balanceOf(payee1), 0);
    }

    function test_PAY08_ExactBalanceSucceedsAndDrainsTreasury() public {
        uint256 id = _ready(_pay(payee1, uint96(TREASURY_FUNDS)));
        t.execute(id);
        assertEq(usdc.balanceOf(address(t)), 0);
        assertEq(usdc.balanceOf(payee1), TREASURY_FUNDS);
    }

    function testFuzz_PAY08_ShortfallAlwaysRevertsWithExactNumbers(uint64 shortRaw) public {
        uint96 short = uint96(bound(shortRaw, 1, 1e12));
        uint96 need = uint96(TREASURY_FUNDS) + short;
        uint256 id = _ready(_pay(payee1, need));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InsufficientBalance.selector, TREASURY_FUNDS, uint256(need)));
        t.execute(id);
        // top up exactly the shortfall -> executes
        _depositFrom(outsider, short);
        t.execute(id);
        assertEq(usdc.balanceOf(payee1), need);
    }

    function test_PAY08_ManySmallItemsStillCheckedAgainstSum() public {
        AskirawaTreasury.Payment[] memory items = _batch(10, uint96(TREASURY_FUNDS / 10));
        items[9].amount += 1; // sum = funds + 1
        uint256 id = _ready(items);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InsufficientBalance.selector, TREASURY_FUNDS, TREASURY_FUNDS + 1));
        t.execute(id);
        for (uint256 i; i < 10; ++i) assertEq(usdc.balanceOf(items[i].to), 0);
    }

    // ------------------------------------------------------------ competing approved proposals
    function test_PAY_TwoApprovedProposalsCompeteFirstWinsSecondSucceedsAfterDeposit() public {
        uint96 half = uint96(TREASURY_FUNDS * 6 / 10);
        uint256 a = _ready(_pay(payee1, half));
        uint256 b = _ready(_pay(payee2, half));
        _exec(b); // execution order, not proposal order, decides
        assertEq(usdc.balanceOf(payee2), half);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InsufficientBalance.selector, TREASURY_FUNDS - half, uint256(half)));
        t.execute(a);
        assertEq(uint8(_status(a)), uint8(AskirawaTreasury.ProposalStatus.Executable));
        assertEq(usdc.balanceOf(payee1), 0);
        _depositFrom(outsider, half); // balance is now 0.4 + 0.6 = 1.0 funds >= half
        t.execute(a);
        assertEq(usdc.balanceOf(payee1), half);
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS + half - 2 * uint256(half));
    }

    // ------------------------------------------------------------ G-PAY-10 execute twice
    function test_PAY10_ExecuteTwiceRevertsNotPending() public {
        uint256 id = _ready(_batch(3, 1e6));
        t.execute(id);
        uint256 bal = usdc.balanceOf(address(t));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NotPending.selector, id));
        t.execute(id);
        assertEq(usdc.balanceOf(address(t)), bal);
        assertEq(usdc.balanceOf(_acct(5000)), 1e6, "paid once");
    }

    function test_PAY10_ExecuteNonexistentReverts() public {
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.NotPending.selector, 77));
        t.execute(77);
    }

    // ------------------------------------------------------------ G-PAY-11 balance delta equals total
    function testFuzz_PAY11_TreasuryDeltaEqualsTotalAndRecipientsGetExactly(uint8 nRaw, uint64 seed) public {
        uint256 n = bound(nRaw, 1, 40);
        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](n);
        for (uint256 i; i < n; ++i) {
            items[i] = AskirawaTreasury.Payment(_acct(300 + i), uint96(bound(uint256(keccak256(abi.encode(seed, i))), 1, 1e10)));
        }
        uint256 id = _ready(items);
        uint256 beforeBal = usdc.balanceOf(address(t));
        uint256 supply = usdc.totalSupply();
        _exec(id);
        assertEq(beforeBal - usdc.balanceOf(address(t)), t.getProposal(id).totalAmount);
        assertEq(beforeBal - usdc.balanceOf(address(t)), _sum(items));
        uint256 got;
        for (uint256 i; i < n; ++i) got += usdc.balanceOf(items[i].to);
        assertEq(got, _sum(items));
        assertEq(usdc.totalSupply(), supply);
    }

    function test_PAY11_PaymentSentEventsAndExecutedEventExact() public {
        AskirawaTreasury.Payment[] memory items = _batch(3, 5e6);
        uint256 id = _ready(items);
        for (uint256 i; i < 3; ++i) {
            vm.expectEmit(true, true, true, true, address(t));
            emit AskirawaTreasury.PaymentSent(id, i, items[i].to, 5e6);
        }
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.Executed(id, AskirawaTreasury.Action.Payroll, 15e6);
        _exec(id);
    }

    // ------------------------------------------------------------ G-PAY-12 no partial path
    function test_PAY12_NoPartialSkipOrAtomicStyleEntryPointExists() public {
        string[18] memory sigs = [
            "skip(uint256)", "skip(uint256,uint256)", "skipRecipient(uint256,uint256)", "skipFailed(uint256)",
            "executePartial(uint256)", "executePartial(uint256,uint256)", "partialExecute(uint256)",
            "executeSkipping(uint256,uint256[])", "executeBatch(uint256,uint256,uint256)", "executeRange(uint256,uint256,uint256)",
            "executeBestEffort(uint256)", "executeAtomic(uint256)", "executeNonAtomic(uint256)", "setAtomic(bool)",
            "atomic()", "partial()", "allowPartial()", "execute(uint256,bool)"
        ];
        for (uint256 i; i < sigs.length; ++i) {
            (bool ok,) = address(t).call(abi.encodeWithSignature(sigs[i], uint256(1), uint256(0), uint256(0)));
            assertFalse(ok, sigs[i]);
        }
        // control: the one real entry point answers
        (bool ok2,) = address(t).call(abi.encodeWithSignature("MAX_PAYMENTS()"));
        assertTrue(ok2);
    }

    /// @dev Real ABI scan: reads the compiled ABI and checks every function AND event name. The previous version only
    /// asserted two enum constants, which proved nothing about the entry points.
    /// forge-config: default.fs_permissions = [{ access = "read", path = "contracts/out" }]
    function test_PAY12_NoAbiFunctionOrEventNamedSkipPartialAtomicOrForce() public view {
        string memory json = vm.readFile("contracts/out/AskirawaTreasury.sol/AskirawaTreasury.json");
        uint256 fnCount;
        uint256 evCount;
        bool sawExecute;
        bool sawPayFromModule;
        for (uint256 i;; ++i) {
            string memory item = string.concat(".abi[", vm.toString(i), "]");
            if (!vm.keyExists(json, item)) break;
            string memory kind = vm.parseJsonString(json, string.concat(item, ".type"));
            bool isFn = keccak256(bytes(kind)) == keccak256("function");
            bool isEv = keccak256(bytes(kind)) == keccak256("event");
            if (!isFn && !isEv) continue;
            string memory name = vm.parseJsonString(json, string.concat(item, ".name"));
            if (isFn) {
                ++fnCount;
                if (keccak256(bytes(name)) == keccak256("execute")) sawExecute = true;
                if (keccak256(bytes(name)) == keccak256("payFromModule")) sawPayFromModule = true;
            } else {
                ++evCount;
            }
            assertFalse(_hasPartialStyleWord(name), string.concat("forbidden ", kind, " name: ", name));
        }
        // the scan must actually be looking at the real ABI
        assertGt(fnCount, 25, "function entries scanned");
        assertGt(evCount, 10, "event entries scanned");
        assertTrue(sawExecute && sawPayFromModule, "control: real entry points are in the scan");
    }

    /// @dev Control for the scanner itself: it must flag the obvious spellings and accept the real names.
    function test_PAY12_PartialStyleScannerFlagsKnownBadNamesAndAcceptsGoodOnes() public pure {
        string[8] memory bad = ["skipRecipient", "executePartial", "PARTIALExecute", "setAtomic", "nonAtomicPay",
            "forceExecute", "executeForced", "PaymentSkipped"];
        for (uint256 i; i < bad.length; ++i) assertTrue(_hasPartialStyleWord(bad[i]), bad[i]);
        string[6] memory good = ["execute", "payFromModule", "proposePayroll", "approve", "PaymentSent", "Executed"];
        for (uint256 i; i < good.length; ++i) assertFalse(_hasPartialStyleWord(good[i]), good[i]);
    }

    function _hasPartialStyleWord(string memory name) internal pure returns (bool) {
        bytes memory n = bytes(vm.toLowercase(name));
        string[4] memory words = ["skip", "partial", "atomic", "force"];
        for (uint256 w; w < words.length; ++w) {
            bytes memory needle = bytes(words[w]);
            if (n.length < needle.length) continue;
            for (uint256 i; i + needle.length <= n.length; ++i) {
                bool hit = true;
                for (uint256 j; j < needle.length; ++j) {
                    if (n[i + j] != needle[j]) { hit = false; break; }
                }
                if (hit) return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------ deposit
    function test_DEP_PullsExactAmountAndEmits() public {
        usdc.mint(outsider, 500e6);
        vm.prank(outsider);
        usdc.approve(address(t), 300e6);
        vm.expectEmit(true, false, false, true, address(t));
        emit AskirawaTreasury.Deposited(outsider, 300e6);
        vm.prank(outsider);
        t.deposit(300e6);
        assertEq(usdc.balanceOf(outsider), 200e6);
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS + 300e6);
        assertEq(t.balance(), TREASURY_FUNDS + 300e6);
        assertEq(usdc.allowance(outsider, address(t)), 0);
    }

    function testFuzz_DEP_BalanceGrowsByExactAmount(uint96 amount) public {
        amount = uint96(bound(amount, 1, 1e15));
        _depositFrom(payee1, amount);
        assertEq(t.balance(), TREASURY_FUNDS + amount);
        assertEq(usdc.balanceOf(payee1), 0);
    }

    function test_DEP_ZeroReverts() public {
        vm.prank(outsider);
        vm.expectRevert(AskirawaTreasury.ZeroAmount.selector);
        t.deposit(0);
    }

    function test_DEP_WithoutAllowanceOrFundsReverts() public {
        vm.prank(outsider);
        vm.expectRevert(bytes("allowance"));
        t.deposit(1e6);
        vm.startPrank(outsider);
        usdc.approve(address(t), 1e6);
        vm.expectRevert(bytes("balance"));
        t.deposit(1e6);
        vm.stopPrank();
        assertEq(t.balance(), TREASURY_FUNDS);
    }

    function test_DEP_PlainTransferJustIncreasesBalance() public {
        usdc.mint(outsider, 9e6);
        vm.recordLogs();
        vm.prank(outsider);
        usdc.transfer(address(t), 9e6);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) assertTrue(logs[i].emitter != address(t), "treasury emits nothing");
        assertEq(t.balance(), TREASURY_FUNDS + 9e6);
        // and the added funds are spendable by a normal payroll
        uint256 id = _ready(_pay(payee1, uint96(TREASURY_FUNDS + 9e6)));
        t.execute(id);
        assertEq(usdc.balanceOf(payee1), TREASURY_FUNDS + 9e6);
    }

    function test_DEP_FeeOnTransferTokenInboundShortfallIsDetected() public {
        V2FeeToken fee = new V2FeeToken();
        t = _deployWith(address(fee));
        fee.mint(address(t), 1_000e6);
        fee.mint(outsider, 1_000e6);
        fee.setFees(100, 0); // recipient skims 1%
        vm.startPrank(outsider);
        fee.approve(address(t), 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.BalanceDeltaMismatch.selector, 1_000e6, 1_000e6 + 990e6, 1_000e6));
        t.deposit(1_000e6);
        vm.stopPrank();
        assertEq(fee.balanceOf(outsider), 1_000e6, "whole deposit rolled back");
        assertEq(fee.balanceOf(address(t)), 1_000e6);
        // control: with no fee the same deposit works
        fee.setFees(0, 0);
        vm.prank(outsider);
        t.deposit(1_000e6);
        assertEq(t.balance(), 2_000e6);
    }

    function test_DEP_FeeOnTransferTokenOutboundOverDebitRevertsPayroll() public {
        V2FeeToken fee = new V2FeeToken();
        t = _deployWith(address(fee));
        fee.mint(address(t), 10_000e6);
        fee.setFees(0, 100); // sender debited 1% extra
        uint256 id = _ready(_pay(payee1, 1_000e6));
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.BalanceDeltaMismatch.selector, 10_000e6, 10_000e6 - 1_010e6, 1_000e6));
        t.execute(id);
        assertEq(fee.balanceOf(payee1), 0);
        assertEq(fee.balanceOf(address(t)), 10_000e6);
        assertEq(uint8(t.getProposal(id).status), uint8(AskirawaTreasury.Status.Pending));
    }

    // ------------------------------------------------------------ gas
    function _gasFor(uint256 n) internal returns (uint256 proposeGas, uint256 execGas) {
        AskirawaTreasury.Payment[] memory items = _batch(n, 1e6);
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.startSnapshotGas("propose");
        uint256 id = t.proposePayroll(items, exp, MEMO);
        proposeGas = vm.stopSnapshotGas();
        _reachQuorum(id);
        _warpToExecutable(id);
        vm.prank(outsider);
        vm.startSnapshotGas("execute");
        t.execute(id);
        execGas = vm.stopSnapshotGas();
        assertEq(usdc.balanceOf(items[n - 1].to), 1e6);
    }

    function test_GAS_PayrollOf1() public {
        (uint256 p, uint256 e) = _gasFor(1);
        console2.log("GAS 1 recipient: propose", p);
        console2.log("GAS 1 recipient: execute", e);
    }

    function test_GAS_PayrollOf50() public {
        (uint256 p, uint256 e) = _gasFor(50);
        console2.log("GAS 50 recipients: propose", p);
        console2.log("GAS 50 recipients: execute", e);
    }

    function test_GAS_PayrollOf100WorksAndFitsBlock() public {
        (uint256 p, uint256 e) = _gasFor(100);
        console2.log("GAS 100 recipients: propose", p);
        console2.log("GAS 100 recipients: execute", e);
        assertLt(p, 30_000_000, "propose fits a block");
        assertLt(e, 30_000_000, "execute fits a block");
    }
}
