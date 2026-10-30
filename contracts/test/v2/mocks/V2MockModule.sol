// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {ITreasuryModule} from "../../../v2/interfaces/ITreasuryModule.sol";
import {IAskirawaTreasury} from "../../../v2/interfaces/IAskirawaTreasury.sol";

/// @notice Configurable treasury module for tests. Implements ITreasuryModule + ERC-165.
/// In onApproved it can (in this order): record the call, revert on demand,
/// re-enter the core with arbitrary calldata, call payFromModule, call fundModule.
/// Re-entry / pay / fund results are captured (not bubbled) unless `bubble` is true.
contract V2MockModule is ITreasuryModule {
    struct Call { address sender; uint256 proposalId; uint8 actionCode; bytes data; }

    address public immutable core;
    Call[] internal _calls;

    bool public revertOnApproved;
    bytes public revertData;
    bool public bubble;

    bytes public reenterCalldata;
    bool public reenterAttempted;
    bool public reenterSuccess;
    bytes public reenterReturn;

    address public payTo;
    uint256 public payAmount;
    bool public payAttempted;
    bool public paySuccess;

    uint256 public fundAmount;
    bool public fundAttempted;
    bool public fundSuccess;

    constructor(address core_) { core = core_; }

    function treasury() external view returns (address) { return core; }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC165).interfaceId || id == type(ITreasuryModule).interfaceId;
    }

    // ---- configuration ----
    function setRevert(bool on, bytes calldata data) external { revertOnApproved = on; revertData = data; }
    function setBubble(bool on) external { bubble = on; }
    function setReenter(bytes calldata data) external { reenterCalldata = data; }
    function setPay(address to, uint256 amount) external { payTo = to; payAmount = amount; }
    function setFund(uint256 amount) external { fundAmount = amount; }

    // ---- views ----
    function callCount() external view returns (uint256) { return _calls.length; }
    function callAt(uint256 i) external view returns (Call memory) { return _calls[i]; }

    // ---- direct module -> core draws (called by tests from the module address) ----
    function pay(address to, uint256 amount, bytes32 ref) external {
        IAskirawaTreasury(core).payFromModule(to, amount, ref);
    }

    function fund(uint256 amount, bytes32 ref) external {
        IAskirawaTreasury(core).fundModule(amount, ref);
    }

    // ---- callback ----
    function onApproved(uint256 proposalId, uint8 actionCode, bytes calldata data) external {
        _calls.push(Call(msg.sender, proposalId, actionCode, data));
        if (revertOnApproved) {
            bytes memory r = revertData;
            assembly { revert(add(r, 32), mload(r)) }
        }
        if (reenterCalldata.length > 0) {
            reenterAttempted = true;
            (bool ok, bytes memory ret) = core.call(reenterCalldata);
            if (bubble && !ok) assembly { revert(add(ret, 32), mload(ret)) }
            reenterSuccess = ok;
            reenterReturn = ret;
        }
        if (payAmount > 0) {
            payAttempted = true;
            (bool ok, bytes memory ret) = core.call(
                abi.encodeCall(IAskirawaTreasury.payFromModule, (payTo, payAmount, bytes32(proposalId))));
            if (bubble && !ok) assembly { revert(add(ret, 32), mload(ret)) }
            paySuccess = ok;
        }
        if (fundAmount > 0) {
            fundAttempted = true;
            (bool ok, bytes memory ret) = core.call(
                abi.encodeCall(IAskirawaTreasury.fundModule, (fundAmount, bytes32(proposalId))));
            if (bubble && !ok) assembly { revert(add(ret, 32), mload(ret)) }
            fundSuccess = ok;
        }
    }
}
