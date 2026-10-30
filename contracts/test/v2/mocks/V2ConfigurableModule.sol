// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Deliberately imperfect module for ERC-165 / treasury() validation tests.
/// Every behaviour is switched by constructor flags; none of them can be changed later.
contract V2ConfigurableModule {
    address public immutable core;
    bool public immutable supportErc165; // answers true for the ERC-165 id (0x01ffc9a7)
    bool public immutable supportModule; // answers true for the ITreasuryModule id
    bool public immutable supportFFFF; // wrongly answers true for 0xffffffff
    bool public immutable revertSupports; // supportsInterface always reverts
    bool public immutable hogGas; // supportsInterface burns all gas
    bool public immutable revertTreasury; // treasury() reverts

    constructor(address core_, bool erc165, bool module_, bool ffff, bool revertSupports_, bool hogGas_, bool revertTreasury_) {
        core = core_;
        supportErc165 = erc165;
        supportModule = module_;
        supportFFFF = ffff;
        revertSupports = revertSupports_;
        hogGas = hogGas_;
        revertTreasury = revertTreasury_;
    }

    function treasury() external view returns (address) {
        require(!revertTreasury, "treasury");
        return core;
    }

    function supportsInterface(bytes4 id) external view returns (bool) {
        require(!revertSupports, "supports");
        if (hogGas) {
            uint256 i;
            while (true) { ++i; }
        }
        if (id == 0xffffffff) return supportFFFF;
        if (id == 0x01ffc9a7) return supportErc165;
        return supportModule;
    }

    function onApproved(uint256, uint8, bytes calldata) external {}
}

/// @notice Contract with code but no ERC-165 and no treasury().
contract V2PlainContract {
    uint256 public marker = 1;
}
