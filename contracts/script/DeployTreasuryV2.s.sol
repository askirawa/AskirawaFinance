// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AskirawaTreasury} from "../v2/AskirawaTreasury.sol";
import {RecurringPaymentModule} from "../v2/RecurringPaymentModule.sol";
import {TreasuryRecovery} from "../v2/TreasuryRecovery.sol";
import {DeployConfigValidator} from "./DeployConfigValidator.sol";

/// @notice Operator-run deployment script for Arc Testnet and local development ONLY.
/// @dev Based on the OpenZeppelin custom empty scaffold; no deployer authority is introduced.
/// No private key is read or stored. CLI signer configuration controls startBroadcast().
contract DeployTreasuryV2 is Script {
    error UnsupportedChain(uint256 chainId);
    error DeploymentNotConfirmed();
    error RecoveryBindingMismatch(address treasury, address recovery);
    error UsdcHasNoCode(address usdc);
    error UsdcDecimalsCallFailed(address usdc);
    error MalformedUsdcDecimals(address usdc, uint256 returnLength);
    error UsdcDecimalsNotSix(address usdc, uint256 decimals);

    /// @notice Prints inputs, validates them, then deploys only with CONFIRM_DEPLOY exactly equal to yes.
    /// @dev Budget env inputs are required plans for a later ModuleConfig proposal; this script does not enable it.
    function run() external returns (AskirawaTreasury treasury, RecurringPaymentModule module, TreasuryRecovery recovery) {
        if (block.chainid != 5042002 && block.chainid != 31337) revert UnsupportedChain(block.chainid);
        DeployConfigValidator.Config memory c = _readConfig();
        _printConfig(c);
        _printPredictedAddresses();

        // Preview always stops before token checks, deployment or starting a broadcast.
        if (!_confirmed()) {
            console2.log("Preview only. Review every input; set CONFIRM_DEPLOY=yes to authorize deployment.");
            revert DeploymentNotConfirmed();
        }

        // Future CREATE addresses are not known here. Forbid the known token contract as a role.
        address[] memory forbidden = new address[](1);
        forbidden[0] = c.usdc;
        DeployConfigValidator.validate(c, forbidden);
        _checkUsdc(c.usdc);

        // All integer casts below are safe ONLY because the full-width inputs have been validated.
        vm.startBroadcast();
        // 1. The recovery contract first (it learns its treasury when the treasury's constructor binds it),
        // 2. then the treasury with the recovery address fixed forever, 3. then the module.
        recovery = new TreasuryRecovery(c.council, uint8(c.councilThreshold));
        uint256 recoveryBlock = block.number;
        treasury = new AskirawaTreasury(
            c.usdc,
            uint32(c.minConfigDelay),
            c.approvers,
            c.proposers,
            uint8(c.quorum),
            c.guardian,
            uint32(c.payrollDelay),
            uint32(c.configDelay),
            address(recovery)
        );
        uint256 treasuryBlock = block.number;
        module = new RecurringPaymentModule(address(treasury), uint32(c.retryDelay), uint8(c.maxFailures));
        uint256 moduleBlock = block.number;
        vm.stopBroadcast();

        if (address(recovery.treasury()) != address(treasury) || treasury.recovery() != address(recovery)) {
            revert RecoveryBindingMismatch(address(treasury), address(recovery));
        }

        console2.log("Recovery contract address", address(recovery));
        console2.log("Recovery deployment block (simulation; verify receipt)", recoveryBlock);
        console2.log("Treasury address", address(treasury));
        console2.log("Recurring module address", address(module));
        console2.log("Treasury deployment block (simulation; verify receipt)", treasuryBlock);
        console2.log("Module deployment block (simulation; verify receipt)", moduleBlock);
        _printConfig(c);
        console2.log("Module is NOT enabled. No ModuleConfig proposal or approval was sent.");
        console2.log("Manual: an approver/proposer must proposeModuleConfig(module, true, perTxMax, windowMax, windowLength, expiresAt, memoRef).");
        console2.log("Collect the configured quorum's approvals, wait CONFIG_DELAY after quorum, then execute that proposal.");
        console2.log("Read back epoch 1, roles, quorum, USDC, module treasury binding and codehash before funding.");
        console2.log("Record both actual deployment receipt blocks and addresses; use the treasury receipt block for indexing.");
        console2.log("These three deployments are separate transactions; inspect receipts before rerunning after a partial failure.");
    }

    /// @dev Optional: set DEPLOYER_ADDRESS to the signer you will use to print the CREATE addresses the
    /// two deployments will receive, in order. Compare them with the receipts after broadcasting.
    function _printPredictedAddresses() internal view {
        if (!vm.envExists("DEPLOYER_ADDRESS")) {
            console2.log("Set DEPLOYER_ADDRESS to print the predicted treasury and module addresses.");
            return;
        }
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        uint256 nonce = vm.getNonce(deployer);
        console2.log("Predicted deployer nonce", nonce);
        console2.log("Predicted recovery address", vm.computeCreateAddress(deployer, nonce));
        console2.log("Predicted treasury address", vm.computeCreateAddress(deployer, nonce + 1));
        console2.log("Predicted recurring module address", vm.computeCreateAddress(deployer, nonce + 2));
    }

    function _readConfig() internal view returns (DeployConfigValidator.Config memory c) {
        c.usdc = vm.envAddress("USDC_ADDRESS");
        c.approvers = vm.envAddress("APPROVERS", ",");
        c.proposers = new address[](0);
        // Only absent/empty optional values default. Malformed, nonempty inputs must propagate an error.
        if (vm.envExists("PROPOSERS")) {
            if (bytes(vm.envString("PROPOSERS")).length != 0) c.proposers = vm.envAddress("PROPOSERS", ",");
        }
        if (vm.envExists("GUARDIAN")) {
            if (bytes(vm.envString("GUARDIAN")).length != 0) c.guardian = vm.envAddress("GUARDIAN");
        }
        // Leaving the guardian unset is only accepted with an explicit GUARDIAN_DISABLED=yes.
        if (vm.envExists("GUARDIAN_DISABLED")) {
            c.guardianDisabledAck = keccak256(bytes(vm.envString("GUARDIAN_DISABLED"))) == keccak256(bytes("yes"));
        }
        c.council = vm.envAddress("RECOVERY_COUNCIL", ",");
        c.councilThreshold = vm.envUint("RECOVERY_THRESHOLD");
        c.quorum = vm.envUint("QUORUM");
        c.minConfigDelay = vm.envUint("MIN_CONFIG_DELAY");
        c.payrollDelay = vm.envUint("PAYROLL_DELAY");
        c.configDelay = vm.envUint("CONFIG_DELAY");
        c.retryDelay = vm.envUint("RETRY_DELAY");
        c.maxFailures = vm.envUint("MAX_FAILURES");
        c.perTxMax = vm.envUint("PER_TX_MAX");
        c.windowMax = vm.envUint("WINDOW_MAX");
        c.windowLength = vm.envUint("WINDOW_LENGTH");
    }

    function _confirmed() internal view returns (bool) {
        if (!vm.envExists("CONFIRM_DEPLOY")) return false;
        return keccak256(bytes(vm.envString("CONFIRM_DEPLOY"))) == keccak256(bytes("yes"));
    }

    /// @dev staticcall prevents state changes; length and uint256 decoding avoid uint8 ABI-decoder panics.
    /// Exactly one canonical ABI word is required, then its full value must equal six.
    function _checkUsdc(address token) internal view {
        if (token.code.length == 0) revert UsdcHasNoCode(token);
        (bool ok, bytes memory data) = token.staticcall{gas: 100000}(abi.encodeWithSignature("decimals()"));
        if (!ok) revert UsdcDecimalsCallFailed(token);
        if (data.length != 32) revert MalformedUsdcDecimals(token, data.length);
        uint256 decimals = abi.decode(data, (uint256));
        if (decimals != 6) revert UsdcDecimalsNotSix(token, decimals);
    }

    function _printConfig(DeployConfigValidator.Config memory c) internal view {
        console2.log("Resolved chain ID (testnet/local only)", block.chainid);
        console2.log("USDC_ADDRESS", c.usdc);
        console2.log("APPROVERS count", c.approvers.length);
        for (uint256 i; i < c.approvers.length; ++i) {
            console2.log("APPROVERS index", i);
            console2.log("address", c.approvers[i]);
        }
        console2.log("PROPOSERS count", c.proposers.length);
        for (uint256 i; i < c.proposers.length; ++i) {
            console2.log("PROPOSERS index", i);
            console2.log("address", c.proposers[i]);
        }
        console2.log("GUARDIAN (zero means disabled)", c.guardian);
        console2.log("GUARDIAN_DISABLED acknowledged", c.guardianDisabledAck);
        console2.log("RECOVERY_COUNCIL count", c.council.length);
        for (uint256 i; i < c.council.length; ++i) {
            console2.log("RECOVERY_COUNCIL index", i);
            console2.log("address", c.council[i]);
        }
        console2.log("RECOVERY_THRESHOLD", c.councilThreshold);
        console2.log("Recovery timings are fixed in the contract: 30 day inactivity, 14 day timelock, 7 day cooling.");
        console2.log("QUORUM", c.quorum);
        console2.log("MIN_CONFIG_DELAY seconds", c.minConfigDelay);
        console2.log("PAYROLL_DELAY seconds", c.payrollDelay);
        console2.log("CONFIG_DELAY seconds", c.configDelay);
        console2.log("RETRY_DELAY seconds", c.retryDelay);
        console2.log("MAX_FAILURES", c.maxFailures);
        console2.log("Planned PER_TX_MAX raw USDC units", c.perTxMax);
        console2.log("Planned WINDOW_MAX raw USDC units", c.windowMax);
        console2.log("Planned WINDOW_LENGTH seconds", c.windowLength);
        if (DeployConfigValidator.summary(c).guardianIsApprover) {
            console2.log("WARNING: guardian is also an approver; role powers are additive. Overlap is allowed.");
        }
    }
}
