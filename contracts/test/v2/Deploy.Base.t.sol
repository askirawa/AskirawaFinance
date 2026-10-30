// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployConfigValidator as V} from "../../script/DeployConfigValidator.sol";

/// @notice External wrapper so the internal library can be exercised with vm.expectRevert.
contract ValidatorHarness {
    function validate(V.Config memory c, address[] memory forbidden) external pure returns (V.Summary memory) {
        return V.validate(c, forbidden);
    }

    function isPlaceholder(address a) external pure returns (bool) {
        return V.isPlaceholder(a);
    }
}

/// @notice Shared fixtures for the DEP group. Roles are makeAddr labels; the only address literal is the documented
/// shared platform wallet, which the validator must reject.
abstract contract DeployTestBase is Test {
    address internal constant SHARED = 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42;

    address internal usdcAddr = makeAddr("usdcToken");
    address internal ap1 = makeAddr("depApprover1");
    address internal ap2 = makeAddr("depApprover2");
    address internal ap3 = makeAddr("depApprover3");
    address internal pr1 = makeAddr("depProposer1");
    address internal guard = makeAddr("depGuardian");

    function _list(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2); r[0] = a; r[1] = b;
    }

    function _list(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3); r[0] = a; r[1] = b; r[2] = c;
    }

    function _accts(uint256 n, uint256 salt) internal pure returns (address[] memory r) {
        r = new address[](n);
        for (uint256 i; i < n; ++i) r[i] = vm.addr(5000 + salt * 100 + i);
    }

    function _noForbidden() internal pure returns (address[] memory r) { r = new address[](0); }

    /// @dev A configuration the validator accepts.
    function _valid() internal view returns (V.Config memory c) {
        c.usdc = usdcAddr;
        c.approvers = _list(ap1, ap2, ap3);
        c.proposers = _list(ap1, pr1);
        c.guardian = guard;
        c.quorum = 2;
        c.minConfigDelay = 1 days;
        c.payrollDelay = 1 days;
        c.configDelay = 2 days;
        c.retryDelay = 6 hours;
        c.maxFailures = 3;
        c.perTxMax = 1_000e6;
        c.windowMax = 5_000e6;
        c.windowLength = 7 days;
    }
}
