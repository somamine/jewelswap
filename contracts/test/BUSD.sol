// Needed just for testing purposes.

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract BUSD is ERC20 {
    constructor() ERC20("BUSD", "BUSD") {
        _mint(msg.sender, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
    }
}
