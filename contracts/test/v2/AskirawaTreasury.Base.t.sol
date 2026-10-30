// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {TreasuryRecovery} from "../../v2/TreasuryRecovery.sol";
import {V2MockUSDC} from "./mocks/V2MockUSDC.sol";
import {V2MockModule} from "./mocks/V2MockModule.sol";

/// @notice Shared fixtures for the Treasury v2 core test suite (part A).
/// Default deployment (all accounts are makeAddr labels, no literal addresses):
///   approvers  : approver1, approver2, approver3           quorum 2
///   proposers  : approver1 (overlaps approver), proposerOnly
///   guardian   : guardian
///   MIN_CONFIG_DELAY = 1 day, payrollDelay = 1 day, configDelay = 2 days
///   module budget: perTx 1_000e6, window 5_000e6 per 7 days
/// NOTE: always read time via vm.getBlockTimestamp() (via_ir may cache block.timestamp).
abstract contract AskirawaTreasuryTestBase is Test {
    enum Kind { Payroll, Governance, ModuleConfig, ModuleAction, Rescue, Unpause }

    uint32 internal constant MIN_CONFIG_DELAY = 1 days;
    uint32 internal constant PAYROLL_DELAY = 1 days;
    uint32 internal constant CONFIG_DELAY = 2 days;
    uint96 internal constant PER_TX = 1_000e6;
    uint96 internal constant WINDOW_MAX = 5_000e6;
    uint32 internal constant WINDOW_LEN = 7 days;
    uint256 internal constant TREASURY_FUNDS = 1_000_000e6;
    uint256 internal constant RESCUE_AMOUNT = 100e6;
    bytes32 internal constant MEMO = keccak256("PLACEHOLDER_MEMO");

    V2MockUSDC internal usdc;
    V2MockUSDC internal other; // non-USDC token for rescue tests
    AskirawaTreasury internal t;
    V2MockModule internal mod;

    address internal approver1 = makeAddr("approver1");
    address internal approver2 = makeAddr("approver2");
    address internal approver3 = makeAddr("approver3");
    address internal proposerOnly = makeAddr("proposerOnly");
    address internal guardian = makeAddr("guardian");
    address internal outsider = makeAddr("outsider");
    address internal payee1 = makeAddr("payee1");
    address internal payee2 = makeAddr("payee2");
    address internal rescueTo = makeAddr("rescueTo");
    address internal council1 = makeAddr("council1");
    address internal council2 = makeAddr("council2");
    address internal council3 = makeAddr("council3");
    uint8 internal constant COUNCIL_THRESHOLD = 2;
    TreasuryRecovery internal rec; // recovery contract bound to the most recently deployed default treasury

    /// @dev Default recovery council: three members, none of them an approver or the guardian.
    function _council() internal view returns (address[] memory r) {
        r = new address[](3); r[0] = council1; r[1] = council2; r[2] = council3;
    }

    /// @dev A fresh, not yet bound recovery contract with the default council (2 of 3).
    function _newRecovery() internal returns (TreasuryRecovery) {
        rec = new TreasuryRecovery(_council(), COUNCIL_THRESHOLD);
        return rec;
    }

    function setUp() public virtual {
        usdc = new V2MockUSDC();
        other = new V2MockUSDC();
        t = _deploy(_cfg(), MIN_CONFIG_DELAY);
        mod = new V2MockModule(address(t));
        usdc.mint(address(t), TREASURY_FUNDS);
        other.mint(address(t), RESCUE_AMOUNT * 10);
        vm.warp(1_000_000); // non-trivial start so "now - x" never underflows
    }

    // ------------------------------------------------------------ config builders
    function _arr(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2); r[0] = a; r[1] = b;
    }

    function _arr(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3); r[0] = a; r[1] = b; r[2] = c;
    }

    /// @dev Deterministic non-literal account number i (for size/fuzz sweeps).
    function _acct(uint256 i) internal pure returns (address) { return vm.addr(1000 + i); }

    function _accts(uint256 n, uint256 start) internal pure returns (address[] memory r) {
        r = new address[](n);
        for (uint256 i; i < n; ++i) r[i] = _acct(start + i);
    }

    function _cfg() internal view returns (AskirawaTreasury.GovernancePayload memory c) {
        c.approvers = _arr(approver1, approver2, approver3);
        c.proposers = _arr(approver1, proposerOnly);
        c.quorum = 2;
        c.guardian = guardian;
        c.payrollDelay = PAYROLL_DELAY;
        c.configDelay = CONFIG_DELAY;
    }

    function _deploy(AskirawaTreasury.GovernancePayload memory c, uint32 minDelay)
        internal returns (AskirawaTreasury) {
        return new AskirawaTreasury(address(usdc), minDelay, c.approvers, c.proposers, c.quorum,
            c.guardian, c.payrollDelay, c.configDelay, address(_newRecovery()));
    }

    // ------------------------------------------------------------ small utils
    function _now() internal view returns (uint64) { return uint64(vm.getBlockTimestamp()); }

    /// @dev Maximum legal expiry (now + 30 days).
    function _exp() internal view returns (uint64) { return _now() + 30 days; }

    function _delayOf(Kind k) internal view returns (uint32) {
        if (k == Kind.Governance || k == Kind.ModuleConfig || k == Kind.Unpause) return t.configDelay();
        return t.payrollDelay();
    }

    function _pay(address to, uint96 amount) internal pure returns (AskirawaTreasury.Payment[] memory items) {
        items = new AskirawaTreasury.Payment[](1);
        items[0] = AskirawaTreasury.Payment(to, amount);
    }

    // ------------------------------------------------------------ propose helpers
    function _proposePayroll(address by, address to, uint96 amount) internal returns (uint256) {
        return _proposePayrollExp(by, to, amount, _exp());
    }

    function _proposePayrollExp(address by, address to, uint96 amount, uint64 exp) internal returns (uint256) {
        AskirawaTreasury.Payment[] memory items = _pay(to, amount);
        vm.prank(by);
        return t.proposePayroll(items, exp, MEMO);
    }

    function _proposeGov(address by, AskirawaTreasury.GovernancePayload memory c) internal returns (uint256) {
        uint64 exp = _exp();
        vm.prank(by);
        return t.proposeGovernance(c, exp, MEMO);
    }

    function _proposeModuleConfig(address by, bool enabled) internal returns (uint256) {
        uint64 exp = _exp();
        address m = address(mod);
        vm.prank(by);
        return t.proposeModuleConfig(m, enabled, PER_TX, WINDOW_MAX, WINDOW_LEN, exp, MEMO);
    }

    function _proposeModuleAction(address by, uint96 funding) internal returns (uint256) {
        uint64 exp = _exp();
        address m = address(mod);
        vm.prank(by);
        return t.proposeModuleAction(m, 7, hex"c0ffee", funding, exp, MEMO);
    }

    function _proposeRescue(address by) internal returns (uint256) {
        uint64 exp = _exp();
        address tok = address(other);
        address to = rescueTo;
        vm.prank(by);
        return t.proposeRescue(tok, to, RESCUE_AMOUNT, exp, MEMO);
    }

    function _proposeUnpause(address by) internal returns (uint256) {
        uint64 exp = _exp();
        vm.prank(by);
        return t.proposeUnpause(exp, MEMO);
    }

    /// @dev Make the environment legal for proposing `k` (enable module / pause).
    function _prep(Kind k) internal {
        if (k == Kind.ModuleAction) _enableModule();
        if (k == Kind.Unpause && !t.paused()) _pause();
    }

    /// @dev Propose kind `k` with the given expiry. Call _prep(k) first.
    function _proposeKind(Kind k, address by, uint64 exp) internal returns (uint256) {
        address m = address(mod);
        address tok = address(other);
        address to = rescueTo;
        AskirawaTreasury.Payment[] memory items = _pay(payee1, 10e6);
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        vm.prank(by);
        if (k == Kind.Payroll) return t.proposePayroll(items, exp, MEMO);
        if (k == Kind.Governance) return t.proposeGovernance(c, exp, MEMO);
        if (k == Kind.ModuleConfig) return t.proposeModuleConfig(m, true, PER_TX, WINDOW_MAX, WINDOW_LEN, exp, MEMO);
        if (k == Kind.ModuleAction) return t.proposeModuleAction(m, 7, hex"c0ffee", 0, exp, MEMO);
        if (k == Kind.Rescue) return t.proposeRescue(tok, to, RESCUE_AMOUNT, exp, MEMO);
        return t.proposeUnpause(exp, MEMO);
    }

    /// @dev Propose kind `k` with the default (max) expiry, auto-preparing prerequisites.
    function _proposeAny(Kind k, address by) internal returns (uint256) {
        _prep(k);
        return _proposeKind(k, by, _exp());
    }

    // ------------------------------------------------------------ vote helpers
    function _approve(uint256 id, address by) internal { vm.prank(by); t.approve(id); }

    function _reject(uint256 id, address by) internal { vm.prank(by); t.reject(id); }

    /// @dev Approve with approver1..3 (skipping any who already voted) until quorum is reached.
    function _reachQuorum(uint256 id) internal {
        address[3] memory who = [approver1, approver2, approver3];
        for (uint256 i; i < 3; ++i) {
            AskirawaTreasury.Proposal memory p = t.getProposal(id);
            if (p.approvals >= p.quorum) return;
            if (t.voteOf(id, who[i]) == 0) _approve(id, who[i]);
        }
    }

    function _warpToExecutable(uint256 id) internal {
        AskirawaTreasury.Proposal memory p = t.getProposal(id);
        if (_now() < p.executableAt) vm.warp(p.executableAt);
    }

    function _exec(uint256 id) internal { vm.prank(outsider); t.execute(id); }

    /// @dev Quorum -> wait delay -> permissionless execute.
    function _pass(uint256 id) internal {
        _reachQuorum(id);
        _warpToExecutable(id);
        _exec(id);
    }

    // ------------------------------------------------------------ flow helpers
    function _payrollPass(address to, uint96 amount) internal returns (uint256 id) {
        id = _proposePayroll(approver1, to, amount);
        _pass(id);
    }

    /// @dev Replace the governance config via a full proposal; returns new epoch.
    function _govPass(AskirawaTreasury.GovernancePayload memory c) internal returns (uint256) {
        uint256 id = _proposeGov(approver1, c);
        _pass(id);
        return t.currentEpoch();
    }

    function _moduleConfigPass(bool enabled) internal {
        uint256 id = _proposeModuleConfig(approver1, enabled);
        _pass(id);
    }

    function _enableModule() internal {
        (bool en,,,,,,) = t.modules(address(mod));
        if (!en) _moduleConfigPass(true);
    }

    function _rescuePass() internal returns (uint256 id) {
        id = _proposeRescue(approver1);
        _pass(id);
    }

    function _pause() internal { vm.prank(guardian); t.pause(); }

    function _unpausePass() internal returns (uint256 id) {
        id = _proposeUnpause(approver1);
        _pass(id);
    }

    function _status(uint256 id) internal view returns (AskirawaTreasury.ProposalStatus) { return t.status(id); }
}
