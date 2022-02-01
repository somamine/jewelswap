const hre = require('hardhat');
const {S3} = require('aws-sdk');
const fs = require('fs');

require('dotenv').config();

async function main() {
  const network = (process.env.HARDHAT_NETWORK === 'mainnet')
    ? 'mainnet'
    : 'testnet';

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = deployer.address;
  const deployerBalance = await deployer.getBalance();

  console.log(`Deploying JewelSwapWallet contract with the account: ${deployerAddress}, balance (${deployerBalance}) in ${network}`);
  const contractFactory = await hre.ethers.getContractFactory('contracts/JewelSwapWallet.sol:JewelSwapWallet');
  const contract = await contractFactory.deploy();
  await contract.deployed();

  console.log(`JewelSwapWallet contract address: ${contract.address}`);

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
      name: 'abis/JewelSwapWallet.json',
      content: fs.readFileSync('artifacts/contracts/JewelSwapWallet.sol/JewelSwapWallet.json')
    },
    {
      name: 'addresses/JewelSwapWallet.json',
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
