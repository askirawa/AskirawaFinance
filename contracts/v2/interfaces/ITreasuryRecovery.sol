// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ITreasuryRecovery
/// @notice The only call the treasury makes into its recovery contract: a one-time binding from its constructor.
interface ITreasuryRecovery {
    /// @notice Binds the calling treasury as the one this recovery contract serves. Succeeds exactly once.
    /// @param approvers The treasury's initial approvers; the council must be independent of them.
    /// @param guardian The treasury's initial guardian (zero when disabled); the council must be independent of it.
    function bindTreasury(address[] calldata approvers, address guardian) external;
}
