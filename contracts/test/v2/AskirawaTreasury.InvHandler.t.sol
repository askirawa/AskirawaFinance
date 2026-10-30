// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {V2MockUSDC} from "./mocks/V2MockUSDC.sol";
import {V2MockModule} from "./mocks/V2MockModule.sol";

/// @notice Invariant handler: the only surface the fuzzer drives. Every action is bounded,
/// wrapped in try/catch, and keeps ghost totals for USDC conservation and event accounting.
/// Not a test contract (no test*/invariant* functions).
contract AskirawaTreasuryHandler is Test {
    AskirawaTreasury public t;
    V2MockUSDC public usdc;
    V2MockModule public mod;
    address[3] internal approvers;
    address internal guardian;
    address internal proposer;
    address[6] internal actors;

    uint256 public initialBalance;
    uint256 public ghostDeposits;
    uint256 public ghostDirect;
    uint256 public ghostPayroll;
    uint256 public ghostModule;

    bool public unloggedOutflow; // a USDC Transfer out of the treasury without matching event amount
    bool public unloggedDeposit; // a deposit whose Deposited event did not match the USDC Transfer in
    bool public overspend; // a payroll executed with a balance below its total

    uint256[] public ids;
    uint256[] public executedIds;
    mapping(uint256 => bool) public isExecutedGhost;

    uint256 public nExecuted;
    uint256 public nExecutedPayroll;
    uint256 public nExecutedAction;
    uint256 public nDraws;
    uint256 public nPauses;
    uint256 public nUnpauses;
    uint256 public nDeposits;
    uint256 public nProposed;

    constructor(AskirawaTreasury t_, V2MockUSDC usdc_, V2MockModule mod_, address[3] memory approvers_,
        address guardian_, address proposer_) {
        t = t_;
        usdc = usdc_;
        mod = mod_;
        approvers = approvers_;
        guardian = guardian_;
        proposer = proposer_;
        for (uint256 i; i < 6; ++i) actors[i] = vm.addr(70_000 + i);
        initialBalance = usdc_.balanceOf(address(t_));
    }

    function idsLength() external view returns (uint256) { return ids.length; }

    function executedLength() external view returns (uint256) { return executedIds.length; }

    // ------------------------------------------------------------ log accounting
    function _scan(Vm.Log[] memory logs) internal view returns (uint256 tIn, uint256 tOut, uint256 evOut, uint256 evDep) {
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory l = logs[i];
            if (l.emitter == address(usdc) && l.topics[0] == V2MockUSDC.Transfer.selector) {
                address from = address(uint160(uint256(l.topics[1])));
                address to = address(uint160(uint256(l.topics[2])));
                uint256 amt = abi.decode(l.data, (uint256));
                if (from == address(t)) tOut += amt;
                if (to == address(t)) tIn += amt;
            } else if (l.emitter == address(t)) {
                bytes32 s = l.topics[0];
                if (s == AskirawaTreasury.PaymentSent.selector) evOut += abi.decode(l.data, (uint256));
                else if (s == AskirawaTreasury.ModulePaid.selector || s == AskirawaTreasury.ModuleFunded.selector) {
                    (uint256 amt,) = abi.decode(l.data, (uint256, bytes32));
                    evOut += amt;
                } else if (s == AskirawaTreasury.Deposited.selector) evDep += abi.decode(l.data, (uint256));
            }
        }
    }

    function _checkOut() internal {
        (, uint256 tOut, uint256 evOut,) = _scan(vm.getRecordedLogs());
        if (tOut != evOut) unloggedOutflow = true;
    }

    function _now() internal view returns (uint64) { return uint64(vm.getBlockTimestamp()); }

    // ------------------------------------------------------------ actions
    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 1e12);
        usdc.mint(address(this), amount);
        usdc.approve(address(t), amount);
        vm.recordLogs();
        t.deposit(amount);
        (uint256 tIn,, , uint256 evDep) = _scan(vm.getRecordedLogs());
        if (tIn != amount || evDep != amount) unloggedDeposit = true;
        ghostDeposits += amount;
        ++nDeposits;
    }

    function directTransfer(uint256 amount) external {
        amount = bound(amount, 1, 1e11);
        usdc.mint(address(this), amount);
        usdc.transfer(address(t), amount);
        ghostDirect += amount;
    }

    function proposePayroll(uint256 seed) external {
        uint256 n = 1 + (seed % 4);
        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](n);
        for (uint256 i; i < n; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            items[i] = AskirawaTreasury.Payment(actors[r % 6], uint96(bound(r >> 8, 1, 3e11)));
        }
        uint64 exp = _now() + 30 days;
        vm.prank(seed % 2 == 0 ? approvers[0] : proposer);
        try t.proposePayroll(items, exp, bytes32(seed)) returns (uint256 id) {
            ids.push(id);
            ++nProposed;
        } catch {}
    }

    function proposeModuleAction(uint256 funding) external {
        funding = bound(funding, 0, 1_000e6);
        uint64 exp = _now() + 30 days;
        vm.prank(approvers[0]);
        try t.proposeModuleAction(address(mod), 1, hex"01", uint96(funding), exp, bytes32(funding)) returns (uint256 id) {
            ids.push(id);
            ++nProposed;
        } catch {}
    }

    function approve(uint256 idx, uint256 who) external {
        if (ids.length == 0) return;
        vm.prank(approvers[who % 3]);
        try t.approve(ids[idx % ids.length]) {} catch {}
    }

    function cancel(uint256 idx, uint256 byGuardian) external {
        if (ids.length == 0) return;
        vm.prank(byGuardian % 2 == 0 ? guardian : proposer);
        try t.cancel(ids[idx % ids.length]) {} catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(vm.getBlockTimestamp() + bound(secs, 0, 3 days));
    }

    function setBlocked(uint256 who, bool on) external {
        usdc.setBlocked(actors[who % 6], on);
    }

    function execute(uint256 idx) external {
        if (ids.length == 0) return;
        _execute(ids[idx % ids.length]);
    }

    /// @dev Steered flow so deep states are reached: propose -> second approval -> (usually) wait -> execute.
    function payrollFlow(uint256 seed) external {
        uint256 n = 1 + (seed % 3);
        AskirawaTreasury.Payment[] memory items = new AskirawaTreasury.Payment[](n);
        for (uint256 i; i < n; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i, "flow")));
            items[i] = AskirawaTreasury.Payment(actors[r % 6], uint96(bound(r >> 8, 1, 4e11)));
        }
        uint64 exp = _now() + 30 days;
        vm.prank(approvers[0]);
        try t.proposePayroll(items, exp, bytes32(seed)) returns (uint256 id) {
            ids.push(id);
            ++nProposed;
            vm.prank(approvers[1]);
            try t.approve(id) {} catch { return; }
            if ((seed >> 8) % 5 != 0) vm.warp(vm.getBlockTimestamp() + t.payrollDelay());
            _execute(id);
        } catch {}
    }

    function actionFlow(uint256 funding, uint256 seed) external {
        funding = bound(funding, 0, 1_000e6);
        uint64 exp = _now() + 30 days;
        vm.prank(approvers[0]);
        try t.proposeModuleAction(address(mod), 1, hex"01", uint96(funding), exp, bytes32(funding)) returns (uint256 id) {
            ids.push(id);
            ++nProposed;
            vm.prank(approvers[2]);
            try t.approve(id) {} catch { return; }
            if (seed % 5 != 0) vm.warp(vm.getBlockTimestamp() + t.payrollDelay());
            _execute(id);
        } catch {}
    }

    function _execute(uint256 id) internal {
        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        uint256 balBefore = usdc.balanceOf(address(t));
        vm.recordLogs();
        try t.execute(id) {
            _checkOut();
            ++nExecuted;
            if (p.action == AskirawaTreasury.Action.Payroll) {
                ghostPayroll += p.totalAmount;
                ++nExecutedPayroll;
                if (balBefore < p.totalAmount) overspend = true;
            } else if (p.action == AskirawaTreasury.Action.ModuleAction) {
                ghostModule += p.totalAmount;
                ++nExecutedAction;
                if (balBefore < p.totalAmount) overspend = true;
            }
            if (!isExecutedGhost[id]) {
                isExecutedGhost[id] = true;
                executedIds.push(id);
            }
        } catch {
            vm.getRecordedLogs(); // logs of a reverted call are discarded
        }
    }

    function pause(uint256 who) external {
        address by = who % 4 == 0 ? guardian : approvers[who % 3];
        vm.prank(by);
        try t.pause() { ++nPauses; } catch {}
    }

    /// @dev Full unpause flow in one step: propose, second approval, wait configDelay, execute.
    function unpause() external {
        if (!t.paused()) return;
        uint64 exp = _now() + 30 days;
        vm.prank(approvers[0]);
        try t.proposeUnpause(exp, bytes32(0)) returns (uint256 id) {
            vm.prank(approvers[1]);
            try t.approve(id) {} catch { return; }
            vm.warp(vm.getBlockTimestamp() + t.configDelay());
            try t.execute(id) { ++nUnpauses; } catch {}
        } catch {}
    }

    function moduleDraw(uint256 amount, uint256 who, bool fund) external {
        amount = bound(amount, 1, 1_000e6 + 10);
        vm.recordLogs();
        vm.prank(address(mod));
        if (fund) {
            try t.fundModule(amount, bytes32(amount)) {
                _checkOut();
                ghostModule += amount;
                ++nDraws;
            } catch { vm.getRecordedLogs(); }
        } else {
            try t.payFromModule(actors[who % 6], amount, bytes32(amount)) {
                _checkOut();
                ghostModule += amount;
                ++nDraws;
            } catch { vm.getRecordedLogs(); }
        }
    }
}
