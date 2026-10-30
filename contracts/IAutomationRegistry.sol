// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IAutomationRegistry {
    struct Rule {
        address target;
        bytes callData;
        uint256 interval;
        bool active;
        uint256 lastRun;
        address owner;
    }

    function registerRule(address target, bytes calldata callData, uint256 interval)
        external
        returns (uint256 ruleId);

    function deactivateRule(uint256 ruleId) external;

    function activateRule(uint256 ruleId) external;

    function executeRule(uint256 ruleId) external;

    function getRule(uint256 ruleId) external view returns (Rule memory);

    function isEligible(uint256 ruleId) external view returns (bool);

    event RuleRegistered(uint256 indexed ruleId, address indexed target, uint256 interval);
    event RuleExecuted(uint256 indexed ruleId, bool success);
    event RuleDeactivated(uint256 indexed ruleId);
    event RuleActivated(uint256 indexed ruleId);
}
