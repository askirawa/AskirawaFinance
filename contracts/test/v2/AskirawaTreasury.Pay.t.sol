// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryPayBase} from "./AskirawaTreasury.PayBase.t.sol";

/// @notice G-PAY 01-06 and 09: payroll storage, readability, hashing, events, validation and timing.
contract AskirawaTreasuryPayTest is AskirawaTreasuryPayBase {
    function _varied(uint256 n) internal pure returns (AskirawaTreasury.Payment[] memory items) {
        items = new AskirawaTreasury.Payment[](n);
        for (uint256 i; i < n; ++i) items[i] = AskirawaTreasury.Payment(_acct(5000 + i), uint96(1e6 * (i + 1) + i));
    }

    function _eq(AskirawaTreasury.Payment memory a, AskirawaTreasury.Payment memory b) internal {
        assertEq(a.to, b.to);
        assertEq(a.amount, b.amount);
    }

    // ------------------------------------------------------------ G-PAY-01 getPayroll
    function test_PAY01_GetPayrollReturnsEveryItemInOrder() public {
        AskirawaTreasury.Payment[] memory items = _varied(7);
        uint256 id = _propose(approver1, items);
        AskirawaTreasury.Payment[] memory got = t.getPayroll(id, 0, 100);
        assertEq(got.length, 7);
        for (uint256 i; i < 7; ++i) _eq(got[i], items[i]);
    }

    function test_PAY01_PagedReadsConcatenateToFullList() public {
        AskirawaTreasury.Payment[] memory items = _varied(7);
        uint256 id = _propose(approver1, items);
        uint256 k;
        for (uint256 off; off < 7; off += 3) {
            AskirawaTreasury.Payment[] memory page = t.getPayroll(id, off, 3);
            assertEq(page.length, off + 3 <= 7 ? 3 : 1);
            for (uint256 j; j < page.length; ++j) _eq(page[j], items[k++]);
        }
        assertEq(k, 7);
    }

    function test_PAY01_OffsetAndLimitEdgeCases() public {
        uint256 id = _propose(approver1, _varied(7));
        assertEq(t.getPayroll(id, 0, 0).length, 0, "limit 0");
        assertEq(t.getPayroll(id, 7, 5).length, 0, "offset == length");
        assertEq(t.getPayroll(id, 8, 5).length, 0, "offset > length");
        assertEq(t.getPayroll(id, type(uint256).max, 5).length, 0, "offset max");
        assertEq(t.getPayroll(id, 6, 5).length, 1, "last item only");
        assertEq(t.getPayroll(id, 0, type(uint256).max).length, 7, "limit max clamps without overflow");
        assertEq(t.getPayroll(id, 3, type(uint256).max).length, 4);
        assertEq(t.getPayroll(id, 0, 1).length, 1);
        assertEq(t.getPayroll(id, 0, 7).length, 7);
        assertEq(t.getPayroll(id, 0, 8).length, 7);
    }

    function test_PAY01_NonexistentAndNonPayrollIdsReturnEmpty() public {
        assertEq(t.getPayroll(0, 0, 10).length, 0);
        assertEq(t.getPayroll(999, 0, 10).length, 0);
        uint256 gov = _proposeGov(approver1, _cfg());
        assertEq(t.getPayroll(gov, 0, 10).length, 0);
    }

    function testFuzz_PAY01_AnyPageMatchesSlice(uint8 nRaw, uint8 offRaw, uint8 limRaw) public {
        uint256 n = bound(nRaw, 1, 100);
        AskirawaTreasury.Payment[] memory items = _varied(n);
        uint256 id = _propose(approver1, items);
        uint256 off = offRaw;
        uint256 lim = limRaw;
        AskirawaTreasury.Payment[] memory page = t.getPayroll(id, off, lim);
        uint256 expectLen = off >= n ? 0 : (n - off < lim ? n - off : lim);
        assertEq(page.length, expectLen);
        for (uint256 i; i < page.length; ++i) _eq(page[i], items[off + i]);
    }

    // ------------------------------------------------------------ G-PAY-02 totals
    function test_PAY02_TotalAmountEqualsSumOfItems() public {
        AskirawaTreasury.Payment[] memory items = _varied(10);
        uint256 id = _propose(approver1, items);
        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        assertEq(p.totalAmount, _sum(items));
        assertEq(uint8(p.action), uint8(AskirawaTreasury.Action.Payroll));
        // sum recomputed from the on-chain stored items
        AskirawaTreasury.Payment[] memory stored = t.getPayroll(id, 0, 100);
        assertEq(_sum(stored), p.totalAmount);
    }

    function testFuzz_PAY02_StoredTotalMatchesSum(uint8 nRaw, uint64 seed) public {
        uint256 n = bound(nRaw, 1, 100);
        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](n);
        for (uint256 i; i < n; ++i) {
            items[i] = AskirawaTreasury.Payment(_acct(7000 + i), uint96(bound(uint256(keccak256(abi.encode(seed, i))), 1, 1e12)));
        }
        uint256 id = _propose(approver1, items);
        assertEq(t.getProposal(id).totalAmount, _sum(items));
        assertEq(_sum(t.getPayroll(id, 0, 100)), _sum(items));
    }

    // ------------------------------------------------------------ G-PAY-03 payload hash
    function test_PAY03_PayloadHashMatchesGetPayload() public {
        AskirawaTreasury.Payment[] memory items = _varied(5);
        uint256 id = _propose(approver1, items);
        bytes memory payload = t.getPayload(id);
        assertEq(keccak256(payload), t.getProposal(id).payloadHash);
        assertEq(payload, abi.encode(items));
        AskirawaTreasury.Payment[] memory decoded = abi.decode(payload, (AskirawaTreasury.Payment[]));
        assertEq(decoded.length, 5);
        for (uint256 i; i < 5; ++i) _eq(decoded[i], items[i]);
    }

    function test_PAY03_DifferentPayrollsHaveDifferentHashes() public {
        AskirawaTreasury.Payment[] memory a = _varied(3);
        AskirawaTreasury.Payment[] memory b = _varied(3);
        b[2].amount += 1;
        uint256 ia = _propose(approver1, a);
        uint256 ib = _propose(approver1, b);
        assertTrue(t.getProposal(ia).payloadHash != t.getProposal(ib).payloadHash);
    }

    function test_PAY03_PayloadHashEmittedInProposedEvent() public {
        AskirawaTreasury.Payment[] memory items = _varied(2);
        uint64 exp = _exp();
        bytes32 h = keccak256(abi.encode(items));
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.Proposed(1, 1, proposerOnly, AskirawaTreasury.Action.Payroll, uint96(_sum(items)), exp, h, MEMO);
        vm.prank(proposerOnly);
        t.proposePayroll(items, exp, MEMO);
    }

    // ------------------------------------------------------------ G-PAY-04 events
    function test_PAY04_PayrollItemEventCarriesEveryItem() public {
        AskirawaTreasury.Payment[] memory items = _varied(6);
        uint64 exp = _exp();
        for (uint256 i; i < 6; ++i) {
            vm.expectEmit(true, true, true, true, address(t));
            emit AskirawaTreasury.PayrollItem(1, i, items[i].to, items[i].amount);
        }
        vm.prank(proposerOnly);
        t.proposePayroll(items, exp, MEMO);
    }

    function test_PAY04_ExactlyOnePayrollItemPerStoredItem() public {
        AskirawaTreasury.Payment[] memory items = _varied(4);
        uint64 exp = _exp();
        vm.recordLogs();
        vm.prank(approver1);
        t.proposePayroll(items, exp, MEMO);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 n;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == AskirawaTreasury.PayrollItem.selector) ++n;
        }
        assertEq(n, 4);
    }

    // ------------------------------------------------------------ G-PAY-05 execute takes no arrays
    function test_PAY05_ExecuteTakesOnlyAnIdAndPaysExactlyStoredItems() public {
        AskirawaTreasury.Payment[] memory items = _varied(5);
        uint256 id = _ready(items);
        // an overload accepting caller supplied arrays does not exist
        bytes memory evil = abi.encodeWithSignature("execute(uint256,(address,uint96)[])", id, _pay(outsider, 1));
        (bool ok,) = address(t).call(evil);
        assertFalse(ok, "no array-taking execute");
        (ok,) = address(t).call(abi.encodeWithSignature("execute(uint256,address[],uint256[])", id, new address[](0), new uint256[](0)));
        assertFalse(ok);
        _exec(id);
        for (uint256 i; i < 5; ++i) assertEq(usdc.balanceOf(items[i].to), items[i].amount);
        assertEq(usdc.balanceOf(outsider), 0);
        assertEq(usdc.balanceOf(address(t)), TREASURY_FUNDS - _sum(items));
    }

    function test_PAY05_ExecuteCalldataIsExactlySelectorPlusId() public {
        uint256 id = _ready(_varied(2));
        bytes memory data = abi.encodeCall(AskirawaTreasury.execute, (id));
        assertEq(data.length, 36);
        // trailing junk calldata is ignored by the ABI decoder and cannot change the payload
        vm.prank(outsider);
        (bool ok,) = address(t).call(abi.encodePacked(data, bytes32(uint256(uint160(outsider)))));
        assertTrue(ok);
        assertEq(usdc.balanceOf(outsider), 0);
    }

    // ------------------------------------------------------------ G-PAY-06 expiry bounds, delay, min window
    function test_PAY06_PayrollExpiryLowerBoundIsDelayPlusMinWindow() public {
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 1e6);
        uint64 lo = _now() + PAYROLL_DELAY + 1 hours;
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidExpiry.selector, lo - 1));
        t.proposePayroll(items, lo - 1, MEMO);
        vm.prank(approver1);
        uint256 id = t.proposePayroll(items, lo, MEMO);
        assertEq(t.getProposal(id).expiresAt, lo);
    }

    function test_PAY06_PayrollExpiryUpperBoundIsThirtyDays() public {
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 1e6);
        uint64 hi = _now() + 30 days;
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidExpiry.selector, hi + 1));
        t.proposePayroll(items, hi + 1, MEMO);
        vm.prank(approver1);
        uint256 id = t.proposePayroll(items, hi, MEMO);
        assertEq(t.getProposal(id).expiresAt, hi);
    }

    function test_PAY06_DelayEnforcedExactlyAtExecutableAt() public {
        uint256 id = _propose(approver1, _pay(payee1, 5e6));
        _approve(id, approver2);
        uint64 at = t.getProposal(id).executableAt;
        assertEq(at, t.getProposal(id).approvedAt + PAYROLL_DELAY);
        vm.warp(at - 1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.DelayNotElapsed.selector, at));
        t.execute(id);
        assertEq(usdc.balanceOf(payee1), 0);
        vm.warp(at);
        t.execute(id);
        assertEq(usdc.balanceOf(payee1), 5e6);
    }

    function test_PAY06_MinimumExecutionWindowAlwaysLeavesAnHourAfterDelay() public {
        // the smallest legal expiry still has >= 1 hour of executable time after the delay elapses
        uint64 lo = _now() + PAYROLL_DELAY + 1 hours;
        vm.prank(approver1);
        uint256 id = t.proposePayroll(_pay(payee1, 1e6), lo, MEMO);
        _approve(id, approver2); // quorum at creation time -> executableAt = now + delay
        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        assertEq(p.expiresAt - p.executableAt, 1 hours);
        vm.warp(p.expiresAt - 1);
        t.execute(id);
        assertEq(usdc.balanceOf(payee1), 1e6);
    }

    // ------------------------------------------------------------ G-PAY-09 invalid payroll shapes
    function test_PAY09_ZeroAmountRevertsAtAnyIndex() public {
        for (uint256 bad; bad < 4; ++bad) {
            AskirawaTreasury.Payment[] memory items = _varied(4);
            items[bad].amount = 0;
            uint64 exp = _exp();
            vm.prank(approver1);
            vm.expectRevert(AskirawaTreasury.ZeroAmount.selector);
            t.proposePayroll(items, exp, MEMO);
        }
    }

    function test_PAY09_ZeroRecipientReverts() public {
        AskirawaTreasury.Payment[] memory items = _varied(3);
        items[1].to = address(0);
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(0)));
        t.proposePayroll(items, exp, MEMO);
    }

    function test_PAY09_TreasuryRecipientReverts() public {
        AskirawaTreasury.Payment[] memory items = _varied(3);
        items[2].to = address(t);
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidAddress.selector, address(t)));
        t.proposePayroll(items, exp, MEMO);
    }

    function test_PAY09_EmptyBatchReverts() public {
        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](0);
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidPaymentCount.selector, 0));
        t.proposePayroll(items, exp, MEMO);
    }

    function test_PAY09_OversizedBatchReverts() public {
        AskirawaTreasury.Payment[] memory items = _batch(101, 1e6);
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.InvalidPaymentCount.selector, 101));
        t.proposePayroll(items, exp, MEMO);
        // boundary: exactly MAX_PAYMENTS is accepted
        uint256 id = _propose(approver1, _batch(100, 1e6));
        assertEq(t.getPayroll(id, 0, 1000).length, 100);
        assertEq(t.MAX_PAYMENTS(), 100);
    }

    function test_PAY09_TotalOverflowOfUint96Reverts() public {
        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](2);
        items[0] = AskirawaTreasury.Payment(payee1, type(uint96).max);
        items[1] = AskirawaTreasury.Payment(payee2, 1);
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(AskirawaTreasury.TotalOverflow.selector);
        t.proposePayroll(items, exp, MEMO);
        // exactly uint96.max in total is representable
        items[0].amount = type(uint96).max - 1;
        uint256 id = _propose(approver1, items);
        assertEq(t.getProposal(id).totalAmount, type(uint96).max);
    }

    function testFuzz_PAY09_ManyMaxItemsOverflow(uint8 nRaw) public {
        uint256 n = bound(nRaw, 2, 100);
        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](n);
        for (uint256 i; i < n; ++i) items[i] = AskirawaTreasury.Payment(_acct(9000 + i), type(uint96).max);
        uint64 exp = _exp();
        vm.prank(approver1);
        vm.expectRevert(AskirawaTreasury.TotalOverflow.selector);
        t.proposePayroll(items, exp, MEMO);
    }

    function test_PAY09_NonProposerCannotProposePayroll() public {
        uint64 exp = _exp();
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 1e6);
        vm.prank(outsider);
        vm.expectRevert(AskirawaTreasury.NotProposer.selector);
        t.proposePayroll(items, exp, MEMO);
    }

    function test_PAY_DuplicateRecipientsAllowedAndPaidSeparately() public {
        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](3);
        items[0] = AskirawaTreasury.Payment(payee1, 4e6);
        items[1] = AskirawaTreasury.Payment(payee2, 1e6);
        items[2] = AskirawaTreasury.Payment(payee1, 6e6);
        uint256 id = _ready(items);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.PaymentSent(id, 0, payee1, 4e6);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.PaymentSent(id, 1, payee2, 1e6);
        vm.expectEmit(true, true, true, true, address(t));
        emit AskirawaTreasury.PaymentSent(id, 2, payee1, 6e6);
        _exec(id);
        assertEq(usdc.balanceOf(payee1), 10e6);
        assertEq(usdc.balanceOf(payee2), 1e6);
        assertEq(t.getProposal(id).totalAmount, 11e6);
    }
}
