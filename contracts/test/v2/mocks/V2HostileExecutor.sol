// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Test-only executor contract. It can be named as a schedule's restricted executor and, when armed as the
/// hook target of V2ReentrantToken, tries to re-enter the module and the core in the middle of a payment.
/// Every attempt is recorded (success flag and first four revert bytes); nothing is ever bubbled.
contract V2HostileExecutor {
    struct Attempt {
        bool ok;
        bytes4 err;
    }

    address public core;
    address public module_;
    uint256 public scheduleId;
    uint256 public hookRuns;

    Attempt public viaExecute;
    Attempt public viaOnApproved;
    Attempt public viaPay;
    Attempt public viaFund;
    Attempt public viaCoreExecute;
    Attempt public viaPause;

    function setTargets(address core_, address module__, uint256 scheduleId_) external {
        core = core_;
        module_ = module__;
        scheduleId = scheduleId_;
    }

    /// @dev Honest-looking entry: drives rpm.execute as msg.sender == this contract.
    function run(address module__, uint256 id) external {
        (bool ok, bytes memory ret) = module__.call(abi.encodeWithSignature("execute(uint256)", id));
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
    }

    /// @dev Called by the armed token while the module and the core are both mid-call.
    function onHook() external {
        ++hookRuns;
        viaExecute = _try(module_, abi.encodeWithSignature("execute(uint256)", scheduleId));
        viaOnApproved = _try(module_, abi.encodeWithSignature("onApproved(uint256,uint8,bytes)", uint256(1), uint8(1), bytes("")));
        viaPay = _try(core, abi.encodeWithSignature("payFromModule(address,uint256,bytes32)", address(this), uint256(1e6), bytes32(0)));
        viaFund = _try(core, abi.encodeWithSignature("fundModule(uint256,bytes32)", uint256(1e6), bytes32(0)));
        viaCoreExecute = _try(core, abi.encodeWithSignature("execute(uint256)", uint256(1)));
        viaPause = _try(core, abi.encodeWithSignature("pause()"));
    }

    function _try(address to, bytes memory data) private returns (Attempt memory a) {
        (bool ok, bytes memory ret) = to.call(data);
        a.ok = ok;
        if (ret.length >= 4) a.err = bytes4(ret);
    }
}

/// @notice Plain intermediary: forwards execute() so msg.sender at the module is this contract, never the origin.
contract V2Forwarder {
    function go(address module__, uint256 id) external {
        (bool ok, bytes memory ret) = module__.call(abi.encodeWithSignature("execute(uint256)", id));
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
    }
}
