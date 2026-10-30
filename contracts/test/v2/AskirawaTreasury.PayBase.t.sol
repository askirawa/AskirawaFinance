// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {AskirawaTreasuryTestBase} from "./AskirawaTreasury.Base.t.sol";

/// @notice Payroll helpers shared by the Part B files. No tests here.
abstract contract AskirawaTreasuryPayBase is AskirawaTreasuryTestBase {
    /// @dev n distinct payees, each `amount`. Accounts come from _acct (private-key derived, no literals).
    function _batch(uint256 n, uint96 amount) internal pure returns (AskirawaTreasury.Payment[] memory items) {
        items = new AskirawaTreasury.Payment[](n);
        for (uint256 i; i < n; ++i) items[i] = AskirawaTreasury.Payment(_acct(5000 + i), amount);
    }

    function _propose(address by, AskirawaTreasury.Payment[] memory items) internal returns (uint256) {
        uint64 exp = _exp();
        vm.prank(by);
        return t.proposePayroll(items, exp, MEMO);
    }

    /// @dev Propose by approver1, reach quorum, wait delay. Does not execute.
    function _ready(AskirawaTreasury.Payment[] memory items) internal returns (uint256 id) {
        id = _propose(approver1, items);
        _reachQuorum(id);
        _warpToExecutable(id);
    }

    function _sum(AskirawaTreasury.Payment[] memory items) internal pure returns (uint256 s) {
        for (uint256 i; i < items.length; ++i) s += items[i].amount;
    }

    function _balances(AskirawaTreasury.Payment[] memory items) internal view returns (uint256[] memory b) {
        b = new uint256[](items.length);
        for (uint256 i; i < items.length; ++i) b[i] = usdc.balanceOf(items[i].to);
    }

    function _assertBalances(AskirawaTreasury.Payment[] memory items, uint256[] memory expected) internal view {
        for (uint256 i; i < items.length; ++i) assertEq(usdc.balanceOf(items[i].to), expected[i]);
    }

    function _deployWith(address token) internal returns (AskirawaTreasury) {
        AskirawaTreasury.GovernancePayload memory c = _cfg();
        return new AskirawaTreasury(token, MIN_CONFIG_DELAY, c.approvers, c.proposers, c.quorum,
            c.guardian, c.payrollDelay, c.configDelay);
    }

    /// @dev Mint to `who`, approve and deposit through the treasury.
    function _depositFrom(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(t), amount);
        t.deposit(amount);
        vm.stopPrank();
    }
}
