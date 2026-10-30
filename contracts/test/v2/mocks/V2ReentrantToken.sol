// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice 6-decimal ERC-20 whose transfer/transferFrom call back into a configured target
/// (as msg.sender == this token). The callback result is captured, never bubbled, so the
/// tests can assert exactly how the treasury reacted to the re-entry.
contract V2ReentrantToken {
    string public name = "Reentrant USDC";
    string public symbol = "rUSDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public hookTarget;
    bytes public hookData;
    bool public onTransfer; // fire on transfer()
    bool public onTransferFrom; // fire on transferFrom()
    bool public fireAfter; // fire after balances moved (default: before)
    bool public once = true; // fire a single time

    uint256 public hookCount;
    bool public hookOk;
    bytes public hookRet;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @dev lets this token act as a depositor/payer in a re-entrant deposit.
    function selfApprove(address spender, uint256 amount) external {
        allowance[address(this)][spender] = amount;
    }

    function arm(address target, bytes calldata data, bool onT, bool onTF, bool after_) external {
        hookTarget = target;
        hookData = data;
        onTransfer = onT;
        onTransferFrom = onTF;
        fireAfter = after_;
        hookCount = 0;
    }

    function setOnce(bool on) external { once = on; }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (onTransfer && !fireAfter) _hook();
        _move(msg.sender, to, amount);
        if (onTransfer && fireAfter) _hook();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        if (onTransferFrom && !fireAfter) _hook();
        _move(from, to, amount);
        if (onTransferFrom && fireAfter) _hook();
        return true;
    }

    function _hook() private {
        if (hookTarget == address(0) || (once && hookCount > 0)) return;
        ++hookCount;
        (bool ok, bytes memory ret) = hookTarget.call(hookData);
        hookOk = ok;
        hookRet = ret;
    }

    function _move(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
