// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract JewelSwapWallet {
    address private owner;
    bool private initialized;
    JewelToken jewelContract;

    function initialize(address _jewelContract) external {
        require(!initialized, "already initialized");
        owner = msg.sender;
        initialized = true;
        jewelContract = JewelToken(_jewelContract);
    }

    function transferAll(address _to) external {
        require(initialized, "not initialized");
        require(owner == msg.sender, "caller is not the owner");

        jewelContract.transferAll(_to);
    }
}

contract JewelToken {

    function transferAll(address _to) public {}

}