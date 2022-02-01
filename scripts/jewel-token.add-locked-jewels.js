const hre = require('hardhat');
const {S3} = require('aws-sdk');

require('dotenv').config();

const ADDRESS = '';
const AMOUNT = '1000';
const AMOUNT_WEI = hre.ethers.utils.parseEther(AMOUNT);

async function main() {
  const network = (process.env.HARDHAT_NETWORK === 'mainnet')
    ? 'mainnet'
    : 'testnet';

  if (network === 'mainnet') {
    throw new Error('Running in mainnet is not supported');
  }

  const CONTRACT_ADDRESS = await getContractAddressFromS3(network);

  const contract = await hre.ethers.getContractAt('contracts/test/JewelToken.sol:JewelToken', CONTRACT_ADDRESS);

  console.log(`Minting ${AMOUNT} JEWELs for '${ADDRESS}'...`);
  const mintResponse = await (await contract.mint(ADDRESS, AMOUNT_WEI)).wait();
  console.log(mintResponse);

  console.log(`Locking ${AMOUNT} JEWELs for '${ADDRESS}'...`);
  const lockResponse = await (await contract.lock(ADDRESS, AMOUNT_WEI)).wait();
  console.log(lockResponse);

  console.log(`Minted and locked ${AMOUNT} JEWELs for '${ADDRESS}'`);
}

async function getContractAddressFromS3(network) {
  const {AWS_DEFAULT_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET} = process.env;
  const s3 = new S3({
    credentials: {accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY},
    region: AWS_DEFAULT_REGION
  });

  const addressData = await s3.getObject({ Bucket: AWS_S3_BUCKET, Key: `${network}/addresses/JewelToken.json` }).promise();
  return JSON.parse(addressData.Body).address;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
