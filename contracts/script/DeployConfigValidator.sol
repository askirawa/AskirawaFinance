// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Pure deployment-policy validation, callable internally by scripts and tests.
/// @dev No code or chain checks: the caller checks the token and deployment chain.
library DeployConfigValidator {
    /// @notice The documented shared platform wallet must never hold a treasury role.
    address internal constant ARC_STUDIO_SHARED_PLATFORM_WALLET = 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42;

    enum Role { Approver, Proposer, Guardian }
    enum DelayField { MinConfigDelay, PayrollDelay, ConfigDelay }

    /// @dev Wide integers preserve env input until validation; narrowing happens only afterwards.
    /// Budget values describe the later, manually proposed module registration, not a constructor argument.
    struct Config {
        address usdc;
        address[] approvers;
        address[] proposers;
        address guardian;
        uint256 quorum;
        uint256 minConfigDelay;
        uint256 payrollDelay;
        uint256 configDelay;
        uint256 retryDelay;
        uint256 maxFailures;
        uint256 perTxMax;
        uint256 windowMax;
        uint256 windowLength;
    }

    struct Summary {
        uint256 approverCount;
        uint256 proposerCount;
        bool guardianEnabled;
        bool guardianIsApprover;
    }

    error ZeroUsdc();
    error InvalidApproverCount(uint256 count);
    error InvalidProposerCount(uint256 count);
    error ZeroRoleAddress(Role role, uint256 index);
    error ForbiddenRoleAddress(Role role, uint256 index, address account, uint256 forbiddenIndex);
    error PlaceholderRoleAddress(Role role, uint256 index, address account);
    error SharedPlatformRoleAddress(Role role, uint256 index);
    error DuplicateRoleAddress(Role role, uint256 index, uint256 firstIndex, address account);
    error InvalidQuorum(uint256 quorum, uint256 approverCount);
    error DelayTooLong(DelayField field, uint256 value);
    error ConfigDelayBelowMinimum(uint256 configDelay, uint256 minimum);
    error InvalidRetryDelay(uint256 value);
    error InvalidMaxFailures(uint256 value);
    error ZeroPerTxMax();
    error PerTxMaxExceedsWindowMax(uint256 perTxMax, uint256 windowMax);
    error BudgetAmountOverflow(uint256 perTxMax, uint256 windowMax);
    error InvalidWindowLength(uint256 value);

    /// @notice Reverts on the first invalid input; returns string-free warning flags otherwise.
    /// @dev Validation order: token, counts, role lists, guardian, quorum, delays, retry, budget.
    /// Duplicates are rejected within each list only; cross-role overlap is intentional.
    /// Guardian zero disables the role; a nonzero guardian uses index zero in errors.
    /// Include known contract/self addresses in forbidden. Contract wallets are otherwise allowed.
    function validate(Config memory c, address[] memory forbidden) internal pure returns (Summary memory result) {
        if (c.usdc == address(0)) revert ZeroUsdc();
        if (c.approvers.length < 2 || c.approvers.length > 20) {
            revert InvalidApproverCount(c.approvers.length);
        }
        if (c.proposers.length > 50) revert InvalidProposerCount(c.proposers.length);
        _validateList(c.approvers, Role.Approver, forbidden);
        _validateList(c.proposers, Role.Proposer, forbidden);
        if (c.guardian != address(0)) _validateRole(c.guardian, Role.Guardian, 0, forbidden);
        if (c.quorum < 2 || c.quorum > c.approvers.length) {
            revert InvalidQuorum(c.quorum, c.approvers.length);
        }
        if (c.minConfigDelay > 14 days) revert DelayTooLong(DelayField.MinConfigDelay, c.minConfigDelay);
        if (c.payrollDelay > 14 days) revert DelayTooLong(DelayField.PayrollDelay, c.payrollDelay);
        if (c.configDelay > 14 days) revert DelayTooLong(DelayField.ConfigDelay, c.configDelay);
        if (c.configDelay < c.minConfigDelay) revert ConfigDelayBelowMinimum(c.configDelay, c.minConfigDelay);
        if (c.retryDelay < 1 hours || c.retryDelay > 7 days) revert InvalidRetryDelay(c.retryDelay);
        if (c.maxFailures < 1 || c.maxFailures > 10) revert InvalidMaxFailures(c.maxFailures);
        if (c.perTxMax == 0) revert ZeroPerTxMax();
        if (c.perTxMax > c.windowMax) revert PerTxMaxExceedsWindowMax(c.perTxMax, c.windowMax);
        if (c.perTxMax > type(uint96).max || c.windowMax > type(uint96).max) {
            revert BudgetAmountOverflow(c.perTxMax, c.windowMax);
        }
        // Deployment policy uses a minimum one-day window, stricter than the core's positive-only floor.
        if (c.windowLength < 1 days || c.windowLength > 365 days) revert InvalidWindowLength(c.windowLength);
        return summary(c);
    }

    /// @notice Informational only; does not validate the config. Guardian/approver overlap is allowed.
    function summary(Config memory c) internal pure returns (Summary memory result) {
        result.approverCount = c.approvers.length;
        result.proposerCount = c.proposers.length;
        result.guardianEnabled = c.guardian != address(0);
        if (result.guardianEnabled) {
            for (uint256 i; i < c.approvers.length; ++i) {
                if (c.guardian == c.approvers[i]) {
                    result.guardianIsApprover = true;
                    break;
                }
            }
        }
    }

    /// @notice Exact, test-friendly placeholder predicate; there is no makeAddr blacklist.
    /// @dev True iff value < 2**32, all twenty bytes match, or value equals the conventional dead sentinel.
    /// The dead sentinel is expressed numerically so the shared wallet is the only address literal here.
    function isPlaceholder(address account) internal pure returns (bool) {
        uint160 value = uint160(account);
        if (value < (uint160(1) << 32) || value == uint160(57005)) return true;
        uint8 first = uint8(value);
        for (uint256 i = 1; i < 20; ++i) {
            if (uint8(value >> (i * 8)) != first) return false;
        }
        return true;
    }

    function _validateList(address[] memory accounts, Role role, address[] memory forbidden) private pure {
        for (uint256 i; i < accounts.length; ++i) {
            _validateRole(accounts[i], role, i, forbidden);
            for (uint256 j; j < i; ++j) {
                if (accounts[i] == accounts[j]) revert DuplicateRoleAddress(role, i, j, accounts[i]);
            }
        }
    }

    function _validateRole(address account, Role role, uint256 index, address[] memory forbidden) private pure {
        if (account == address(0)) revert ZeroRoleAddress(role, index);
        if (account == ARC_STUDIO_SHARED_PLATFORM_WALLET) revert SharedPlatformRoleAddress(role, index);
        for (uint256 i; i < forbidden.length; ++i) {
            if (account == forbidden[i]) revert ForbiddenRoleAddress(role, index, account, i);
        }
        if (isPlaceholder(account)) revert PlaceholderRoleAddress(role, index, account);
    }
}
