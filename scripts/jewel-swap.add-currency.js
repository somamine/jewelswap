const hre = require('hardhat');
const {S3} = require('aws-sdk');

require('dotenv').config();

const CURRENCY = '';

async function main() {
  const network = (process.env.HARDHAT_NETWORK === 'mainnet')
    ? 'mainnet'
    : 'testnet';

  if (network === 'mainnet') {
    throw new Error('Running in mainnet is not supported');
  }

  const CONTRACT_ADDRESS = await getContractAddressFromS3(network);

  const contract = await hre.ethers.getContractAt('contracts/JewelSwap.sol:JewelSwap', CONTRACT_ADDRESS);

  console.log(`Adding currency: '${CURRENCY}'...`);
  const addCurrencyResponse = await (await contract.addCurrency(CURRENCY)).wait();
  console.log(addCurrencyResponse);
  console.log(`Added currency: '${CURRENCY}'`);
}

async function getContractAddressFromS3(network) {
  const {AWS_DEFAULT_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET} = process.env;
  const s3 = new S3({
    credentials: {accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY},
    region: AWS_DEFAULT_REGION
  });

  const addressData = await s3.getObject({ Bucket: AWS_S3_BUCKET, Key: `${network}/addresses/JewelSwap.json` }).promise();
  return JSON.parse(addressData.Body).address;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
