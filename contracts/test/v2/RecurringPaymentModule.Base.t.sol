// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ITreasuryModule} from "../../v2/interfaces/ITreasuryModule.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {RecurringPaymentModule} from "../../v2/RecurringPaymentModule.sol";
import {IRecurringPaymentModule} from "../../v2/interfaces/IRecurringPaymentModule.sol";
import {ScheduleMath} from "../../v2/libraries/ScheduleMath.sol";
import {ScheduleRef} from "./RecurringPaymentModule.MathRef.t.sol";

/// @notice Shared fixture for RecurringPaymentModule tests.
/// Deployment (labels only, no literal addresses):
///   core      : AskirawaTreasury from AskirawaTreasuryTestBase (approver1..3, quorum 2, guardian, delays 1d/2d)
///   module    : RecurringPaymentModule(core, retryDelay = 6 hours, maxFailures = 3)
///   enabled   : through a real ModuleConfig proposal, perTxMax 1_000e6, windowMax 500_000e6, window 1 day
///   clock     : vm.warp(T0 = 2027-01-15 00:00:00 UTC) before the module is configured, so the module is
///               enabled around 2027-01-17 and every proposal pass advances time by the 1-day action delay.
/// Schedules are created / resumed ONLY by real ModuleAction proposals executed by the core.
abstract contract RecurringPaymentModuleTestBase is AskirawaTreasuryTestBase, ScheduleRef {
    uint32 internal constant RETRY_DELAY = 6 hours;
    uint8 internal constant MAX_FAILURES = 3;
    uint96 internal constant RPM_PER_TX = 1_000e6;
    uint96 internal constant RPM_WINDOW_MAX = 500_000e6;
    uint32 internal constant RPM_WINDOW_LEN = 1 days;
    uint96 internal constant AMOUNT = 100e6;
    uint64 internal constant T0 = 1799971200; // 2027-01-15 00:00:00 UTC
    uint8 internal constant CREATE = 1;
    uint8 internal constant RESUME = 2;

    ScheduleMath.Frequency internal constant DAILY = ScheduleMath.Frequency.Daily;
    ScheduleMath.Frequency internal constant WEEKLY = ScheduleMath.Frequency.Weekly;
    ScheduleMath.Frequency internal constant MONTHLY = ScheduleMath.Frequency.Monthly;

    RecurringPaymentModule internal rpm;
    address internal keeper = makeAddr("keeper");
    address internal payeeA = makeAddr("payeeA");

    function setUp() public virtual override {
        super.setUp();
        vm.warp(T0);
        rpm = new RecurringPaymentModule(address(t), RETRY_DELAY, MAX_FAILURES);
        _configureRpm(true, RPM_PER_TX, RPM_WINDOW_MAX, RPM_WINDOW_LEN);
    }

    // ------------------------------------------------------------ core / budget helpers
    function _configureRpm(bool enabled, uint96 perTx, uint96 windowMax, uint32 windowLen) internal {
        uint64 exp = _exp();
        vm.prank(approver1);
        uint256 id = t.proposeModuleConfig(address(rpm), enabled, perTx, windowMax, windowLen, exp, MEMO);
        _pass(id);
    }

    /// @dev New governance config identical to the default except for the pieces passed in.
    function _govConfig(address[] memory approvers_, address guardian_)
        internal view returns (AskirawaTreasury.GovernancePayload memory c)
    {
        c = _cfg();
        c.approvers = approvers_;
        c.guardian = guardian_;
    }

    // ------------------------------------------------------------ schedule parameter builders
    function _p(address to, uint96 amount, ScheduleMath.Frequency f, uint64 start)
        internal pure returns (IRecurringPaymentModule.ScheduleParams memory p)
    {
        p.recipient = to;
        p.amount = amount;
        p.frequency = f;
        p.startTime = start;
    }

    /// @dev Timestamp at which a proposal created now and passed immediately will execute.
    function _execTs() internal view returns (uint64) { return _now() + PAYROLL_DELAY; }

    // ------------------------------------------------------------ proposal drivers (real core flow)
    function _proposeRaw(uint8 code, bytes memory data) internal returns (uint256 id) {
        uint64 exp = _exp();
        vm.prank(approver1);
        id = t.proposeModuleAction(address(rpm), code, data, 0, exp, MEMO);
    }

    function _proposeCreate(IRecurringPaymentModule.ScheduleParams memory p) internal returns (uint256 id) {
        id = _proposeRaw(CREATE, abi.encode(p));
    }

    /// @dev Creates a schedule through an approved proposal; returns the new schedule id.
    function _create(IRecurringPaymentModule.ScheduleParams memory p) internal returns (uint256 sid) {
        _pass(_proposeCreate(p));
        sid = rpm.scheduleCount();
    }

    function _proposeResume(uint256 sid, bool skipMissed) internal returns (uint256 id) {
        id = _proposeRaw(RESUME, abi.encode(sid, skipMissed));
    }

    function _resume(uint256 sid, bool skipMissed) internal {
        _pass(_proposeResume(sid, skipMissed));
    }

    /// @dev Passes `pid` up to the execute call and expects the core to bubble the module's revert wrapped in
    /// ModuleCallbackFailed(pid, inner).
    function _expectCallbackRevert(uint256 pid, bytes memory inner) internal {
        _reachQuorum(pid);
        _warpToExecutable(pid);
        vm.expectRevert(abi.encodeWithSelector(AskirawaTreasury.ModuleCallbackFailed.selector, pid, inner));
        _exec(pid);
    }

    // ------------------------------------------------------------ schedule drivers / views
    function _run(uint256 sid, address by) internal {
        vm.prank(by);
        rpm.execute(sid);
    }

    function _s(uint256 sid) internal view returns (IRecurringPaymentModule.Schedule memory) {
        return rpm.getSchedule(sid);
    }

    function _digest(uint256 sid) internal view returns (bytes32) {
        return keccak256(abi.encode(rpm.getSchedule(sid), rpm.skippedPeriods(sid)));
    }

    function _st(uint256 sid) internal view returns (IRecurringPaymentModule.ScheduleStatus) {
        return rpm.getSchedule(sid).status;
    }

    /// @dev Reference-expected due time of period n for a stored schedule (independent oracle).
    function _dueOf(uint256 sid, uint256 n) internal view returns (uint64) {
        IRecurringPaymentModule.Schedule memory s = rpm.getSchedule(sid);
        return uint64(refAdd(s.startTime, s.frequency, n));
    }

    function _ref(uint256 sid, uint256 period) internal pure returns (bytes32) {
        return keccak256(abi.encode(sid, period));
    }

    /// @dev Registers the exact core ModulePaid and module ScheduleExecuted expectations for the next execute.
    function _expectPaid(uint256 sid, uint256 period, uint64 dueAt, address by, uint96 totalAfter) internal {
        IRecurringPaymentModule.Schedule memory s = _s(sid);
        vm.expectEmit(true, true, false, true, address(t));
        emit AskirawaTreasury.ModulePaid(address(rpm), s.recipient, s.amount, _ref(sid, period));
        vm.expectEmit(true, true, true, true, address(rpm));
        emit IRecurringPaymentModule.ScheduleExecuted(sid, period, s.recipient, s.amount, dueAt, _now(), by, totalAfter);
    }

    struct PaySnap {
        IRecurringPaymentModule.Schedule s;
        uint256 period;
        uint256 payeeBal;
        uint256 coreBal;
    }

    function _snap(uint256 sid) internal view returns (PaySnap memory k) {
        k.s = _s(sid);
        k.period = uint256(k.s.executedCount) + rpm.skippedPeriods(sid);
        k.payeeBal = usdc.balanceOf(k.s.recipient);
        k.coreBal = t.balance();
    }

    function _assertPaid(uint256 sid, PaySnap memory k) internal view {
        assertEq(usdc.balanceOf(k.s.recipient), k.payeeBal + k.s.amount, "recipient delta");
        assertEq(t.balance(), k.coreBal - k.s.amount, "treasury delta");
        assertEq(usdc.balanceOf(address(rpm)), 0, "module never holds funds");
        IRecurringPaymentModule.Schedule memory a = _s(sid);
        assertEq(a.executedCount, k.s.executedCount + 1, "executedCount");
        assertEq(a.totalPaid, k.s.totalPaid + k.s.amount, "totalPaid");
        assertEq(a.failures, 0);
        assertEq(a.nextRetryAt, 0);
    }

    /// @dev Executes one due payment as `by` and asserts receipt event, balance deltas and counters.
    /// Does not assume what nextDue / status become (limits may complete the schedule). Returns the period paid.
    function _payOnce(uint256 sid, address by) internal returns (uint256) {
        PaySnap memory k = _snap(sid);
        _expectPaid(sid, k.period, k.s.nextDue, by, k.s.totalPaid + k.s.amount);
        _run(sid, by);
        _assertPaid(sid, k);
        return k.period;
    }

    // ------------------------------------------------------------ ABI surface scan (shared)
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
                } else if (len == 3 && i + 4 < end && uint8(code[i + 4]) == 0x14) {
                    // selectors with a leading zero byte (e.g. 0x004cca52) are emitted as PUSH3
                    tmp[n++] = bytes4(
                        (uint32(uint8(code[i + 1])) << 16) | (uint32(uint8(code[i + 2])) << 8)
                            | uint32(uint8(code[i + 3]))
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
        string[22] memory sigs = [
            "treasury()", "onApproved(uint256,uint8,bytes)", "supportsInterface(bytes4)", "CREATE_SCHEDULE()",
            "RESUME_SCHEDULE()", "ACTION_RECOVER_FUNDS()", "MAX_BACKLOG()", "retryDelay()", "maxFailures()",
            "nextScheduleId()", "schedules(uint256)", "skippedPeriods(uint256)", "catchUpUntil(uint256)", "pause(uint256)", "cancel(uint256)", "execute(uint256)",
            "getSchedule(uint256)", "isDue(uint256)", "dueSchedules(uint256,uint256)", "nextDueAt(uint256)",
            "remaining(uint256)", "scheduleCount()"
        ];
        f = new bytes4[](sigs.length);
        for (uint256 i; i < sigs.length; ++i) f[i] = bytes4(keccak256(bytes(sigs[i])));
    }

    /// @dev Everything the dispatcher can route to must be an intended function; every other 4-byte constant in the
    /// code must be an error / interface id / external-call selector the contract legitimately uses.
    function _knownNonFunctions() internal pure returns (bytes4[] memory k) {
        string[37] memory sigs = [
            // module errors
            "OnlyTreasury()", "Unauthorized()", "InvalidTreasury()", "InvalidRetryConfiguration()",
            "InvalidRecipient(address)", "InvalidAmount(uint96,uint96)", "InvalidScheduleParameters()",
            "NothingToRecover()", "UnknownAction(uint8)", "UnknownSchedule(uint256)", "InvalidStatus(uint256,uint8)", "NotDue(uint64)",
            "RetryNotReady(uint64)", "SnapshotOverflow()", "DateOutOfRange()", "InvalidDate()",
            "ReentrancyGuardReentrantCall()",
            // compiler
            "Panic(uint256)", "Error(string)",
            // external core calls the module makes
            "isApprover(address)", "guardian()", "balance()", "usdc()", "payFromModule(address,uint256,bytes32)",
            "modules(address)",
            // failure classification selectors
            "TreasuryPaused()", "BudgetExceeded()", "InsufficientBalance(uint256,uint256)",
            "BalanceDeltaMismatch(uint256,uint256,uint256)", "SafeERC20FailedOperation(address)",
            "ERC20InsufficientBalance(address,uint256,uint256)", "ERC20InvalidSender(address)",
            "ERC20InvalidReceiver(address)", "ERC20InsufficientAllowance(address,uint256,uint256)",
            "ERC20InvalidApprover(address)", "ERC20InvalidSpender(address)", "EnforcedPause()"
        ];
        k = new bytes4[](sigs.length + 5);
        for (uint256 i; i < sigs.length; ++i) k[i] = bytes4(keccak256(bytes(sigs[i])));
        k[sigs.length] = type(IERC165).interfaceId;
        k[sigs.length + 1] = type(ITreasuryModule).interfaceId;
        k[sigs.length + 2] = type(IRecurringPaymentModule).interfaceId;
        // PUSH3 date-math constants picked up by the leading-zero selector scan: days per 400 years, seconds per day
        k[sigs.length + 3] = bytes4(uint32(146097));
        k[sigs.length + 4] = bytes4(uint32(86400));
    }
}
