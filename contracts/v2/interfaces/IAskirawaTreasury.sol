// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IAskirawaTreasury
/// @notice Minimal core interface for independently deployed treasury modules.
interface IAskirawaTreasury {
    /// @notice Checks membership of the current epoch's approver set.
    /// @param account Address to check.
    /// @return authorized Whether account is a current approver.
    function isApprover(address account) external view returns (bool authorized);

    /// @notice Returns the current guardian, or zero when disabled.
    /// @return account Current guardian address.
    function guardian() external view returns (address account);

    /// @notice Reports whether core outflows are paused.
    /// @return blocked Whether outflows are blocked.
    function paused() external view returns (bool blocked);

    /// @notice Returns the immutable USDC ERC-20 interface (ABI-encoded as an address).
    /// @return token The configured token.
    function usdc() external view returns (IERC20 token);

    /// @notice Returns the core's current ERC-20 USDC balance, without reservations.
    /// @return amount Current balance in raw token units.
    function balance() external view returns (uint256 amount);

    /// @notice Pays a recipient using the calling module's codehash-pinned budget.
    /// @param to Nonzero recipient other than the core.
    /// @param amount Positive raw USDC amount, within per-call and window limits.
    /// @param ref Opaque reconciliation reference.
    function payFromModule(address to, uint256 amount, bytes32 ref) external;

    /// @notice Sends budget-checked USDC to the calling module's custody.
    /// @param amount Positive raw USDC amount, within per-call and window limits.
    /// @param ref Opaque reconciliation reference.
    function fundModule(uint256 amount, bytes32 ref) external;
}
