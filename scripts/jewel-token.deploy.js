const hre = require('hardhat');

async function main() {
  const network = (process.env.HARDHAT_NETWORK === 'mainnet')
    ? 'mainnet'
    : 'testnet';

  if (network === 'mainnet') {
    throw new Error('Deploying to mainnet is not supported');
  }

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = deployer.address;
  const deployerBalance = await deployer.getBalance();

  console.log(`Deploying JewelToken contract with the account: ${deployerAddress}, balance (${deployerBalance}) in ${network}`);
  const contractFactory = await hre.ethers.getContractFactory('contracts/test/JewelToken.sol:JewelToken');
  // I couldn't decode original constructor parameters from ABI, so I used arbitrary ones.
  const maxSupply = hre.ethers.utils.parseEther('1000000');
  const contract = await contractFactory.deploy('Jewels', 'JEWEL', maxSupply, '10', '20000000', '22000000');
  await contract.deployed();

  console.log(`JewelToken contract address: ${contract.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
