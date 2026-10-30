// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {RecurringPaymentModuleTestBase} from "./RecurringPaymentModule.Base.t.sol";
import {IRecurringPaymentModule} from "../../v2/interfaces/IRecurringPaymentModule.sol";
import {ITreasuryModule} from "../../v2/interfaces/ITreasuryModule.sol";

/// @notice Views (isDue / nextDueAt / dueSchedules pagination) and the "no edit function" ABI scan.
contract RecurringPaymentModuleViewsTest is RecurringPaymentModuleTestBase {
    uint64 internal constant S = T0 + 20 days;

    /// @dev ids: 1,2,4 open and due at S; 3 starts S+30d; 5 cancelled; 6 restricted to `keeper`.
    function _six() internal {
        _create(_p(payee1, AMOUNT, DAILY, S));
        _create(_p(payee1, AMOUNT, WEEKLY, S));
        _create(_p(payee1, AMOUNT, DAILY, S + 30 days));
        _create(_p(payee2, AMOUNT, MONTHLY, S));
        uint256 five = _create(_p(payee2, AMOUNT, DAILY, S));
        IRecurringPaymentModule.ScheduleParams memory p = _p(payee2, AMOUNT, DAILY, S);
        p.executor = keeper;
        _create(p);
        vm.prank(guardian);
        rpm.cancel(five);
        vm.warp(S + 1 hours);
    }

    function _ids(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory r) {
        r = new uint256[](3);
        r[0] = a; r[1] = b; r[2] = c;
    }

    function _ids(uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256[] memory r) {
        r = new uint256[](4);
        r[0] = a; r[1] = b; r[2] = c; r[3] = d;
    }

    function _due(address who, uint256 offset, uint256 limit) internal returns (uint256[] memory) {
        vm.prank(who);
        return rpm.dueSchedules(offset, limit);
    }

    // ------------------------------------------------------------ isDue / nextDueAt
    function test_Views_IsDueAndNextDueAtTrackTheLifecycle() public {
        uint64 start = _execTs() + 2 days;
        uint256 sid = _create(_p(payee1, AMOUNT, DAILY, start));
        assertFalse(rpm.isDue(sid));
        assertEq(rpm.nextDueAt(sid), start);
        vm.warp(start - 1);
        assertFalse(rpm.isDue(sid), "one second early");
        vm.warp(start);
        assertTrue(rpm.isDue(sid), "exactly at the boundary");
        _payOnce(sid, outsider);
        assertFalse(rpm.isDue(sid), "paid for this period");
        assertEq(rpm.nextDueAt(sid), start + 1 days);
        vm.warp(start + 1 days);
        assertTrue(rpm.isDue(sid));
        vm.prank(approver1);
        rpm.pause(sid);
        assertFalse(rpm.isDue(sid), "paused");
        assertEq(rpm.nextDueAt(sid), start + 1 days, "nextDueAt is stored state, independent of status");
        assertFalse(rpm.isDue(0));
        assertFalse(rpm.isDue(99));
        assertEq(rpm.nextDueAt(99), 0);
        assertEq(rpm.scheduleCount(), 1);
    }

    // ------------------------------------------------------------ dueSchedules
    function test_Views_DueSchedulesFiltersByStatusTimeAndCallerPermission() public {
        _six();
        assertEq(_due(outsider, 0, 100), _ids(1, 2, 4), "open, active, started schedules only");
        assertEq(_due(keeper, 0, 100), _ids(1, 2, 4, 6), "designated executor sees its restricted schedule");
        assertEq(_due(approver3, 0, 100), _ids(1, 2, 4, 6), "approvers see restricted schedules");
        assertEq(_due(guardian, 0, 100), _ids(1, 2, 4), "guardian is not an executor");
        // isDue ignores the caller; dueSchedules applies it
        assertTrue(rpm.isDue(6));
        assertFalse(rpm.isDue(5), "cancelled");
        assertFalse(rpm.isDue(3), "future start");
    }

    function test_Views_DueSchedulesReactsToPaymentsAndPausesAndTime() public {
        _six();
        _payOnce(1, outsider);
        vm.prank(approver1);
        rpm.pause(2);
        assertEq(_due(keeper, 0, 100), _two(4, 6), "1 paid, 2 paused, 3 not started, 5 cancelled");
        // S = 2027-02-04 00:00 UTC. At S + 30 days: 1 (daily) is due again; 3 has just started;
        // 4 (monthly) is due since its second boundary is 2027-03-04 = S + 28 days; 2 paused; 5 cancelled.
        vm.warp(S + 30 days);
        uint256[] memory got = _due(keeper, 0, 100);
        assertEq(got, _ids(1, 3, 4, 6));
        for (uint256 i; i < got.length; ++i) assertTrue(rpm.isDue(got[i]));
    }

    function _two(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a; r[1] = b;
    }

    function test_Views_DueSchedulesPaginationLimitBoundsIdsScannedNotMatches() public {
        _six();
        // outsider's eligible set is {1,2,4}; id 3 is not due, 5 cancelled, 6 restricted
        assertEq(_due(outsider, 0, 2), _two(1, 2), "ids 1-2 scanned");
        assertEq(_due(outsider, 2, 2), _one(4), "ids 3-4 scanned: only 4 qualifies");
        assertEq(_due(outsider, 4, 2).length, 0, "ids 5-6 scanned: none qualifies");
        assertEq(_due(outsider, 4, 1).length, 0, "id 5 only");
        assertEq(_due(keeper, 5, 1), _one(6), "id 6 only");
        assertEq(_due(outsider, 3, 1), _one(4), "offset 3 scans id 4 alone");
    }

    function _one(uint256 a) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = a;
    }

    function test_Views_DueSchedulesPageBoundariesAndExtremes() public {
        _six();
        assertEq(_due(outsider, 0, 0).length, 0, "limit zero");
        assertEq(_due(outsider, 6, 10).length, 0, "offset == count");
        assertEq(_due(outsider, 7, 10).length, 0, "offset > count");
        assertEq(_due(outsider, type(uint256).max, 1).length, 0, "huge offset");
        assertEq(_due(outsider, 0, type(uint256).max), _ids(1, 2, 4), "huge limit does not overflow");
        assertEq(_due(outsider, 3, type(uint256).max), _one(4), "offset 3 scans ids 4..6");
        assertEq(_due(outsider, 1, 1), _one(2), "single id window");
        assertEq(_due(outsider, 0, 3), _two(1, 2), "ids 1-3 scanned; 3 is not due");
        // paging through every id with page size 2 reconstructs the full list, ascending, without duplicates
        uint256[] memory all = new uint256[](3);
        uint256 n;
        for (uint256 off; off < 6; off += 2) {
            uint256[] memory page = _due(outsider, off, 2);
            for (uint256 i; i < page.length; ++i) all[n++] = page[i];
        }
        assertEq(n, 3);
        assertEq(all, _ids(1, 2, 4));
    }

    function test_Views_DueSchedulesEmptyWhenNothingExists() public view {
        assertEq(rpm.dueSchedules(0, 10).length, 0);
        assertEq(rpm.dueSchedules(0, 0).length, 0);
    }

    // ------------------------------------------------------------ ABI: no edit function, no owner
    function _ok(bytes memory callData) internal returns (bool ok, bytes memory ret) {
        (ok, ret) = address(rpm).call(callData);
    }

    function test_Views_NoEditOrAdminFunctionsExistByName() public {
        string[24] memory sigs = [
            "editSchedule(uint256,address,uint96)",
            "updateSchedule(uint256,address,uint96,uint8)",
            "modifySchedule(uint256,address,uint96)",
            "setRecipient(uint256,address)",
            "setAmount(uint256,uint96)",
            "setFrequency(uint256,uint8)",
            "setStartTime(uint256,uint64)",
            "setEndTime(uint256,uint64)",
            "setExecutor(uint256,address)",
            "setMaxExecutions(uint256,uint32)",
            "setMaxTotal(uint256,uint96)",
            "setMinTreasuryBalanceAfter(uint256,uint96)",
            "setRetryDelay(uint32)",
            "setMaxFailures(uint8)",
            "extend(uint256,uint64)",
            "resume(uint256)",
            "resume(uint256,bool)",
            "createSchedule(address,uint96,uint8,uint64,uint64,uint32,uint96,uint96,address,bytes32)",
            "owner()",
            "transferOwnership(address)",
            "withdraw(address,uint256)",
            "rescue(address,uint256)",
            "setTreasury(address)",
            "upgradeTo(address)"
        ];
        for (uint256 i; i < sigs.length; ++i) {
            bytes4 sel = bytes4(keccak256(bytes(sigs[i])));
            (bool ok, bytes memory ret) = _ok(abi.encodePacked(sel, new bytes(320)));
            assertFalse(ok, sigs[i]);
            assertEq(ret.length, 0, "unknown selector: empty revert, no fallback");
        }
        // control: a real selector with a bogus id reverts WITH data (so the probe above can tell them apart)
        (bool okReal, bytes memory real) = _ok(abi.encodeCall(IRecurringPaymentModule.execute, (999)));
        assertFalse(okReal);
        assertGt(real.length, 0);
        // no native-value entry point
        vm.deal(address(this), 1 ether);
        (bool sent,) = address(rpm).call{value: 1 wei}("");
        assertFalse(sent, "no receive / payable fallback");
    }

    /// @dev Walks the deployed bytecode, skipping PUSH immediates and the CBOR metadata tail, collecting every
    /// 4-byte constant that is compared with EQ (how the dispatcher and interface-id checks test equality).
    function _push4s(bytes memory code) internal pure returns (bytes4[] memory out) {
        uint256 end = code.length;
        uint256 metaLen = (uint256(uint8(code[end - 2])) << 8) | uint256(uint8(code[end - 1]));
        if (metaLen + 2 < end) end -= metaLen + 2;
        bytes4[] memory tmp = new bytes4[](end);
        uint256 n;
        for (uint256 i; i < end;) {
            uint8 op = uint8(code[i]);
            if (op >= 0x60 && op <= 0x7f) {
                uint256 len = op - 0x5f;
                if (len == 4 && i + 5 < end && uint8(code[i + 5]) == 0x14) { // PUSH4 <x> EQ: selector / id comparison
                    tmp[n++] = bytes4(
                        (uint32(uint8(code[i + 1])) << 24) | (uint32(uint8(code[i + 2])) << 16)
                            | (uint32(uint8(code[i + 3])) << 8) | uint32(uint8(code[i + 4]))
                    );
                }
                i += len + 1;
            } else {
                ++i;
            }
        }
        out = new bytes4[](n);
        for (uint256 j; j < n; ++j) out[j] = tmp[j];
    }

    function _contains(bytes4[] memory list, bytes4 x) internal pure returns (bool) {
        for (uint256 i; i < list.length; ++i) if (list[i] == x) return true;
        return false;
    }

    function _expectedFunctions() internal pure returns (bytes4[] memory f) {
        string[20] memory sigs = [
            "treasury()", "onApproved(uint256,uint8,bytes)", "supportsInterface(bytes4)", "CREATE_SCHEDULE()",
            "RESUME_SCHEDULE()", "MAX_BACKLOG()", "retryDelay()", "maxFailures()", "nextScheduleId()",
            "schedules(uint256)", "skippedPeriods(uint256)", "pause(uint256)", "cancel(uint256)", "execute(uint256)",
            "getSchedule(uint256)", "isDue(uint256)", "dueSchedules(uint256,uint256)", "nextDueAt(uint256)",
            "remaining(uint256)", "scheduleCount()"
        ];
        f = new bytes4[](sigs.length);
        for (uint256 i; i < sigs.length; ++i) f[i] = bytes4(keccak256(bytes(sigs[i])));
    }

    /// @dev Everything the dispatcher can route to must be an intended function; every other 4-byte constant in the
    /// code must be an error / interface id / external-call selector the contract legitimately uses.
    function _knownNonFunctions() internal pure returns (bytes4[] memory k) {
        string[35] memory sigs = [
            // module errors
            "OnlyTreasury()", "Unauthorized()", "InvalidTreasury()", "InvalidRetryConfiguration()",
            "InvalidRecipient(address)", "InvalidAmount(uint96,uint96)", "InvalidScheduleParameters()",
            "UnknownAction(uint8)", "UnknownSchedule(uint256)", "InvalidStatus(uint256,uint8)", "NotDue(uint64)",
            "RetryNotReady(uint64)", "SnapshotOverflow()", "DateOutOfRange()", "InvalidDate()",
            "ReentrancyGuardReentrantCall()",
            // compiler
            "Panic(uint256)", "Error(string)",
            // external core calls the module makes
            "isApprover(address)", "guardian()", "balance()", "payFromModule(address,uint256,bytes32)",
            "modules(address)",
            // failure classification selectors
            "TreasuryPaused()", "BudgetExceeded()", "InsufficientBalance(uint256,uint256)",
            "BalanceDeltaMismatch(uint256,uint256,uint256)", "SafeERC20FailedOperation(address)",
            "ERC20InsufficientBalance(address,uint256,uint256)", "ERC20InvalidSender(address)",
            "ERC20InvalidReceiver(address)", "ERC20InsufficientAllowance(address,uint256,uint256)",
            "ERC20InvalidApprover(address)", "ERC20InvalidSpender(address)", "EnforcedPause()"
        ];
        k = new bytes4[](sigs.length + 3);
        for (uint256 i; i < sigs.length; ++i) k[i] = bytes4(keccak256(bytes(sigs[i])));
        k[sigs.length] = type(IERC165).interfaceId;
        k[sigs.length + 1] = type(ITreasuryModule).interfaceId;
        k[sigs.length + 2] = type(IRecurringPaymentModule).interfaceId;
    }

    function test_Views_BytecodeDispatcherExposesExactlyTheDocumentedFunctions() public {
        bytes4[] memory pushed = _push4s(address(rpm).code);
        bytes4[] memory fns = _expectedFunctions();
        bytes4[] memory known = _knownNonFunctions();
        // scanner sanity: every intended function is in the dispatcher
        for (uint256 i; i < fns.length; ++i) assertTrue(_contains(pushed, fns[i]), "intended selector missing");
        // nothing else looks like a function selector: surface every unexplained 4-byte constant
        uint256 unknown;
        for (uint256 i; i < pushed.length; ++i) {
            bytes4 x = pushed[i];
            if (x == bytes4(0xffffffff) || x == bytes4(0)) continue; // masks
            if (_contains(fns, x) || _contains(known, x)) continue;
            emit log_named_bytes32("unexplained PUSH4", bytes32(x));
            ++unknown;
        }
        assertEq(unknown, 0, "dispatcher exposes a selector outside the documented surface");
    }

    function test_Views_ModuleIdentityAndImmutableConfiguration() public view {
        assertEq(rpm.treasury(), address(t));
        assertEq(rpm.retryDelay(), RETRY_DELAY);
        assertEq(rpm.maxFailures(), MAX_FAILURES);
        assertEq(rpm.MAX_BACKLOG(), 3);
        assertEq(rpm.CREATE_SCHEDULE(), 1);
        assertEq(rpm.RESUME_SCHEDULE(), 2);
        assertTrue(rpm.supportsInterface(type(IERC165).interfaceId));
        assertTrue(rpm.supportsInterface(type(ITreasuryModule).interfaceId));
        assertTrue(rpm.supportsInterface(type(IRecurringPaymentModule).interfaceId));
        assertFalse(rpm.supportsInterface(0xffffffff));
    }
}
