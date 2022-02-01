import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-etherscan';
import {HardhatUserConfig} from 'hardhat/types';
import dotenv from 'dotenv';

dotenv.config();

const {OWNER_ACCOUNT_PK, OTHER_ACCOUNT_1_PK, OTHER_ACCOUNT_2_PK, ETHERSCAN_API_KEY} = process.env;
const OWNER_ACCOUNT = `0x${OWNER_ACCOUNT_PK}`;
const OTHER_ACCOUNT_1 = `0x${OTHER_ACCOUNT_1_PK}`;
const OTHER_ACCOUNT_2 = `0x${OTHER_ACCOUNT_2_PK}`;

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  solidity: {
    compilers: [
      // JewelSwap contracts.
      {
        version: '0.8.4',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        },
      },
      // JewelToken contract.
      {
        version: '0.6.12'
      }
    ],
  },
  networks: {
    mainnet: {
      url: `https://api.harmony.one`,
      accounts: [OWNER_ACCOUNT]
    },
    testnet: {
      url: `https://api.s0.b.hmny.io`,
      accounts: [OWNER_ACCOUNT, OTHER_ACCOUNT_1, OTHER_ACCOUNT_2],
      timeout: 60000,
      gas: 2100000,
      gasPrice: 30000000000
    }
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  mocha: {
    timeout: 40000
  }
};

export default config;
