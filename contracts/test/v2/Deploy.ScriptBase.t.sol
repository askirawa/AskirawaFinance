// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DeployTestBase} from "./Deploy.Base.t.sol";
import {DeployTreasuryV2} from "../../script/DeployTreasuryV2.s.sol";
import {DeployConfigValidator as V} from "../../script/DeployConfigValidator.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {RecurringPaymentModule} from "../../v2/RecurringPaymentModule.sol";
import {V2MockUSDC} from "./mocks/V2MockUSDC.sol";

/// @notice Token stub whose decimals() behaviour is fixed at construction.
/// mode 0: 6, 1: 18, 2: reverts, 3: two words, 4: empty return, 5: 262 (6 + 256), 6: one byte.
contract DecimalsStub {
    uint256 internal immutable MODE;

    constructor(uint256 mode) { MODE = mode; }

    fallback() external {
        uint256 m = MODE;
        if (m == 2) revert("no decimals");
        assembly {
            switch m
            case 0 { mstore(0, 6) return(0, 32) }
            case 1 { mstore(0, 18) return(0, 32) }
            case 3 { mstore(0, 6) mstore(32, 6) return(0, 64) }
            case 4 { return(0, 0) }
            case 5 { mstore(0, 262) return(0, 32) }
            default { mstore(0, 0x06) return(31, 1) }
        }
    }
}

/// @notice Env-driven fixture. The process environment is global, so every env-touching case lives in ONE
/// sequential test function (Deploy.Script.t.sol). Helpers here never run on their own.
abstract contract DeployScriptBase is DeployTestBase {
    struct Env {
        address usdc;
        address[] approvers;
        string proposers;
        string guardian;
        string guardianDisabled;
        address[] council;
        uint256 councilThreshold;
        uint256 quorum;
        uint256 minCfg;
        uint256 payroll;
        uint256 cfg;
        uint256 retry;
        uint256 maxFail;
        uint256 perTx;
        uint256 windowMax;
        uint256 windowLen;
    }

    DeployTreasuryV2 internal script;
    V2MockUSDC internal token;

    function _csv(address[] memory a) internal pure returns (string memory s) {
        for (uint256 i; i < a.length; ++i) s = string.concat(s, i == 0 ? "" : ",", vm.toString(a[i]));
    }

    function _good() internal view returns (Env memory e) {
        e.usdc = address(token);
        e.approvers = _list(ap1, ap2, ap3);
        e.proposers = string.concat(vm.toString(ap1), ",", vm.toString(pr1));
        e.guardian = vm.toString(guard);
        e.council = _list(cn1, cn2, cn3);
        e.councilThreshold = 2;
        e.quorum = 2;
        e.minCfg = 1 days;
        e.payroll = 1 days;
        e.cfg = 2 days;
        e.retry = 6 hours;
        e.maxFail = 3;
        e.perTx = 1_000e6;
        e.windowMax = 5_000e6;
        e.windowLen = 7 days;
    }

    function _apply(Env memory e) internal {
        vm.setEnv("USDC_ADDRESS", vm.toString(e.usdc));
        vm.setEnv("APPROVERS", _csv(e.approvers));
        vm.setEnv("PROPOSERS", e.proposers);
        vm.setEnv("GUARDIAN", e.guardian);
        vm.setEnv("GUARDIAN_DISABLED", e.guardianDisabled);
        vm.setEnv("RECOVERY_COUNCIL", _csv(e.council));
        vm.setEnv("RECOVERY_THRESHOLD", vm.toString(e.councilThreshold));
        vm.setEnv("QUORUM", vm.toString(e.quorum));
        vm.setEnv("MIN_CONFIG_DELAY", vm.toString(e.minCfg));
        vm.setEnv("PAYROLL_DELAY", vm.toString(e.payroll));
        vm.setEnv("CONFIG_DELAY", vm.toString(e.cfg));
        vm.setEnv("RETRY_DELAY", vm.toString(e.retry));
        vm.setEnv("MAX_FAILURES", vm.toString(e.maxFail));
        vm.setEnv("PER_TX_MAX", vm.toString(e.perTx));
        vm.setEnv("WINDOW_MAX", vm.toString(e.windowMax));
        vm.setEnv("WINDOW_LENGTH", vm.toString(e.windowLen));
    }

    function _confirm(string memory v) internal { vm.setEnv("CONFIRM_DEPLOY", v); }

    /// @dev Runs the script expecting `err`, and proves nothing was created by it.
    function _rejects(Env memory e, bytes memory err) internal {
        _apply(e);
        _confirm("yes");
        _runExpecting(err);
    }

    function _runExpecting(bytes memory err) internal {
        uint256 nonceBefore = vm.getNonce(address(script));
        address would0 = vm.computeCreateAddress(address(script), nonceBefore);
        address would1 = vm.computeCreateAddress(address(script), nonceBefore + 1);
        vm.expectRevert(err);
        script.run();
        assertEq(vm.getNonce(address(script)), nonceBefore, "no CREATE happened");
        assertEq(would0.code.length, 0, "no treasury created");
        assertEq(would1.code.length, 0, "no module created");
    }

    // ---------------------------------------------------------------- phases that must be rejected

    function _phaseNotConfirmed() internal {
        Env memory e = _good();
        _apply(e);
        // CONFIRM_DEPLOY has never been set in this process: unset must not deploy.
        _runExpecting(abi.encodeWithSelector(DeployTreasuryV2.DeploymentNotConfirmed.selector));
        string[8] memory notYes = ["no", "", "YES", "Yes", "yess", "ye", "true", "1"];
        for (uint256 i; i < notYes.length; ++i) {
            _confirm(notYes[i]);
            _runExpecting(abi.encodeWithSelector(DeployTreasuryV2.DeploymentNotConfirmed.selector));
        }
        // the preview also precedes validation: an invalid config is merely "not confirmed" without the flag
        e.approvers = _list(ap1, address(0));
        _apply(e);
        _confirm("no");
        _runExpecting(abi.encodeWithSelector(DeployTreasuryV2.DeploymentNotConfirmed.selector));
    }

    function _phaseValidatorErrorsSurfaceThroughTheScript() internal {
        Env memory e = _good();
        e.approvers = _list(ap1, address(0), ap3);
        _rejects(e, abi.encodeWithSelector(V.ZeroRoleAddress.selector, V.Role.Approver, 1));

        e = _good();
        e.approvers = _list(ap1, ap2); // fewer than three approvers
        e.quorum = 2;
        _rejects(e, abi.encodeWithSelector(V.InvalidApproverCount.selector, 2));

        e = _good();
        e.approvers = _list(ap1, ap2, ap1);
        _rejects(e, abi.encodeWithSelector(V.DuplicateRoleAddress.selector, V.Role.Approver, 2, 0, ap1));

        e = _good();
        address[] memory one = new address[](1);
        one[0] = ap1;
        e.approvers = one;
        e.quorum = 2;
        _rejects(e, abi.encodeWithSelector(V.InvalidApproverCount.selector, 1));

        e = _good();
        e.approvers = _accts(21, 1);
        _rejects(e, abi.encodeWithSelector(V.InvalidApproverCount.selector, 21));

        e = _good();
        e.approvers = _list(ap1, address(uint160(1)), ap3);
        _rejects(e, abi.encodeWithSelector(V.PlaceholderRoleAddress.selector, V.Role.Approver, 1, address(uint160(1))));
        e.approvers = _list(ap1, address(uint160(57005)), ap3);
        _rejects(e, abi.encodeWithSelector(V.PlaceholderRoleAddress.selector, V.Role.Approver, 1, address(uint160(57005))));
        e.approvers = _list(ap1, address(uint160(type(uint160).max)), ap3);
        _rejects(e, abi.encodeWithSelector(V.PlaceholderRoleAddress.selector, V.Role.Approver, 1, address(uint160(type(uint160).max))));

        e = _good();
        e.approvers = _list(ap1, SHARED, ap3);
        _rejects(e, abi.encodeWithSelector(V.SharedPlatformRoleAddress.selector, V.Role.Approver, 1));
        e = _good();
        e.proposers = vm.toString(SHARED);
        _rejects(e, abi.encodeWithSelector(V.SharedPlatformRoleAddress.selector, V.Role.Proposer, 0));
        e = _good();
        e.guardian = vm.toString(SHARED);
        _rejects(e, abi.encodeWithSelector(V.SharedPlatformRoleAddress.selector, V.Role.Guardian, 0));

        e = _good();
        e.approvers = _list(ap1, address(token), ap3); // the token itself is forbidden as a role
        _rejects(e, abi.encodeWithSelector(V.ForbiddenRoleAddress.selector, V.Role.Approver, 1, address(token), 0));

        e = _good();
        e.usdc = address(0);
        _rejects(e, abi.encodeWithSelector(V.ZeroUsdc.selector));

        uint256[4] memory badQuorum = [uint256(0), 1, 3, 4];
        for (uint256 i; i < badQuorum.length; ++i) {
            e = _good();
            e.quorum = badQuorum[i];
            _rejects(e, abi.encodeWithSelector(V.InvalidQuorum.selector, badQuorum[i], 3));
        }

        e = _good();
        e.council = _list(cn1, cn2);
        _rejects(e, abi.encodeWithSelector(V.InvalidCouncilCount.selector, 2));
        e = _good();
        e.councilThreshold = 3;
        _rejects(e, abi.encodeWithSelector(V.InvalidCouncilThreshold.selector, 3));
        e = _good();
        e.council = _list(cn1, ap3, cn3);
        _rejects(e, abi.encodeWithSelector(V.CouncilOverlapsApprover.selector, ap3));
        e = _good();
        e.council = _list(cn1, cn2, guard);
        _rejects(e, abi.encodeWithSelector(V.CouncilIsGuardian.selector, guard));

        e = _good();
        e.guardian = "";
        _rejects(e, abi.encodeWithSelector(V.GuardianNotConfigured.selector));
        e = _good();
        e.guardianDisabled = "yes";
        _rejects(e, abi.encodeWithSelector(V.GuardianConflict.selector, guard));
        e = _good();
        e.guardian = vm.toString(ap2);
        _rejects(e, abi.encodeWithSelector(V.GuardianIsApprover.selector, ap2));

        e = _good();
        e.minCfg = 1 hours - 1;
        e.cfg = 1 hours;
        _rejects(e, abi.encodeWithSelector(V.DelayTooShort.selector, V.DelayField.MinConfigDelay, 1 hours - 1, 1 hours));
        e = _good();
        e.payroll = 5 minutes - 1;
        _rejects(e, abi.encodeWithSelector(V.DelayTooShort.selector, V.DelayField.PayrollDelay, 5 minutes - 1, 5 minutes));

        e = _good();
        e.payroll = 14 days + 1;
        _rejects(e, abi.encodeWithSelector(V.DelayTooLong.selector, V.DelayField.PayrollDelay, 14 days + 1));
        e = _good();
        e.cfg = 14 days + 1;
        _rejects(e, abi.encodeWithSelector(V.DelayTooLong.selector, V.DelayField.ConfigDelay, 14 days + 1));
        e = _good();
        e.minCfg = 3 days;
        e.cfg = 2 days;
        _rejects(e, abi.encodeWithSelector(V.ConfigDelayBelowMinimum.selector, 2 days, 3 days));

        e = _good();
        e.retry = 1 hours - 1;
        _rejects(e, abi.encodeWithSelector(V.InvalidRetryDelay.selector, 1 hours - 1));
        e = _good();
        e.retry = 7 days + 1;
        _rejects(e, abi.encodeWithSelector(V.InvalidRetryDelay.selector, 7 days + 1));
        e = _good();
        e.maxFail = 0;
        _rejects(e, abi.encodeWithSelector(V.InvalidMaxFailures.selector, 0));
        e.maxFail = 11;
        _rejects(e, abi.encodeWithSelector(V.InvalidMaxFailures.selector, 11));

        e = _good();
        e.perTx = 0;
        _rejects(e, abi.encodeWithSelector(V.ZeroPerTxMax.selector));
        e = _good();
        e.perTx = e.windowMax + 1;
        _rejects(e, abi.encodeWithSelector(V.PerTxMaxExceedsWindowMax.selector, e.perTx, e.windowMax));
        e = _good();
        e.perTx = 1;
        e.windowMax = uint256(type(uint96).max) + 1;
        _rejects(e, abi.encodeWithSelector(V.BudgetAmountOverflow.selector, uint256(1), e.windowMax));
        e = _good();
        e.windowLen = 1 days - 1;
        _rejects(e, abi.encodeWithSelector(V.InvalidWindowLength.selector, 1 days - 1));
        e.windowLen = 365 days + 1;
        _rejects(e, abi.encodeWithSelector(V.InvalidWindowLength.selector, 365 days + 1));
    }
}
