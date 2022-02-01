# jewelswap

jewelswap is a friendly yet feature-rich otc marketplace for locked jewel.  
it uses [hardhat](https://hardhat.org/).

## Contract Addresses
JewelSwap: [0x47B23347De82340b47820dD01B719D385D9Ba2B2](https://explorer.harmony.one/address/0x47B23347De82340b47820dD01B719D385D9Ba2B2)  
JewelSwapWallet: [0xA8BDf98e632e9d223DEA24Ce0B7f4d7C035170D6](https://explorer.harmony.one/address/0xA8BDf98e632e9d223DEA24Ce0B7f4d7C035170D6)

## Prerequisites

- [node.js](https://www.nodejs.org) - 14.x.x+
    * Follow instructions to install [nvm](https://github.com/nvm-sh/nvm)
    * Run `nvm` commands
      ```shell
      $ nvm install lts/fermium
      $ nvm use lts/fermium
      ```

## Project Setup

- Install project dependencies
    ```shell
    $ npm i
    ```
- Copy `example.env` file to `.env` file
    ```shell
    $ cp example.env .env
    ```
- Substitute environment variables in the `.env` file with the real values

## Commands

- Compile Solidity contract artifacts
    ```shell
    $ npx hardhat compile
    ```
- Clean Solidity contract artifacts
    ```shell
    $ npx hardhat clean
    ```
- Run tests
    ```shell
    $ npx hardhat test
    ```
- Run custom scripts
  > e.g. `npx hardhat run scripts/deploy.js`
    ```shell
    $ npx hardhat run <script-filepath>
    ```
- Run custom scripts in different networks
  > Network should be configured in `hardhat.config.js` file
    ```shell
    $ npx hardhat run <script-filepath> --network <network-name>
    ```
