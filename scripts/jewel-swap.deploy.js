const hre = require('hardhat');
const {S3} = require('aws-sdk');
const fs = require('fs');

require('dotenv').config();

const CONSTRUCTOR_PARAMETERS = {
  mainnet: {
    jewelSwapWallet: '',
    jewel: '0x72Cb10C6bfA5624dD07Ef608027E366bd690048F',
    usdc: '0x985458E523dB3d53125813eD68c274899e9DfAb4',
    usdt: '0x3C2B8Be99c50593081EAA2A724F0B8285F5aba8f',
    dai: '0xEf977d2f931C1978Db5F6747666fa1eACB0d0339',
    ust: '0x224e64ec1BDce3870a6a6c777eDd450454068FEC',
    busd: '0xE176EBE47d621b984a73036B9DA5d834411ef734'
  },
  testnet: {
    jewelSwapWallet: '',
    jewel: '0xf0053E397A22962A88CD999f1B6d0d0176E59EFF',
    usdc: '0x33B465B61EBb322E6336437b2624F705a34a0Df0',
    usdt: '0x12f839b098d1446ba9b25c4F6f7Ef49cc1846dEd',
    dai: '0xC27255D7805Fc79e4616d5CD50D6f4464AEa75A3',
    ust: '0x12b7146CC70F2F1422B3b11B116f10F1925d256A',
    busd: '0x0E80905676226159cC3FF62B1876C907C91F7395'
  }
};

async function main() {
  const network = (process.env.HARDHAT_NETWORK === 'mainnet')
    ? 'mainnet'
    : 'testnet';

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = deployer.address;
  const deployerBalance = await deployer.getBalance();

  console.log(`Deploying JewelSwap contract with the account: ${deployerAddress}, balance (${deployerBalance}) in ${network}`);

  const constructorParams = CONSTRUCTOR_PARAMETERS[network];

  console.log('Contract constructor parameters:', constructorParams);

  const contractFactory = await hre.ethers.getContractFactory('contracts/JewelSwap.sol:JewelSwap');
  const contract = await contractFactory.deploy(
    constructorParams.jewelSwapWallet,
    constructorParams.jewel,
    constructorParams.usdc,
    constructorParams.usdt,
    constructorParams.dai,
    constructorParams.ust,
    constructorParams.busd
  );
  await contract.deployed();
  console.log(`JewelSwap contract address: ${contract.address}`);

  await uploadContractInfoToS3(contract.address, network);
}

async function uploadContractInfoToS3(contractAddress, network) {
  const {AWS_DEFAULT_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET} = process.env;
  const s3 = new S3({
    credentials: {accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY},
    region: AWS_DEFAULT_REGION
  });

  const contractFiles = [
    {
      name: 'abis/JewelSwap.json',
      content: fs.readFileSync('artifacts/contracts/JewelSwap.sol/JewelSwap.json')
    },
    {
      name: 'addresses/JewelSwap.json',
      content: JSON.stringify({address: contractAddress})
    }
  ];

  for (const file of contractFiles) {
    console.log(`Uploading '${file.name}' to '${AWS_S3_BUCKET}/${network}'...`);

    const response = await s3.upload({
      Bucket: AWS_S3_BUCKET,
      Key: `${network}/${file.name}`,
      Body: file.content
    }).promise();
    console.log(`'${file.name}' file uploaded successfully - ${response.Location}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });