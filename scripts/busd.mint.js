const hre = require('hardhat');

const ADDRESS = '';
const AMOUNT = '10000';
const AMOUNT_WEI = hre.ethers.utils.parseEther(AMOUNT);

async function main() {
  const network = (process.env.HARDHAT_NETWORK === 'mainnet')
    ? 'mainnet'
    : 'testnet';

  if (network === 'mainnet') {
    throw new Error('Running in mainnet is not supported');
  }

  const contract = await hre.ethers.getContractAt('contracts/test/BUSD.sol:BUSD', '');

  console.log(`Minting ${AMOUNT} BUSD for '${ADDRESS}'...`);
  const mintResponse = await (await contract.transfer(ADDRESS, AMOUNT_WEI)).wait();
  console.log(mintResponse);
  console.log(`Minted ${AMOUNT} BUSD for '${ADDRESS}'`);

  const balance = await contract.balanceOf(ADDRESS);
  console.log(`${ADDRESS} now has ${ethers.utils.formatEther(balance)} BUSD`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
