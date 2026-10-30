// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AskirawaFiTreasury} from "../AskirawaFiTreasury.sol";

/**
 * @title DeployTreasury
 * @notice Deploys AskirawaFiTreasury to Arc Mainnet (chain ID 5042).
 *
 * Usage:
 *   forge script contracts/script/DeployTreasury.s.sol \
 *     --rpc-url arc_mainnet \
 *     --broadcast \
 *     --private-key $DEPLOYER_PRIVATE_KEY \
 *     -vvvv
 *
 * Required env vars (never commit private keys):
 *   DEPLOYER_ADDRESS  - address of the deploying wallet (becomes the contract owner)
 *   APPROVERS         - comma-separated approver addresses (at least 2)
 *   QUORUM            - number of approver votes required (1 to number of approvers)
 *
 * At least two approvers are required: the contract does not let a proposer vote on
 * their own proposal, so a single approver could never pass anything.
 *
 * USDC on Arc Mainnet: 0x3600000000000000000000000000000000000000
 *
 * After deployment, record the treasury address in .env as VITE_TREASURY_ADDRESS.
 * Fund the treasury only after you have verified the deployment.
 */
contract DeployTreasury is Script {
    // Arc Mainnet USDC (ERC-20 view, 6 decimals)
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address[] memory approvers = vm.envAddress("APPROVERS", ",");
        uint256 quorum = vm.envUint("QUORUM");

        // Validate we are on Arc Mainnet
        require(block.chainid == 5042, "DeployTreasury: must run on Arc Mainnet (chain ID 5042)");
        require(approvers.length >= 2, "DeployTreasury: need at least 2 approvers");
        require(quorum >= 1 && quorum <= approvers.length && quorum <= type(uint8).max, "DeployTreasury: invalid quorum");

        vm.startBroadcast();

        AskirawaFiTreasury treasury = new AskirawaFiTreasury(
            USDC,            // usdcAddress - Arc Mainnet USDC
            deployer,        // initialOwner
            approvers,       // initialApprovers
            uint8(quorum)    // initialQuorum
        );

        vm.stopBroadcast();

        console.log("=== AskirawaFiTreasury deployed ===");
        console.log("Address:        ", address(treasury));
        console.log("Owner:          ", treasury.owner());
        console.log("USDC:           ", address(treasury.usdc()));
        console.log("Approver count: ", treasury.approverCount());
        console.log("Quorum:         ", treasury.quorum());
        console.log("Chain ID:       ", block.chainid);
        console.log("");
        console.log("Next steps:");
        console.log("  1. Set VITE_TREASURY_ADDRESS=", address(treasury), "in .env");
        console.log("  2. Rebuild and redeploy the frontend");
        console.log("  3. Deposit USDC into the treasury before running any payroll");
    }
}
