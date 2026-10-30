// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Non-conforming 6-decimal ERC-20 used to prove the treasury's balance-delta checks.
///  - recipientSkimBps: the recipient is credited `amount - skim` (skim is burned)  -> inbound shortfall
///  - senderExtraBps:   the sender is debited `amount + extra` (extra is burned)    -> outbound over-debit
/// Both default to zero (a standard token).
contract V2FeeToken {
    string public name = "Fee USDC";
    string public symbol = "fUSDC";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 public recipientSkimBps;
    uint256 public senderExtraBps;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setFees(uint256 skimBps, uint256 extraBps) external {
        recipientSkimBps = skimBps;
        senderExtraBps = extraBps;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) private {
        uint256 extra = amount * senderExtraBps / 10_000;
        uint256 skim = amount * recipientSkimBps / 10_000;
        require(balanceOf[from] >= amount + extra, "balance");
        balanceOf[from] -= amount + extra;
        balanceOf[to] += amount - skim;
        totalSupply -= extra + skim;
        emit Transfer(from, to, amount - skim);
    }
}
