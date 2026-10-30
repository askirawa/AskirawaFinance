// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DeployScriptBase, DecimalsStub} from "./Deploy.ScriptBase.t.sol";
import {DeployTreasuryV2} from "../../script/DeployTreasuryV2.s.sol";
import {AskirawaTreasury} from "../../v2/AskirawaTreasury.sol";
import {RecurringPaymentModule} from "../../v2/RecurringPaymentModule.sol";
import {V2MockUSDC} from "./mocks/V2MockUSDC.sol";

/// @notice DEP group, deployment script. The process environment is shared by every test thread, so ALL
/// env-driven cases run inside one sequential test function, in an order that relies on CONFIRM_DEPLOY and the
/// other variables never having been set before the first phase.
contract DeployScriptTest is DeployScriptBase {
    function setUp() public {
        script = new DeployTreasuryV2();
        token = new V2MockUSDC();
    }

    function test_Dep_Script_EveryEnvDrivenCaseRunsSequentially() public {
        _phaseMissingInputs();
        _phaseNotConfirmed();
        _phaseValidatorErrorsSurfaceThroughTheScript();
        _phaseUsdcChecks();
        _phaseUnsupportedChains();
        _phaseMalformedInputs();
        _phaseSuccessfulDeployments();
    }

    // ------------------------------------------------------------------ missing required variables
    function _phaseMissingInputs() internal {
        assertFalse(vm.envExists("USDC_ADDRESS"), "run with a clean environment: deploy variables must be unset");
        Env memory e = _good();
        vm.expectRevert(); // USDC_ADDRESS is required
        script.run();
        vm.setEnv("USDC_ADDRESS", vm.toString(e.usdc));
        vm.expectRevert(); // APPROVERS is required
        script.run();
        vm.setEnv("APPROVERS", _csv(e.approvers));
        vm.expectRevert(); // QUORUM is required (PROPOSERS and GUARDIAN are optional)
        script.run();
        vm.setEnv("QUORUM", "2");
        vm.expectRevert();
        script.run();
        vm.setEnv("MIN_CONFIG_DELAY", vm.toString(e.minCfg));
        vm.expectRevert();
        script.run();
        vm.setEnv("PAYROLL_DELAY", vm.toString(e.payroll));
        vm.expectRevert();
        script.run();
        vm.setEnv("CONFIG_DELAY", vm.toString(e.cfg));
        vm.expectRevert();
        script.run();
        vm.setEnv("RETRY_DELAY", vm.toString(e.retry));
        vm.expectRevert();
        script.run();
        vm.setEnv("MAX_FAILURES", vm.toString(e.maxFail));
        vm.expectRevert();
        script.run();
        vm.setEnv("PER_TX_MAX", vm.toString(e.perTx));
        vm.expectRevert();
        script.run();
        vm.setEnv("WINDOW_MAX", vm.toString(e.windowMax));
        vm.expectRevert();
        script.run();
        vm.setEnv("WINDOW_LENGTH", vm.toString(e.windowLen));
        // all required inputs present, optional ones absent, no confirmation: a preview only
        _runExpecting(abi.encodeWithSelector(DeployTreasuryV2.DeploymentNotConfirmed.selector));
    }

    // ------------------------------------------------------------------ USDC token checks
    function _phaseUsdcChecks() internal {
        Env memory e = _good();
        address eoa = makeAddr("notAContract");
        e.usdc = eoa;
        _rejects(e, abi.encodeWithSelector(DeployTreasuryV2.UsdcHasNoCode.selector, eoa));

        uint256[6] memory modes = [uint256(1), 2, 3, 4, 5, 6];
        for (uint256 i; i < modes.length; ++i) {
            DecimalsStub stub = new DecimalsStub(modes[i]);
            e = _good();
            e.usdc = address(stub);
            bytes memory err;
            if (modes[i] == 1) err = abi.encodeWithSelector(DeployTreasuryV2.UsdcDecimalsNotSix.selector, address(stub), 18);
            else if (modes[i] == 2) err = abi.encodeWithSelector(DeployTreasuryV2.UsdcDecimalsCallFailed.selector, address(stub));
            else if (modes[i] == 3) err = abi.encodeWithSelector(DeployTreasuryV2.MalformedUsdcDecimals.selector, address(stub), 64);
            else if (modes[i] == 4) err = abi.encodeWithSelector(DeployTreasuryV2.MalformedUsdcDecimals.selector, address(stub), 0);
            else if (modes[i] == 5) err = abi.encodeWithSelector(DeployTreasuryV2.UsdcDecimalsNotSix.selector, address(stub), 262);
            else err = abi.encodeWithSelector(DeployTreasuryV2.MalformedUsdcDecimals.selector, address(stub), 1);
            _rejects(e, err);
        }
    }

    // ------------------------------------------------------------------ chain id
    function _phaseUnsupportedChains() internal {
        uint256[5] memory bad = [uint256(1), 5042001, 5042003, 31338, 1337];
        for (uint256 i; i < bad.length; ++i) {
            vm.chainId(bad[i]);
            Env memory e = _good();
            _apply(e);
            _confirm("yes");
            _runExpecting(abi.encodeWithSelector(DeployTreasuryV2.UnsupportedChain.selector, bad[i]));
            _confirm("no"); // the chain check precedes even the preview
            _runExpecting(abi.encodeWithSelector(DeployTreasuryV2.UnsupportedChain.selector, bad[i]));
        }
        vm.chainId(31337);
    }

    // ------------------------------------------------------------------ malformed optional / numeric inputs
    function _phaseMalformedInputs() internal {
        _apply(_good());
        _confirm("yes");
        vm.setEnv("PROPOSERS", "not-an-address");
        vm.expectRevert(); // malformed non-empty optional input must propagate, never default to empty
        script.run();
        _apply(_good());
        vm.setEnv("GUARDIAN", "0x1234");
        vm.expectRevert();
        script.run();
        _apply(_good());
        vm.setEnv("QUORUM", "two");
        vm.expectRevert();
        script.run();
        _apply(_good());
        vm.setEnv("APPROVERS", string.concat(vm.toString(ap1), ";", vm.toString(ap2)));
        vm.expectRevert();
        script.run();
    }

    // ------------------------------------------------------------------ successful deployments
    function _phaseSuccessfulDeployments() internal {
        // 1. full configuration, local chain, makeAddr roles
        Env memory e = _good();
        _apply(e);
        _confirm("yes");
        (AskirawaTreasury t, RecurringPaymentModule m) = script.run();
        _assertDeployed(t, m, e);
        assertEq(t.guardian(), guard);
        assertEq(t.proposers().length, 2);
        assertEq(t.proposers()[0], ap1);
        assertEq(t.proposers()[1], pr1);

        // 2. no proposers, guardian disabled (empty optional values), Arc Testnet chain id
        vm.chainId(5042002);
        e = _good();
        e.proposers = "";
        e.guardian = "";
        _apply(e);
        (t, m) = script.run();
        _assertDeployed(t, m, e);
        assertEq(t.guardian(), address(0), "guardian disabled");
        assertEq(t.proposers().length, 0);
        vm.chainId(31337);

        // 3. boundary values: 20 approvers, quorum 11, maximum delays, retry 1h, one failure, 365 day window
        e = _good();
        e.approvers = _accts(20, 3);
        e.proposers = vm.toString(e.approvers[5]); // overlap with an approver is allowed
        e.guardian = vm.toString(e.approvers[0]); // guardian == approver is allowed (warning only)
        e.quorum = 11;
        e.minCfg = 14 days;
        e.payroll = 14 days;
        e.cfg = 14 days;
        e.retry = 1 hours;
        e.maxFail = 1;
        e.perTx = uint256(type(uint96).max);
        e.windowMax = uint256(type(uint96).max);
        e.windowLen = 365 days;
        _apply(e);
        (t, m) = script.run();
        _assertDeployed(t, m, e);
        assertEq(t.approvers().length, 20);

        // 4. a token that merely behaves like six-decimal USDC is accepted
        DecimalsStub sixStub = new DecimalsStub(0);
        e = _good();
        e.usdc = address(sixStub);
        _apply(e);
        (t, m) = script.run();
        assertEq(address(t.usdc()), address(sixStub));
    }

    function _assertDeployed(AskirawaTreasury t, RecurringPaymentModule m, Env memory e) internal view {
        assertGt(address(t).code.length, 0, "treasury deployed");
        assertGt(address(m).code.length, 0, "module deployed");
        assertTrue(address(t) != address(m));
        assertEq(address(t.usdc()), e.usdc);
        assertEq(t.MIN_CONFIG_DELAY(), e.minCfg);
        assertEq(t.currentEpoch(), 1);
        address[] memory got = t.approvers();
        assertEq(got.length, e.approvers.length);
        for (uint256 i; i < got.length; ++i) assertEq(got[i], e.approvers[i]);
        assertEq(t.quorum(), e.quorum);
        assertEq(t.payrollDelay(), e.payroll);
        assertEq(t.configDelay(), e.cfg);
        assertFalse(t.paused());
        assertEq(t.nextProposalId(), 1, "the script proposes nothing");
        assertEq(m.treasury(), address(t));
        assertEq(m.retryDelay(), e.retry);
        assertEq(m.maxFailures(), e.maxFail);
        (bool enabled,,,,,,) = t.modules(address(m));
        assertFalse(enabled, "module is not enabled by the script");
        assertEq(t.moduleSpendRemaining(address(m)), 0);
        assertEq(m.nextScheduleId(), 1);
        assertFalse(t.isProposer(address(script)), "the deployer gets no role");
        assertFalse(t.isApprover(address(this)));
    }
}
