const hre = require('hardhat');

async function main() {
  const network = (process.env.HARDHAT_NETWORK === 'mainnet')
    ? 'mainnet'
    : 'testnet';

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = deployer.address;
  const deployerBalance = await deployer.getBalance();

  console.log(`Deploying BUSD contract with the account: ${deployerAddress}, balance (${deployerBalance}) in ${network}`);
  const contractFactory = await hre.ethers.getContractFactory('contracts/test/BUSD.sol:BUSD');
  const contract = await contractFactory.deploy();
  await contract.deployed();

  console.log(`BUSD contract address: ${contract.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
