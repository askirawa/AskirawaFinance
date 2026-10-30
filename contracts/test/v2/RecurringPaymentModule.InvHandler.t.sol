// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {RecurringPaymentModule} from "../../v2/RecurringPaymentModule.sol";
import {IRecurringPaymentModule as IRPM} from "../../v2/interfaces/IRecurringPaymentModule.sol";
import {ScheduleMath} from "../../v2/libraries/ScheduleMath.sol";
import {V2MockUSDC} from "./mocks/V2MockUSDC.sol";

/// @notice Invariant handler for the recurring module. Every state change goes through the real core flow
/// (propose -> quorum -> delay -> execute) or the public module/core entry points. Not a test contract.
/// Ghost data is built ONLY from emitted events; the invariant test compares it with stored state.
contract RpmHandler is Test {
    AskirawaTreasury public t;
    RecurringPaymentModule public rpm;
    V2MockUSDC public usdc;
    address[3] internal approvers;
    address internal guardian;
    address internal keeper;
    address public sink;
    address[6] public actors; // recipients; also used as arbitrary executors
    address[7] internal callers;

    uint32 internal constant RETRY = 6 hours;

    // ---- ghost accounting
    uint256 public initialBalance;
    uint256 public ghostDeposits;
    uint256 public ghostPayroll;
    uint256 public ghostPaidTotal;
    uint256 public ghostCorePaid;
    uint256 public ghostPrefunded; // ModuleFunded events for the module (prefunded actions)
    uint256 public ghostDonated; // USDC pushed straight into the module
    uint256 public ghostRecovered; // FundsReturned events
    uint256 public sinkInitial;
    uint256[] public ids;
    mapping(uint256 => uint256) public ghostPaid;
    mapping(uint256 => uint256) public paidCount;
    mapping(uint256 => mapping(uint256 => bool)) public periodPaid;
    mapping(uint256 => uint32) public maxSeenCount;
    mapping(uint256 => uint8) public terminalStatus;
    mapping(uint256 => uint96) public terminalPaid;
    mapping(uint256 => uint32) public terminalCount;
    mapping(uint64 => uint256) public windowPaid;
    uint64[] public windowStarts;
    mapping(uint64 => bool) internal windowSeen;

    // ---- violation flags (must stay false)
    bool public doublePaid;
    bool public countDecreased;
    bool public terminalChanged;
    bool public paidFromInactive;
    bool public wrongPayment; // recipient / amount / executor / dueAt differ from stored terms or the caller
    bool public failureMovedState;
    bool public multiPayInOneCall;
    bool public wrongRecovery; // FundsReturned count/amount, module remainder or treasury delta is off
    bool public recoveryFailedWithFunds; // action 3 could not execute although the module held USDC
    bool public wrongBoundary; // catchUpUntil after a resume is not (now | 0)
    bool public backlogInsideRange; // BACKLOG auto-pause although nextDue <= catchUpUntil
    bool public paidBeyondGuard; // paid a period beyond the boundary that the ordinary guard must have paused

    // ---- coverage counters (reported, and required to be non-zero across a run)
    uint256 public nPayments;
    uint256 public nFailures;
    uint256 public nAutoPauseFailures;
    uint256 public nAutoPauseBacklog;
    uint256 public nResumes;
    uint256 public nCompletions;
    uint256 public nCreates;
    uint256 public nSchedPauses;
    uint256 public nCancels;
    uint256 public nCorePauses;
    uint256 public nCoreUnpauses;
    uint256 public nRetryRejected;
    uint256 public nBlockToggles;
    uint256 public nPrefunds;
    uint256 public nRecoveries;
    uint256 public nRecoverEmpty;
    uint256 public nDonations;
    uint256 public nNoSkipResumes;
    uint256 public nCatchUpPayments; // payments the backlog guard would have blocked without the authorization

    constructor(AskirawaTreasury t_, RecurringPaymentModule rpm_, V2MockUSDC usdc_, address[3] memory approvers_,
        address guardian_, address keeper_, address sink_) {
        t = t_;
        rpm = rpm_;
        usdc = usdc_;
        approvers = approvers_;
        guardian = guardian_;
        keeper = keeper_;
        sink = sink_;
        for (uint256 i; i < 6; ++i) actors[i] = vm.addr(80_000 + i);
        callers = [actors[0], actors[1], keeper, approvers_[0], approvers_[1], approvers_[2], vm.addr(81_000)];
        initialBalance = usdc_.balanceOf(address(t_));
        sinkInitial = usdc_.balanceOf(sink_);
    }

    function idsLength() external view returns (uint256) { return ids.length; }

    function windowStartsLength() external view returns (uint256) { return windowStarts.length; }

    function _now() internal view returns (uint64) { return uint64(vm.getBlockTimestamp()); }

    // ------------------------------------------------------------ core flow plumbing
    /// @dev Real approval flow for a module action. Returns whether the proposal executed.
    function _action(uint8 code, bytes memory data, bytes32 memo) internal returns (bool ok) {
        return _actionFunded(code, data, memo, 0);
    }

    function _actionFunded(uint8 code, bytes memory data, bytes32 memo, uint96 funding) internal returns (bool ok) {
        uint64 exp = _now() + 30 days;
        vm.prank(approvers[0]);
        try t.proposeModuleAction(address(rpm), code, data, funding, exp, memo) returns (uint256 pid) {
            vm.prank(approvers[1]);
            try t.approve(pid) {} catch { return false; }
            vm.warp(vm.getBlockTimestamp() + t.payrollDelay());
            vm.prank(approvers[2]);
            try t.execute(pid) { return true; } catch { return false; }
        } catch {
            return false;
        }
    }

    function _pick(uint256 idx) internal view returns (bool, uint256) {
        if (ids.length == 0) return (false, 0);
        return (true, ids[idx % ids.length]);
    }

    /// @dev After every action: executedCount monotonic, terminal states frozen.
    function _observe() internal {
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            IRPM.Schedule memory s = rpm.getSchedule(id);
            if (s.executedCount < maxSeenCount[id]) countDecreased = true;
            else maxSeenCount[id] = s.executedCount;
            bool terminal = s.status == IRPM.ScheduleStatus.Cancelled || s.status == IRPM.ScheduleStatus.Completed;
            if (terminalStatus[id] == 0) {
                if (terminal) {
                    terminalStatus[id] = uint8(s.status);
                    terminalPaid[id] = s.totalPaid;
                    terminalCount[id] = s.executedCount;
                }
            } else if (uint8(s.status) != terminalStatus[id] || s.totalPaid != terminalPaid[id]
                || s.executedCount != terminalCount[id]) {
                terminalChanged = true;
            }
        }
    }

    // ------------------------------------------------------------ treasury funding
    function deposit(uint256 amount) external {
        amount = bound(amount, 1e6, 800e6);
        usdc.mint(address(this), amount);
        usdc.approve(address(t), amount);
        t.deposit(amount);
        ghostDeposits += amount;
    }

    /// @dev Empties the treasury through a real payroll proposal (to the sink), so schedules hit INSUFFICIENT_BALANCE.
    function drain(uint256 gate) external {
        if (gate % 3 != 0) return; // rare
        uint256 bal = usdc.balanceOf(address(t));
        if (bal == 0 || bal > type(uint96).max) return;
        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](1);
        items[0] = AskirawaTreasury.Payment(sink, uint96(bal));
        uint64 exp = _now() + 30 days;
        vm.prank(approvers[0]);
        try t.proposePayroll(items, exp, bytes32(0)) returns (uint256 pid) {
            vm.prank(approvers[1]);
            try t.approve(pid) {} catch { return; }
            vm.warp(vm.getBlockTimestamp() + t.payrollDelay());
            try t.execute(pid) { ghostPayroll += bal; } catch {}
        } catch {}
        _observe();
    }

    function toggleBlocked(uint256 who, bool on) external {
        usdc.setBlocked(actors[who % 6], on);
        ++nBlockToggles;
    }

    // ------------------------------------------------------------ schedule lifecycle (quorum paths)
    function _params(uint256 seed, bool immediate) internal view returns (IRPM.ScheduleParams memory p) {
        p.recipient = actors[seed % 6];
        p.amount = uint96(bound(seed >> 8, 1e6, 300e6));
        p.frequency = ScheduleMath.Frequency((seed >> 16) % 3);
        p.startTime = _now() + 1 days + (immediate ? 0 : uint64((seed >> 24) % 3 days));
        if ((seed >> 32) % 4 == 0) p.endTime = p.startTime + uint64(bound(seed >> 40, 1 days, 6 days));
        if ((seed >> 48) % 3 == 0) p.maxExecutions = uint32(1 + (seed >> 56) % 3);
        if ((seed >> 64) % 6 == 0) p.maxTotal = uint96(p.amount * (1 + (seed >> 72) % 3) + p.amount / 2);
        if ((seed >> 80) % 5 == 0) p.minTreasuryBalanceAfter = uint96(bound(seed >> 88, 1e6, 500e6));
        if ((seed >> 96) % 5 == 0) p.executor = keeper;
        p.memoRef = bytes32(seed);
    }

    function _create(uint256 seed, bool immediate) internal returns (bool created, uint256 id) {
        uint256 before_ = rpm.scheduleCount();
        IRPM.ScheduleParams memory p = _params(seed, immediate);
        if (_action(1, abi.encode(p), bytes32(seed)) && rpm.scheduleCount() == before_ + 1) {
            id = rpm.scheduleCount();
            ids.push(id);
            ++nCreates;
            created = true;
        }
    }

    function createSchedule(uint256 seed) external {
        _create(seed, false);
        _observe();
    }

    /// @dev Creates a schedule whose first period is due the moment it exists, then lets a caller try to pay it.
    function createAndExecute(uint256 seed) external {
        (bool ok, uint256 id) = _create(seed, true);
        if (ok) _execute(id, callers[(seed >> 100) % 7]);
        _observe();
    }

    function resume(uint256 idx, bool skipMissed) external {
        (bool has, uint256 id) = _pick(idx);
        if (!has) return;
        if (rpm.getSchedule(id).status != IRPM.ScheduleStatus.Paused) return;
        if (_action(2, abi.encode(id, skipMissed), bytes32(id)) &&
            rpm.getSchedule(id).status == IRPM.ScheduleStatus.Active) {
            ++nResumes;
            if (!skipMissed) ++nNoSkipResumes;
            // the boundary is the approval-execution time for a no-skip resume and zero for a skip resume
            if (rpm.catchUpUntil(id) != (skipMissed ? 0 : _now())) wrongBoundary = true;
        }
        _observe();
    }

    // ------------------------------------------------------------ module-held USDC (prefunding, donations, action 3)
    /// @dev CREATE with fundingAmount > 0: budget is consumed and the USDC stays in the module.
    function prefundCreate(uint256 seed) external {
        uint96 funding = uint96(bound(seed >> 120, 1e6, 300e6));
        uint256 before_ = rpm.scheduleCount();
        IRPM.ScheduleParams memory p = _params(seed, false);
        vm.recordLogs();
        bool ok = _actionFunded(1, abi.encode(p), bytes32(seed), funding);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        if (ok && rpm.scheduleCount() == before_ + 1) {
            ids.push(rpm.scheduleCount());
            ++nCreates;
        }
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(t) && logs[i].topics[0] == AskirawaTreasury.ModuleFunded.selector) {
                (uint256 amount,) = abi.decode(logs[i].data, (uint256, bytes32));
                ghostPrefunded += amount;
                ++nPrefunds;
            }
        }
        _observe();
    }

    function donate(uint256 amount) external {
        amount = bound(amount, 1e6, 50e6);
        usdc.mint(address(rpm), amount);
        ghostDonated += amount;
        ++nDonations;
    }

    /// @dev Action 3 through the real quorum flow; checks the event, the module remainder and the treasury delta.
    function recover(uint256 seed) external {
        uint256 modBal = usdc.balanceOf(address(rpm));
        uint256 treBefore = usdc.balanceOf(address(t));
        bool wasPaused = t.paused();
        vm.recordLogs();
        bool ok = _action(3, "", bytes32(seed));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        if (ok) {
            uint256 events;
            uint256 returned;
            for (uint256 i; i < logs.length; ++i) {
                if (logs[i].emitter == address(rpm) && logs[i].topics[0] == IRPM.FundsReturned.selector) {
                    ++events;
                    returned = abi.decode(logs[i].data, (uint256));
                }
            }
            ghostRecovered += returned;
            ++nRecoveries;
            if (events != 1 || returned != modBal || usdc.balanceOf(address(rpm)) != 0
                || usdc.balanceOf(address(t)) != treBefore + returned) wrongRecovery = true;
            if (wasPaused) wrongRecovery = true; // the core pause must stop every module action
        } else if (modBal == 0) {
            ++nRecoverEmpty;
        } else if (!wasPaused) {
            recoveryFailedWithFunds = true;
        }
        _observe();
    }

    function pauseSchedule(uint256 idx, uint256 who) external {
        (bool has, uint256 id) = _pick(idx);
        if (!has || who % 6 != 0) return; // rare: keeps schedules alive long enough to be paid
        vm.prank(who % 3 == 0 ? guardian : approvers[who % 3]);
        try rpm.pause(id) { ++nSchedPauses; } catch {}
        _observe();
    }

    function cancelSchedule(uint256 idx, uint256 who) external {
        (bool has, uint256 id) = _pick(idx);
        if (!has || who % 10 != 0) return; // rare
        vm.prank(who % 3 == 0 ? guardian : approvers[who % 3]);
        try rpm.cancel(id) { ++nCancels; } catch {}
        _observe();
    }

    // ------------------------------------------------------------ core pause
    function corePause(uint256 who) external {
        if (who % 4 != 0) return; // rare
        vm.prank(who % 2 == 0 ? guardian : approvers[who % 3]);
        try t.pause() { ++nCorePauses; } catch {}
        _observe();
    }

    function coreUnpause() external {
        if (!t.paused()) return;
        uint64 exp = _now() + 30 days;
        vm.prank(approvers[0]);
        try t.proposeUnpause(exp, bytes32(0)) returns (uint256 pid) {
            vm.prank(approvers[1]);
            try t.approve(pid) {} catch { return; }
            vm.warp(vm.getBlockTimestamp() + t.configDelay());
            try t.execute(pid) { ++nCoreUnpauses; } catch {}
        } catch {}
        _observe();
    }

    // ------------------------------------------------------------ time
    function warp(uint256 seed) external {
        uint256 m = seed % 6;
        uint256 dt;
        if (m == 0) dt = bound(seed >> 8, 0, 1 hours);
        else if (m == 1) dt = RETRY;
        else if (m == 2) dt = 1 days;
        else if (m == 3) dt = 1 days + bound(seed >> 8, 0, 1 days);
        else if (m == 4) dt = bound(seed >> 8, 0, 3 days);
        else dt = RETRY + 1;
        vm.warp(vm.getBlockTimestamp() + dt);
        _observe();
    }

    // ------------------------------------------------------------ execution (random caller, any schedule)
    function execute(uint256 idx, uint256 callerSeed) external {
        (bool has, uint256 id) = _pick(idx);
        if (!has) return;
        _execute(id, callers[callerSeed % 7]);
        _observe();
    }

    /// @dev A keeper that keeps trying: execute, wait one retry window, execute again (up to five times).
    function persistentKeeper(uint256 idx) external {
        (bool has, uint256 id) = _pick(idx);
        if (!has) return;
        for (uint256 i; i < 5; ++i) {
            _execute(id, keeper);
            vm.warp(vm.getBlockTimestamp() + RETRY);
        }
        _observe();
    }

    /// @dev Executes whatever is due, oldest first, as the keeper (bounded sweep).
    function sweepDue() external {
        uint256 n = ids.length < 6 ? ids.length : 6;
        for (uint256 i; i < n; ++i) {
            if (rpm.isDue(ids[i])) _execute(ids[i], keeper);
        }
        _observe();
    }

    function _execute(uint256 id, address caller) internal {
        IRPM.Schedule memory b = rpm.getSchedule(id);
        vm.recordLogs();
        vm.prank(caller);
        try rpm.execute(id) {
            _account(id, b, caller, vm.getRecordedLogs());
        } catch (bytes memory reason) {
            vm.getRecordedLogs();
            if (reason.length >= 4 && bytes4(reason) == IRPM.RetryNotReady.selector) ++nRetryRejected;
        }
    }

    function _account(uint256 id, IRPM.Schedule memory b, address caller, Vm.Log[] memory logs) internal {
        uint256 payments;
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory l = logs[i];
            if (l.emitter == address(t) && l.topics[0] == AskirawaTreasury.ModulePaid.selector) {
                (uint256 amt,) = abi.decode(l.data, (uint256, bytes32));
                ghostCorePaid += amt;
            }
            if (l.emitter != address(rpm)) continue;
            bytes32 sig = l.topics[0];
            if (sig == IRPM.ScheduleExecuted.selector) {
                ++payments;
                _accountPayment(id, b, caller, l);
            } else if (sig == IRPM.ExecutionFailed.selector) {
                ++nFailures;
            } else if (sig == IRPM.ScheduleAutoPaused.selector) {
                if (abi.decode(l.data, (uint8)) == uint8(IRPM.AutoPauseReason.FAILURES)) ++nAutoPauseFailures;
                else {
                    ++nAutoPauseBacklog;
                    if (b.nextDue <= rpm.catchUpUntil(id)) backlogInsideRange = true;
                }
            } else if (sig == IRPM.ScheduleCompleted.selector) {
                ++nCompletions;
            }
        }
        if (payments > 1) multiPayInOneCall = true;
        IRPM.Schedule memory a = rpm.getSchedule(id);
        if (payments == 0 && (a.executedCount != b.executedCount || a.totalPaid != b.totalPaid)) failureMovedState = true;
        if (payments == 1 && a.executedCount != b.executedCount + 1) failureMovedState = true;
    }

    function _accountPayment(uint256 id, IRPM.Schedule memory b, address caller, Vm.Log memory l) internal {
        (uint256 period, uint96 amount, uint64 dueAt,,) = abi.decode(l.data, (uint256, uint96, uint64, uint64, uint96));
        if (b.status != IRPM.ScheduleStatus.Active) paidFromInactive = true;
        if (address(uint160(uint256(l.topics[2]))) != b.recipient || amount != b.amount
            || address(uint160(uint256(l.topics[3]))) != caller || dueAt != b.nextDue
            || uint256(l.topics[1]) != id) wrongPayment = true;
        if (periodPaid[id][period]) doublePaid = true;
        periodPaid[id][period] = true;
        ++paidCount[id];
        ghostPaid[id] += amount;
        ghostPaidTotal += amount;
        ++nPayments;
        _accountCatchUp(id, b);
        (,,,,, uint64 ws,) = t.modules(address(rpm));
        if (!windowSeen[ws]) {
            windowSeen[ws] = true;
            windowStarts.push(ws);
        }
        windowPaid[ws] += amount;
    }

    /// @dev A payment the ordinary guard would have blocked is legal ONLY when nextDue <= catchUpUntil.
    function _accountCatchUp(uint256 id, IRPM.Schedule memory b) internal {
        uint256 period = uint256(b.executedCount) + rpm.skippedPeriods(id);
        uint256 lastPeriod = ScheduleMath.maxPeriod(b.startTime, b.frequency);
        bool guardWouldFire = period + 3 <= lastPeriod
            && ScheduleMath.add(b.startTime, b.frequency, period + 3) <= _now();
        if (!guardWouldFire) return;
        if (b.nextDue <= rpm.catchUpUntil(id)) ++nCatchUpPayments;
        else paidBeyondGuard = true;
    }
}
