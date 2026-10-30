// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title ITreasuryModule
/// @notice Interface implemented by a quorum-enabled treasury module.
/// @dev A module must enforce that only its bound treasury can invoke onApproved.
interface ITreasuryModule is IERC165 {
    /// @notice Returns the immutable core treasury to which this module belongs.
    /// @return core The bound treasury address.
    function treasury() external view returns (address core);

    /// @notice Applies a stored, quorum-approved module action.
    /// @dev Called by the core under its reentrancy lock, after optional funding.
    /// Modules cannot draw from or otherwise mutate the core inside this callback.
    /// Reverting rolls back the entire core execution, including any prefunding.
    /// @param proposalId The core's sequential proposal identifier.
    /// @param actionCode Module-specific typed action discriminator.
    /// @param data The exact module data stored in the approved proposal.
    function onApproved(uint256 proposalId, uint8 actionCode, bytes calldata data) external;
}
