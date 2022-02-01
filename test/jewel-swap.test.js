const chai = require('chai');
const {expect} = require('chai');
const {ethers} = require('hardhat');
const {solidity} = require('ethereum-waffle');
const {BigNumber} = require('ethers');

chai.use(solidity);

describe('JewelSwap contract tests', () => {
  /**
   * @type import('@ethersproject/contracts').Contract
   */
  let jewelTokenContract;
  let jewelSwapWalletContract;
  let jewelSwapContract;
  let busdContract;
  let ownerAccount;
  let otherAccount1;
  let otherAccount2;

  const WALLET_STATES = {
    CREATED: 0,
    SOLD: 1,
    CANCELED: 2
  };

  const DEFAULT_CONTRACT_PROPERTIES = {
    FEE: 20,
    FEE_PAYMENT_ADDRESS: '0x6616E63C042fB0ff73E2F58CC92bB0BFf43eF2cf',
    FEE_GRACE_PERIOD_AMOUNT: ethers.utils.parseEther('1000000')
  };

  // Testnet.
  const CONSTRUCTOR_PARAMETERS = {
    USDC: '0x33B465B61EBb322E6336437b2624F705a34a0Df0',
    USDT: '0x12f839b098d1446ba9b25c4F6f7Ef49cc1846dEd',
    DAI: '0xC27255D7805Fc79e4616d5CD50D6f4464AEa75A3',
    UST: '0x12b7146CC70F2F1422B3b11B116f10F1925d256A'
  };

  const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';

  const validateErrorMessage = async (asyncFunc, expectedErrorMsg) => {
    try {
      await asyncFunc();
      throw new Error('No throw');
    } catch (err) {
      expect(err.message).to.contain(expectedErrorMsg);
    }
  };

  const addLockedJewels = async (account, amount) => {
    const address = account.address;
    const amountWei = ethers.utils.parseEther(amount);

    jewelTokenContract = jewelTokenContract.connect(ownerAccount);
    await jewelTokenContract.mint(address, amountWei);
    await jewelTokenContract.lock(address, amountWei);
  };

  const addBusd = async (account, amount) => {
    const address = account.address;
    const amountWei = ethers.utils.parseEther(amount);

    busdContract = busdContract.connect(ownerAccount);
    await busdContract.approve(address, amountWei);

    busdContract = busdContract.connect(account);
    await busdContract.transferFrom(ownerAccount.address, address, amountWei);
  };

  const secondsFromUnixEpoch = (addSeconds = 0) => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    return BigNumber.from(nowSeconds + addSeconds);
  };

  const initialiseContracts = async () => {
    [ownerAccount, otherAccount1, otherAccount2] = await ethers.getSigners();

    const busdContractFactory = await ethers.getContractFactory('contracts/test/BUSD.sol:BUSD');
    busdContract = await busdContractFactory.deploy();
    await busdContract.deployed();

    const jewelTokenContractFactory = await ethers.getContractFactory('contracts/test/JewelToken.sol:JewelToken');
    jewelTokenContract = await jewelTokenContractFactory.deploy(
      'Jewels',
      'JEWEL',
      ethers.utils.parseEther('1000000'),
      '10',
      '20000000',
      '22000000'
    );
    await jewelTokenContract.deployed();

    const jewelSwapWalletContractFactory = await ethers.getContractFactory('contracts/JewelSwapWallet.sol:JewelSwapWallet');
    jewelSwapWalletContract = await jewelSwapWalletContractFactory.deploy();
    await jewelSwapWalletContract.deployed();

    const jewelSwapContractFactory = await ethers.getContractFactory('contracts/JewelSwap.sol:JewelSwap');
    jewelSwapContract = await jewelSwapContractFactory.deploy(
      jewelSwapWalletContract.address,
      jewelTokenContract.address,
      CONSTRUCTOR_PARAMETERS.USDC,
      CONSTRUCTOR_PARAMETERS.USDT,
      CONSTRUCTOR_PARAMETERS.DAI,
      CONSTRUCTOR_PARAMETERS.UST,
      busdContract.address
    );
    await jewelSwapContract.deployed();
  };

  beforeEach(async () => {
    await initialiseContracts();
  });

  // Should be a first test in this suite so block.timestamp is not affected by other tests.
  it('should fail when guard checks fail on accepting a bid', async () => {
    // Invalid wallet ID.
    await validateErrorMessage(
      async () => await jewelSwapContract.acceptBid('5', otherAccount2.address),
      'invalid wallet id'
    );

    await addLockedJewels(otherAccount1, '100');

    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const wallet1Id = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('250'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, wallet1Id);

    // Only seller could accept bids for their swap.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);
    await validateErrorMessage(
      async () => await jewelSwapContract.acceptBid(wallet1Id, otherAccount2.address),
      'you are not the seller'
    );

    jewelSwapContract = jewelSwapContract.connect(otherAccount1);
    expect(
      await jewelSwapContract.cancelSwap(wallet1Id)
    ).to.emit(jewelSwapContract, 'CancelSwap').withArgs(otherAccount1.address, wallet1Id);

    // Invalid swap state (already canceled).
    await validateErrorMessage(
      async () => await jewelSwapContract.acceptBid(wallet1Id, otherAccount2.address),
      'swap already completed or canceled'
    );

    // SECOND SWAP.

    const wallet2Id = BigNumber.from('1');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('250'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, wallet2Id);

    // Fund the swap wallet with locked JEWEL tokens.
    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll((await jewelSwapContract.getWallet(wallet2Id)).walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    // No bid to accept.
    await validateErrorMessage(
      async () => await jewelSwapContract.acceptBid(wallet2Id, otherAccount2.address),
      'bid does not exist'
    );

    // Add tokens, approve spend and place a bid that will expire as soon as it is created.
    await addBusd(otherAccount2, '200');
    busdContract = busdContract.connect(otherAccount2);
    await busdContract.approve(jewelSwapContract.address, ethers.utils.parseEther('200'));

    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    expect(
      await jewelSwapContract.placeBid(
        wallet2Id,
        ethers.utils.parseEther('200'),
        busdContract.address,
        secondsFromUnixEpoch( 30)
      )
    ).to.emit(jewelSwapContract, 'PlaceBid').withArgs(otherAccount2.address, wallet2Id, false);

    // Sleep 30 seconds.
    await new Promise(r => setTimeout(r, 30000));

    // No valid bid to accept (bid expired).
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);
    await validateErrorMessage(
      async () => await jewelSwapContract.acceptBid(wallet2Id, otherAccount2.address),
      'invalid bid'
    );
  });

  it('should have correct owner and public properties right after deploy', async () => {
    expect(await jewelSwapContract.owner()).to.equal(ownerAccount.address);
    expect(await jewelSwapContract.fee()).to.equal(DEFAULT_CONTRACT_PROPERTIES.FEE);
    expect(await jewelSwapContract.feeGracePeriodAmount()).to.equal(DEFAULT_CONTRACT_PROPERTIES.FEE_GRACE_PERIOD_AMOUNT);
    expect(await jewelSwapContract.walletImplementation()).to.equal(jewelSwapWalletContract.address);
    expect(await jewelSwapContract.nextWalletId()).to.equal(0);
    expect(await jewelSwapContract.currencies(CONSTRUCTOR_PARAMETERS.USDC)).to.equal(true);
    expect(await jewelSwapContract.currencies(CONSTRUCTOR_PARAMETERS.USDT)).to.equal(true);
    expect(await jewelSwapContract.currencies(CONSTRUCTOR_PARAMETERS.UST)).to.equal(true);
    expect(await jewelSwapContract.currencies(busdContract.address)).to.equal(true);
    expect(await jewelSwapContract.currencies(CONSTRUCTOR_PARAMETERS.DAI)).to.equal(true);
  });

  it('should fail when non-owner tries to access owner-only methods', async () => {
    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const ERROR_MSG = 'Ownable: caller is not the owner';
    await validateErrorMessage(async () => await jewelSwapContract.setMaxExpiryInterval(604800), ERROR_MSG);
    await validateErrorMessage(async () => await jewelSwapContract.setFee(DEFAULT_CONTRACT_PROPERTIES.FEE), ERROR_MSG);
    await validateErrorMessage(async () => await jewelSwapContract.setFeeGracePeriodAmount(DEFAULT_CONTRACT_PROPERTIES.FEE_GRACE_PERIOD_AMOUNT), ERROR_MSG);
    await validateErrorMessage(async () => await jewelSwapContract.setFeePaymentAddress(DEFAULT_CONTRACT_PROPERTIES.FEE_PAYMENT_ADDRESS), ERROR_MSG);
    await validateErrorMessage(async () => await jewelSwapContract.addCurrency(CONSTRUCTOR_PARAMETERS.DAI), ERROR_MSG);
    await validateErrorMessage(async () => await jewelSwapContract.removeCurrency(CONSTRUCTOR_PARAMETERS.DAI), ERROR_MSG);
  });

  it('should set max expiry interval correctly', async () => {
    await jewelSwapContract.setMaxExpiryInterval(604800);
  });

  it('should manage currencies correctly', async () => {
    await jewelSwapContract.removeCurrency(CONSTRUCTOR_PARAMETERS.DAI);
    await jewelSwapContract.addCurrency(CONSTRUCTOR_PARAMETERS.DAI);
  });

  it('should set fee, fee grace period amount and fee payment address correctly', async () => {
    await jewelSwapContract.setFee(DEFAULT_CONTRACT_PROPERTIES.FEE);
    await jewelSwapContract.setFeeGracePeriodAmount(DEFAULT_CONTRACT_PROPERTIES.FEE_GRACE_PERIOD_AMOUNT);
    await jewelSwapContract.setFeePaymentAddress(DEFAULT_CONTRACT_PROPERTIES.FEE_PAYMENT_ADDRESS);
  });

  it('should return wallet with nullish properties if getting non-existing wallet', async () => {
    const nonExistingWallet = await jewelSwapContract.getWallet('123');

    expect(nonExistingWallet).to.not.be.null;
    expect(nonExistingWallet.walletAddress).to.equal(NULL_ADDRESS);
    expect(nonExistingWallet.seller).to.equal(NULL_ADDRESS);
    expect(nonExistingWallet.buyer).to.equal(NULL_ADDRESS);
    expect(nonExistingWallet.ask).to.not.be.null;
    expect(nonExistingWallet.ask.amount).to.equal(BigNumber.from('0'));
    expect(nonExistingWallet.ask.currency).to.equal(NULL_ADDRESS);
    expect(nonExistingWallet.sale).to.not.be.null;
    expect(nonExistingWallet.sale.lockedJewelAmount).to.equal(BigNumber.from('0'));
    expect(nonExistingWallet.sale.amount).to.equal(BigNumber.from('0'));
    expect(nonExistingWallet.sale.currency).to.equal(NULL_ADDRESS);
    expect(nonExistingWallet.sale.buyer).to.equal(NULL_ADDRESS);
    expect(nonExistingWallet.state).to.equal(0);
    expect(nonExistingWallet.lockedJewelAmount).to.equal(BigNumber.from('0'));
  });

  it('should fail when guard checks fail on creating a swap', async () => {
    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    // Invalid currency.
    await validateErrorMessage(async () => await jewelSwapContract.createSwap(
      '1',
      NULL_ADDRESS,
      NULL_ADDRESS
    ), 'invalid currency');
    await validateErrorMessage(async () => await jewelSwapContract.createSwap(
      '1',
      jewelTokenContract.address,
      NULL_ADDRESS
    ), 'invalid currency');

    // Amount less than 0.
    await validateErrorMessage(async () => await jewelSwapContract.createSwap(
      '0',
      CONSTRUCTOR_PARAMETERS.USDC,
      NULL_ADDRESS
    ), 'amount needs to be greater than zero');

    // Doesn't have locked JEWEL tokens.
    await validateErrorMessage(async () => await jewelSwapContract.createSwap(
      '1',
      CONSTRUCTOR_PARAMETERS.USDC,
      NULL_ADDRESS
    ), 'must have locked jewel');
  });

  it('should successfully create a swap', async () => {
    await addLockedJewels(otherAccount1, '100');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.USDC,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    const wallet = await jewelSwapContract.getWallet(walletId);
    expect(wallet.seller).to.equal(otherAccount1.address);
    expect(wallet.buyer).to.equal(otherAccount2.address);
    expect(wallet.state).to.equal(WALLET_STATES.CREATED);
    expect(wallet.ask.amount).to.equal(ethers.utils.parseEther('300'));
    expect(wallet.ask.currency).to.equal(CONSTRUCTOR_PARAMETERS.USDC);
    expect(wallet.lockedJewelAmount).to.equal(BigNumber.from('0'));

    expect(await jewelSwapContract.sellerWallets(otherAccount1.address, 0)).to.equal(walletId);
    expect(await jewelSwapContract.buyerWallets(otherAccount2.address, 0)).to.equal(walletId);
    expect(await jewelSwapContract.openSwaps(0)).to.equal(walletId);
  });

  it('should update existing swap if it exists, not funded and not sold', async () => {
    await addLockedJewels(otherAccount1, '100');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    let walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.USDC,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    const walletBeforeUpdate = await jewelSwapContract.getWallet(walletId);
    expect(walletBeforeUpdate.seller).to.equal(otherAccount1.address);
    expect(walletBeforeUpdate.buyer).to.equal(otherAccount2.address);
    expect(walletBeforeUpdate.state).to.equal(WALLET_STATES.CREATED);
    expect(walletBeforeUpdate.ask.amount).to.equal(ethers.utils.parseEther('300'));
    expect(walletBeforeUpdate.ask.currency).to.equal(CONSTRUCTOR_PARAMETERS.USDC);
    expect(walletBeforeUpdate.lockedJewelAmount).to.equal(BigNumber.from('0'));

    expect(await jewelSwapContract.sellerWallets(otherAccount1.address, 0)).to.equal(walletId);
    expect(await jewelSwapContract.buyerWallets(otherAccount2.address, 0)).to.equal(walletId);
    expect(await jewelSwapContract.openSwaps(0)).to.equal(walletId);

    expect(
      await jewelSwapContract.createSwap('500', CONSTRUCTOR_PARAMETERS.USDT, NULL_ADDRESS)
    ).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    const walletAfterUpdate = await jewelSwapContract.getWallet(walletId);
    expect(walletAfterUpdate.seller).to.equal(otherAccount1.address);
    expect(walletAfterUpdate.buyer).to.equal(NULL_ADDRESS);
    expect(walletAfterUpdate.state).to.equal(WALLET_STATES.CREATED);
    expect(walletAfterUpdate.ask.amount).to.equal(BigNumber.from('500'));
    expect(walletAfterUpdate.ask.currency).to.equal(CONSTRUCTOR_PARAMETERS.USDT);
    expect(walletAfterUpdate.lockedJewelAmount).to.equal(BigNumber.from('0'));

    expect(await jewelSwapContract.sellerWallets(otherAccount1.address, 0)).to.equal(walletId);
    expect(await jewelSwapContract.buyerWallets(NULL_ADDRESS, 0)).to.equal(walletId);
    validateErrorMessage(async () => await jewelSwapContract.buyerWallets(otherAccount2.address, 0), 'Transaction reverted without a reason string');
    expect(await jewelSwapContract.openSwaps(0)).to.equal(walletId);
  });

  it('should successfully create a swap and transfer locked JEWEL tokens to it', async () => {
    await addLockedJewels(otherAccount1, '100');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.USDC,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    const walletAddress = (await jewelSwapContract.getWallet(walletId)).walletAddress;
    expect(await jewelSwapContract.openSwaps(0)).to.equal(walletId);

    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll(walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    const walletLockedJewelAmount = (await jewelSwapContract.getWallet(walletId)).lockedJewelAmount;
    expect(walletLockedJewelAmount).to.equal(ethers.utils.parseEther('100'));
  });

  it('should successfully create a swap, transfer locked JEWEL tokens to it and cancel it', async () => {
    await addLockedJewels(otherAccount1, '100');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.USDC,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);
    const walletAddress = (await jewelSwapContract.getWallet(walletId)).walletAddress;
    expect(await jewelSwapContract.openSwaps(0)).to.equal(walletId);

    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll(walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    const walletLockedJewelAmount = (await jewelSwapContract.getWallet(walletId)).lockedJewelAmount;
    expect(walletLockedJewelAmount).to.equal(ethers.utils.parseEther('100'));

    expect(
      await jewelSwapContract.cancelSwap(walletId)
    ).to.emit(jewelSwapContract, 'CancelSwap').withArgs(otherAccount1.address, walletId);
    const wallet = await jewelSwapContract.getWallet(walletId);
    expect(wallet.state).to.equal(WALLET_STATES.CANCELED);
    expect(await jewelSwapContract.canceledSwaps(0)).to.equal(walletId);
    validateErrorMessage(async () => await jewelSwapContract.openSwaps(0), 'Transaction reverted without a reason string');

    expect(wallet.lockedJewelAmount).to.equal(BigNumber.from('0'));
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(ethers.utils.parseEther('100'));
  });

  it('should fail when guard checks fail on canceling a swap', async () => {
    await addLockedJewels(otherAccount1, '100');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    // Invalid wallet ID.
    await validateErrorMessage(async () => await jewelSwapContract.cancelSwap('5'), 'invalid wallet id');

    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.USDC,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    // Use another non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Only seller could cancel their swap.
    await validateErrorMessage(async () => await jewelSwapContract.cancelSwap(walletId), 'you are not the seller');

    // Use original non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    expect(
      await jewelSwapContract.cancelSwap(walletId)
    ).to.emit(jewelSwapContract, 'CancelSwap').withArgs(otherAccount1.address, walletId);

    // Invalid swap state (already canceled).
    await validateErrorMessage(async () => await jewelSwapContract.cancelSwap(walletId), 'swap already completed or canceled');
  });

  it('should successfully create a swap, transfer locked JEWEL tokens to it and sell it', async () => {
    await addLockedJewels(otherAccount1, '100');
    await addBusd(otherAccount2, '700');

    expect(await busdContract.balanceOf(otherAccount2.address)).to.equal(ethers.utils.parseEther('700'));
    expect(await busdContract.balanceOf(otherAccount1.address)).to.equal(ethers.utils.parseEther('0'));
    expect(await busdContract.balanceOf(DEFAULT_CONTRACT_PROPERTIES.FEE_PAYMENT_ADDRESS)).to.equal(ethers.utils.parseEther('0'));

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    expect(await jewelSwapContract.getTotalVolumeTraded()).to.equal(BigNumber.from('0'));

    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('500'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);
    const walletAddress = (await jewelSwapContract.getWallet(walletId)).walletAddress;
    expect(await jewelSwapContract.openSwaps(0)).to.equal(walletId);

    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll(walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    const walletLockedJewelAmount = (await jewelSwapContract.getWallet(walletId)).lockedJewelAmount;
    expect(walletLockedJewelAmount).to.equal(ethers.utils.parseEther('100'));

    // Use another non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Approve spend.
    busdContract = busdContract.connect(otherAccount2);
    await busdContract.approve(jewelSwapContract.address, ethers.utils.parseEther('500'));

    // Accept swap.
    expect(
      await jewelSwapContract.acceptSwap(walletId)
    ).to.emit(jewelSwapContract, 'AcceptSwap').withArgs(otherAccount2.address, walletId);

    const wallet = await jewelSwapContract.getWallet(walletId);
    expect(wallet.state).to.equal(WALLET_STATES.SOLD);
    expect(await jewelSwapContract.completedSwaps(0)).to.equal(walletId);
    validateErrorMessage(async () => await jewelSwapContract.openSwaps(0), 'Transaction reverted without a reason string');

    expect(await jewelSwapContract.getTotalVolumeTraded()).to.equal(ethers.utils.parseEther('500'));

    expect(wallet.lockedJewelAmount).to.equal(BigNumber.from('0'));
    expect(await jewelTokenContract.lockOf(otherAccount2.address)).to.equal(ethers.utils.parseEther('100'));

    expect(await busdContract.balanceOf(otherAccount2.address)).to.equal(ethers.utils.parseEther('200'));
    expect(await busdContract.balanceOf(otherAccount1.address)).to.equal(ethers.utils.parseEther('500'));
    expect(await busdContract.balanceOf(DEFAULT_CONTRACT_PROPERTIES.FEE_PAYMENT_ADDRESS)).to.equal(BigNumber.from('0'));
  });

  it('should successfully create swaps, transfer locked JEWEL tokens to them and sell them with different fees', async () => {
    await addLockedJewels(otherAccount1, '100');
    await addBusd(otherAccount2, '1500');

    // Set fee grace period to a lower value.
    await jewelSwapContract.setFeeGracePeriodAmount(ethers.utils.parseEther('1000'));

    // FIRST SWAP.

    // Check balances.
    expect(await busdContract.balanceOf(otherAccount2.address)).to.equal(ethers.utils.parseEther('1500'));
    expect(await busdContract.balanceOf(otherAccount1.address)).to.equal(ethers.utils.parseEther('0'));
    expect(await busdContract.balanceOf(DEFAULT_CONTRACT_PROPERTIES.FEE_PAYMENT_ADDRESS)).to.equal(ethers.utils.parseEther('0'));
    expect(await jewelSwapContract.getTotalVolumeTraded()).to.equal(BigNumber.from('0'));

    jewelSwapContract = jewelSwapContract.connect(otherAccount1);
    const wallet1Id = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('700'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, wallet1Id);
    const wallet1Address = (await jewelSwapContract.getWallet(wallet1Id)).walletAddress;
    expect(await jewelSwapContract.openSwaps(0)).to.equal(wallet1Id);

    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll(wallet1Address);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    const wallet1LockedJewelAmount = (await jewelSwapContract.getWallet(wallet1Id)).lockedJewelAmount;
    expect(wallet1LockedJewelAmount).to.equal(ethers.utils.parseEther('100'));

    // Use another non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Approve spend.
    busdContract = busdContract.connect(otherAccount2);
    await busdContract.approve(jewelSwapContract.address, ethers.utils.parseEther('700'));

    // Accept swap.
    expect(
      await jewelSwapContract.acceptSwap(wallet1Id)
    ).to.emit(jewelSwapContract, 'AcceptSwap').withArgs(otherAccount2.address, wallet1Id);

    const wallet1 = await jewelSwapContract.getWallet(wallet1Id);
    expect(wallet1.state).to.equal(WALLET_STATES.SOLD);
    expect(await jewelSwapContract.completedSwaps(0)).to.equal(wallet1Id);
    validateErrorMessage(async () => await jewelSwapContract.openSwaps(0), 'Transaction reverted without a reason string');

    expect(wallet1.lockedJewelAmount).to.equal(BigNumber.from('0'));
    expect(await jewelTokenContract.lockOf(otherAccount2.address)).to.equal(ethers.utils.parseEther('100'));

    // Check balances.
    expect(await busdContract.balanceOf(otherAccount2.address)).to.equal(ethers.utils.parseEther('800'));
    expect(await busdContract.balanceOf(otherAccount1.address)).to.equal(ethers.utils.parseEther('700'));
    // No fee was taken because of the grace period.
    expect(await busdContract.balanceOf(DEFAULT_CONTRACT_PROPERTIES.FEE_PAYMENT_ADDRESS)).to.equal(BigNumber.from('0'));
    expect(await jewelSwapContract.getTotalVolumeTraded()).to.equal(ethers.utils.parseEther('700'));

    // SECOND SWAP.

    jewelSwapContract = jewelSwapContract.connect(ownerAccount);
    await addLockedJewels(otherAccount1, '50');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const wallet2Id = BigNumber.from('1');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('400'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, wallet2Id);

    const wallet2Address = (await jewelSwapContract.getWallet(wallet2Id)).walletAddress;
    expect(await jewelSwapContract.openSwaps(0)).to.equal(wallet2Id);

    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll(wallet2Address);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    const wallet2LockedJewelAmount = (await jewelSwapContract.getWallet(wallet2Id)).lockedJewelAmount;
    expect(wallet2LockedJewelAmount).to.equal(ethers.utils.parseEther('50'));

    // Use another non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Approve spend.
    busdContract = busdContract.connect(otherAccount2);
    await busdContract.approve(jewelSwapContract.address, ethers.utils.parseEther('400'));

    // Accept swap.
    expect(
      await jewelSwapContract.acceptSwap(wallet2Id)
    ).to.emit(jewelSwapContract, 'AcceptSwap').withArgs(otherAccount2.address, wallet2Id);

    const wallet2 = await jewelSwapContract.getWallet(wallet2Id);
    expect(wallet2.state).to.equal(WALLET_STATES.SOLD);
    expect(await jewelSwapContract.completedSwaps(1)).to.equal(wallet2Id);
    validateErrorMessage(async () => await jewelSwapContract.openSwaps(0), 'Transaction reverted without a reason string');

    expect(wallet2.lockedJewelAmount).to.equal(BigNumber.from('0'));
    expect(await jewelTokenContract.lockOf(otherAccount2.address)).to.equal(ethers.utils.parseEther('150'));

    // Check balances.
    expect(await busdContract.balanceOf(otherAccount2.address)).to.equal(ethers.utils.parseEther('400'));
    expect(await busdContract.balanceOf(otherAccount1.address)).to.equal(ethers.utils.parseEther('1098'));
    // Partial fee was taken because of the tx happening on the edge of the grace period.
    expect(await busdContract.balanceOf(DEFAULT_CONTRACT_PROPERTIES.FEE_PAYMENT_ADDRESS)).to.equal(ethers.utils.parseEther('2'));
    expect(await jewelSwapContract.getTotalVolumeTraded()).to.equal(ethers.utils.parseEther('1100'));

    // THIRD SWAP.

    jewelSwapContract = jewelSwapContract.connect(ownerAccount);
    await addLockedJewels(otherAccount1, '60');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const wallet3Id = BigNumber.from('2');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('400'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, wallet3Id);
    const wallet3Address = (await jewelSwapContract.getWallet(wallet3Id)).walletAddress;
    expect(await jewelSwapContract.openSwaps(0)).to.equal(wallet3Id);

    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll(wallet3Address);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    const wallet3LockedJewelAmount = (await jewelSwapContract.getWallet(wallet3Id)).lockedJewelAmount;
    expect(wallet3LockedJewelAmount).to.equal(ethers.utils.parseEther('60'));

    // Use another non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Approve spend.
    busdContract = busdContract.connect(otherAccount2);
    await busdContract.approve(jewelSwapContract.address, ethers.utils.parseEther('400'));

    // Accept swap.
    expect(
      await jewelSwapContract.acceptSwap(wallet3Id)
    ).to.emit(jewelSwapContract, 'AcceptSwap').withArgs(otherAccount2.address, wallet3Id);

    const wallet3 = await jewelSwapContract.getWallet(wallet3Id);
    expect(wallet3.state).to.equal(WALLET_STATES.SOLD);
    expect(await jewelSwapContract.completedSwaps(2)).to.equal(wallet3Id);
    validateErrorMessage(async () => await jewelSwapContract.openSwaps(0), 'Transaction reverted without a reason string');

    expect(wallet3.lockedJewelAmount).to.equal(BigNumber.from('0'));
    expect(await jewelTokenContract.lockOf(otherAccount2.address)).to.equal(ethers.utils.parseEther('210'));

    // Check balances.
    expect(await busdContract.balanceOf(otherAccount2.address)).to.equal(ethers.utils.parseEther('0'));
    expect(await busdContract.balanceOf(otherAccount1.address)).to.equal(ethers.utils.parseEther('1490'));
    // Full fee was taken because the grace period has finished.
    expect(await busdContract.balanceOf(DEFAULT_CONTRACT_PROPERTIES.FEE_PAYMENT_ADDRESS)).to.equal(ethers.utils.parseEther('10'));
    expect(await jewelSwapContract.getTotalVolumeTraded()).to.equal(ethers.utils.parseEther('1500'));
  });

  it('should fail when guard checks fail on accepting a swap', async () => {
    await addLockedJewels(otherAccount1, '100');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    // Invalid wallet ID.
    await validateErrorMessage(async () => await jewelSwapContract.acceptSwap('5'), 'invalid wallet id');

    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.USDC,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    // Can't accept a swap created for a specific other account.
    await validateErrorMessage(async () => await jewelSwapContract.acceptSwap(walletId), 'private swap not created for you');

    expect(
      await jewelSwapContract.cancelSwap(walletId)
    ).to.emit(jewelSwapContract, 'CancelSwap').withArgs(otherAccount1.address, walletId);

    // Use another non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Invalid swap state (canceled).
    await validateErrorMessage(async () => await jewelSwapContract.acceptSwap(walletId), 'swap already completed or canceled');
  });

  it('should successfully update an existing swap', async () => {
    await addLockedJewels(otherAccount1, '50');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.DAI,
      NULL_ADDRESS
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    const walletBeforeUpdate = await jewelSwapContract.getWallet(walletId);
    expect(walletBeforeUpdate.seller).to.equal(otherAccount1.address);
    expect(walletBeforeUpdate.buyer).to.equal(NULL_ADDRESS);
    expect(walletBeforeUpdate.state).to.equal(WALLET_STATES.CREATED);
    expect(walletBeforeUpdate.ask.amount).to.equal(ethers.utils.parseEther('300'));
    expect(walletBeforeUpdate.ask.currency).to.equal(CONSTRUCTOR_PARAMETERS.DAI);
    expect(walletBeforeUpdate.lockedJewelAmount).to.equal(BigNumber.from('0'));

    expect(await jewelSwapContract.sellerWallets(otherAccount1.address, 0)).to.equal(walletId);
    expect(await jewelSwapContract.buyerWallets(NULL_ADDRESS, 0)).to.equal(walletId);
    expect(await jewelSwapContract.openSwaps(0)).to.equal(walletId);

    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll(walletBeforeUpdate.walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    const walletLockedJewelAmount = (await jewelSwapContract.getWallet(walletId)).lockedJewelAmount;
    expect(walletLockedJewelAmount).to.equal(ethers.utils.parseEther('50'));

    expect(await jewelSwapContract.updateSwap(walletId, ethers.utils.parseEther('700'), CONSTRUCTOR_PARAMETERS.USDC))
      .to
      .emit(jewelSwapContract, 'UpdateSwap')
      .withArgs(otherAccount1.address, walletId, CONSTRUCTOR_PARAMETERS.USDC, ethers.utils.parseEther('700'));

    const walletAfterUpdate = await jewelSwapContract.getWallet(walletId);
    expect(walletAfterUpdate.seller).to.equal(otherAccount1.address);
    expect(walletAfterUpdate.buyer).to.equal(NULL_ADDRESS);
    expect(walletAfterUpdate.state).to.equal(WALLET_STATES.CREATED);
    expect(walletAfterUpdate.ask.amount).to.equal(ethers.utils.parseEther('700'));
    expect(walletAfterUpdate.ask.currency).to.equal(CONSTRUCTOR_PARAMETERS.USDC);
  });

  it('should fail when guard checks fail on updating a swap', async () => {
    await addLockedJewels(otherAccount1, '100');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    // Invalid wallet ID.
    await validateErrorMessage(
      async () => await jewelSwapContract.updateSwap('5', ethers.utils.parseEther('150'), CONSTRUCTOR_PARAMETERS.USDC),
      'invalid wallet id'
    );

    const wallet1Id = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.USDC,
      NULL_ADDRESS
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, wallet1Id);

    // Use another non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Only seller could update their swap.
    await validateErrorMessage(
      async () => await jewelSwapContract.updateSwap(wallet1Id, ethers.utils.parseEther('150'), CONSTRUCTOR_PARAMETERS.USDC),
      'you are not the seller'
    );

    // Use original non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    expect(
      await jewelSwapContract.cancelSwap(wallet1Id)
    ).to.emit(jewelSwapContract, 'CancelSwap').withArgs(otherAccount1.address, wallet1Id);

    // Invalid swap state (already canceled).
    await validateErrorMessage(
      async () => await jewelSwapContract.updateSwap(wallet1Id, ethers.utils.parseEther('150'), CONSTRUCTOR_PARAMETERS.USDC),
      'swap already completed or canceled'
    );

    const wallet2Id = BigNumber.from('1');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.USDC,
      NULL_ADDRESS
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, wallet2Id);

    // Swap must be funded with locked JEWEL tokens.
    await validateErrorMessage(
      async () => await jewelSwapContract.updateSwap(wallet2Id, ethers.utils.parseEther('150'), CONSTRUCTOR_PARAMETERS.USDC),
      'swap must be funded with locked jewel'
    );

    // Fund the swap wallet with locked JEWEL tokens.
    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll((await jewelSwapContract.getWallet(wallet2Id)).walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    // Unsupported currency.
    await validateErrorMessage(
      async () => await jewelSwapContract.updateSwap(wallet2Id, ethers.utils.parseEther('150'), NULL_ADDRESS),
      'invalid currency'
    );
    await validateErrorMessage(
      async () => await jewelSwapContract.updateSwap(wallet2Id, ethers.utils.parseEther('150'), jewelTokenContract.address),
      'invalid currency'
    );

    // Amount must be greater than zero.
    await validateErrorMessage(
      async () => await jewelSwapContract.updateSwap(wallet2Id, BigNumber.from('0'), CONSTRUCTOR_PARAMETERS.USDC),
      'amount needs to be greater than zero'
    );
  });

  it('should fail when guard checks fail on placing a bid', async () => {
    await addLockedJewels(otherAccount1, '100');

    // Use non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    // Invalid wallet ID.
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        '5',
        ethers.utils.parseEther('150'),
        CONSTRUCTOR_PARAMETERS.USDC,
        secondsFromUnixEpoch()
      ),
      'invalid wallet id'
    );

    const wallet1Id = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.USDC,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, wallet1Id);

    // Invalid currency.
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet1Id,
        ethers.utils.parseEther('150'),
        NULL_ADDRESS,
        secondsFromUnixEpoch()
      ),
      'invalid currency'
    );
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet1Id,
        ethers.utils.parseEther('150'),
        jewelTokenContract.address,
        secondsFromUnixEpoch()
      ),
      'invalid currency'
    );

    // Zero amount.
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet1Id,
        BigNumber.from('0'),
        CONSTRUCTOR_PARAMETERS.USDC,
        secondsFromUnixEpoch()
      ),
      'amount needs to be greater than zero'
    );

    // Expiry time is not in the future.
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet1Id,
        ethers.utils.parseEther('150'),
        CONSTRUCTOR_PARAMETERS.USDC,
        secondsFromUnixEpoch()
      ),
      'expiry time needs to be in the future'
    );

    // Expiry time is too far in the future.
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet1Id,
        ethers.utils.parseEther('150'),
        CONSTRUCTOR_PARAMETERS.USDC,
        secondsFromUnixEpoch(32 * 24 * 60 * 60)
      ),
      'expiry time needs to be less than one month in the future'
    );

    // Can't place bid on your own swap.
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet1Id,
        ethers.utils.parseEther('150'),
        CONSTRUCTOR_PARAMETERS.USDC,
        secondsFromUnixEpoch(3 * 24 * 60 * 60)
      ),
      'cannot bid on your own swap'
    );

    // Use another owner account.
    jewelSwapContract = jewelSwapContract.connect(ownerAccount);

    // Private swap not created for you.
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet1Id,
        ethers.utils.parseEther('150'),
        CONSTRUCTOR_PARAMETERS.USDC,
        secondsFromUnixEpoch(3 * 24 * 60 * 60)
      ),
      'private swap not created for you'
    );

    // Use another non-owner account.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Swap must be funded with locked JEWEL tokens.
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet1Id,
        ethers.utils.parseEther('150'),
        CONSTRUCTOR_PARAMETERS.USDC,
        secondsFromUnixEpoch(3 * 24 * 60 * 60)
      ),
      'swap must be funded with locked jewel'
    );

    // We intentionally cancel swap and then fund it with locked JEWEL tokens to get into an inccorect state.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);
    expect(
      await jewelSwapContract.cancelSwap(wallet1Id)
    ).to.emit(jewelSwapContract, 'CancelSwap').withArgs(otherAccount1.address, wallet1Id);

    // Fund the swap wallet with locked JEWEL tokens.
    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll((await jewelSwapContract.getWallet(wallet1Id)).walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Invalid swap state (already canceled).
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet1Id,
        ethers.utils.parseEther('150'),
        CONSTRUCTOR_PARAMETERS.USDC,
        secondsFromUnixEpoch(3 * 24 * 60 * 60)
      ),
      'swap already completed or canceled'
    );

    // SECOND SWAP.

    await addLockedJewels(otherAccount1, '100');

    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const wallet2Id = BigNumber.from('1');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      CONSTRUCTOR_PARAMETERS.USDC,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, wallet2Id);

    // Fund the swap wallet with locked JEWEL tokens.
    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll((await jewelSwapContract.getWallet(wallet2Id)).walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Not enough tokens to place a bid.
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet2Id,
        ethers.utils.parseEther('150'),
        busdContract.address,
        secondsFromUnixEpoch(3 * 24 * 60 * 60)
      ),
      'you do not have enough tokens'
    );

    await addBusd(otherAccount2, '150');

    // Not enough approved tokens to place a bid.
    await validateErrorMessage(
      async () => await jewelSwapContract.placeBid(
        wallet2Id,
        ethers.utils.parseEther('150'),
        busdContract.address,
        secondsFromUnixEpoch(3 * 24 * 60 * 60)
      ),
      'you do not have enough tokens approved'
    );
  });

  it('should successfully place a new bid and update it in-place', async () => {
    await addLockedJewels(otherAccount1, '100');

    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('300'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    // Fund the swap wallet with locked JEWEL tokens.
    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll((await jewelSwapContract.getWallet(walletId)).walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    await addBusd(otherAccount2, '250');

    // Approve spend.
    busdContract = busdContract.connect(otherAccount2);
    await busdContract.approve(jewelSwapContract.address, ethers.utils.parseEther('250'));

    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    const expirationTime1 = secondsFromUnixEpoch(3 * 24 * 60 * 60);
    expect(
      await jewelSwapContract.placeBid(
        walletId,
        ethers.utils.parseEther('150'),
        busdContract.address,
        expirationTime1
      )
    ).to.emit(jewelSwapContract, 'PlaceBid').withArgs(otherAccount2.address, walletId, false);
    expect(await jewelSwapContract.buyerBids(otherAccount2.address, 0)).to.equal(walletId);

    const bid1 = (await jewelSwapContract.getBuyerBids([walletId], otherAccount2.address))[0];
    expect(bid1.amount).to.equal(ethers.utils.parseEther('150'));
    expect(bid1.currency).to.equal(busdContract.address);
    expect(bid1.buyer).to.equal(otherAccount2.address);
    expect(bid1.expiryTime).to.equal(expirationTime1);

    const expirationTime2 = secondsFromUnixEpoch(2 * 24 * 60 * 60);
    expect(
      await jewelSwapContract.placeBid(
        walletId,
        ethers.utils.parseEther('230'),
        busdContract.address,
        expirationTime2
      )
    ).to.emit(jewelSwapContract, 'PlaceBid').withArgs(otherAccount2.address, walletId, false);
    expect(await jewelSwapContract.buyerBids(otherAccount2.address, 0)).to.equal(walletId);

    const bid2 = (await jewelSwapContract.getBuyerBids([walletId], otherAccount2.address))[0];
    expect(bid2.amount).to.equal(ethers.utils.parseEther('230'));
    expect(bid2.currency).to.equal(busdContract.address);
    expect(bid2.buyer).to.equal(otherAccount2.address);
    expect(bid2.expiryTime).to.equal(expirationTime2);
  });

  it('should successfully complete a swap when placing a bid', async () => {
    await addLockedJewels(otherAccount1, '100');

    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('250'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    // Fund the swap wallet with locked JEWEL tokens.
    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll((await jewelSwapContract.getWallet(walletId)).walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    await addBusd(otherAccount2, '251');

    // Approve spend.
    busdContract = busdContract.connect(otherAccount2);
    await busdContract.approve(jewelSwapContract.address, ethers.utils.parseEther('251'));

    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    const expirationTime = secondsFromUnixEpoch(3 * 24 * 60 * 60);
    expect(
      await jewelSwapContract.placeBid(
        walletId,
        ethers.utils.parseEther('251'),
        busdContract.address,
        expirationTime
      )
    ).to.emit(jewelSwapContract, 'PlaceBid').withArgs(otherAccount2.address, walletId, true);

    // Bids should be cleared.
    validateErrorMessage(async () => await jewelSwapContract.buyerBids(otherAccount2.address, 0), 'Transaction reverted without a reason string');
    // Bid with null fields is returned.
    const bid = (await jewelSwapContract.getBuyerBids([walletId], otherAccount2.address))[0];
    expect(bid.buyer).to.equal(NULL_ADDRESS);

    // Swap should be completed.
    const wallet = await jewelSwapContract.getWallet(walletId);
    expect(wallet.state).to.equal(WALLET_STATES.SOLD);
    expect(await jewelSwapContract.completedSwaps(0)).to.equal(walletId);
    validateErrorMessage(async () => await jewelSwapContract.openSwaps(0), 'Transaction reverted without a reason string');
  });

  it('should successfully accept a bid', async () => {
    await addLockedJewels(otherAccount1, '100');

    jewelSwapContract = jewelSwapContract.connect(otherAccount1);

    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('250'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    // Fund the swap wallet with locked JEWEL tokens.
    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll((await jewelSwapContract.getWallet(walletId)).walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    // Add tokens, approve spend and place a bid.
    await addBusd(otherAccount2, '240');
    busdContract = busdContract.connect(otherAccount2);
    await busdContract.approve(jewelSwapContract.address, ethers.utils.parseEther('240'));

    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    const expirationTime = secondsFromUnixEpoch(24 * 60 * 60);
    expect(
      await jewelSwapContract.placeBid(
        walletId,
        ethers.utils.parseEther('240'),
        busdContract.address,
        expirationTime
      )
    ).to.emit(jewelSwapContract, 'PlaceBid').withArgs(otherAccount2.address, walletId, false);

    const bidBeforeAccept = (await jewelSwapContract.getBuyerBids([walletId], otherAccount2.address))[0];
    expect(bidBeforeAccept.amount).to.equal(ethers.utils.parseEther('240'));
    expect(bidBeforeAccept.currency).to.equal(busdContract.address);
    expect(bidBeforeAccept.buyer).to.equal(otherAccount2.address);
    expect(bidBeforeAccept.expiryTime).to.equal(expirationTime);

    // Accept a bid.
    jewelSwapContract = jewelSwapContract.connect(otherAccount1);
    expect(await jewelSwapContract.acceptBid(walletId, otherAccount2.address))
      .to.emit(jewelSwapContract, 'AcceptBid').withArgs(otherAccount2.address, walletId);

    // Bid after accept is removed, null fields are returned.
    const bidAfterAccept = (await jewelSwapContract.getBuyerBids([walletId], otherAccount2.address))[0];
    expect(bidAfterAccept.buyer).to.equal(NULL_ADDRESS);

    // Swap should be completed.
    const wallet = await jewelSwapContract.getWallet(walletId);
    expect(wallet.state).to.equal(WALLET_STATES.SOLD);
    expect(await jewelSwapContract.completedSwaps(0)).to.equal(walletId);
    validateErrorMessage(async () => await jewelSwapContract.openSwaps(0), 'Transaction reverted without a reason string');
  });

  it('should fail when guard checks fail on canceling a bid', async () => {
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    // Invalid wallet ID.
    await validateErrorMessage(
      async () => await jewelSwapContract.cancelBid('5'),
      'invalid wallet id'
    );

    await addLockedJewels(otherAccount1, '100');

    jewelSwapContract = jewelSwapContract.connect(otherAccount1);
    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('250'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    // No bid to cancel.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);
    await validateErrorMessage(
      async () => await jewelSwapContract.cancelBid(walletId),
      'bid does not exist'
    );
  });

  it('should successfully cancel a bid', async () => {
    await addLockedJewels(otherAccount1, '100');

    jewelSwapContract = jewelSwapContract.connect(otherAccount1);
    const walletId = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('333'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, walletId);

    // Fund the swap wallet with locked JEWEL tokens.
    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll((await jewelSwapContract.getWallet(walletId)).walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    // Add tokens, approve spend and place a bid.
    await addBusd(otherAccount2, '315');
    busdContract = busdContract.connect(otherAccount2);
    await busdContract.approve(jewelSwapContract.address, ethers.utils.parseEther('315'));

    jewelSwapContract = jewelSwapContract.connect(otherAccount2);

    const expirationTime = secondsFromUnixEpoch(24 * 60 * 60);
    expect(
      await jewelSwapContract.placeBid(
        walletId,
        ethers.utils.parseEther('315'),
        busdContract.address,
        expirationTime
      )
    ).to.emit(jewelSwapContract, 'PlaceBid').withArgs(otherAccount2.address, walletId, false);

    const bidBeforeCancel = (await jewelSwapContract.getBuyerBids([walletId], otherAccount2.address))[0];
    expect(bidBeforeCancel.amount).to.equal(ethers.utils.parseEther('315'));
    expect(bidBeforeCancel.currency).to.equal(busdContract.address);
    expect(bidBeforeCancel.buyer).to.equal(otherAccount2.address);
    expect(bidBeforeCancel.expiryTime).to.equal(expirationTime);

    // Cancel a bid.
    expect(await jewelSwapContract.cancelBid(walletId))
      .to.emit(jewelSwapContract, 'CancelBid').withArgs(otherAccount2.address, walletId);

    // Bid after cancel is removed, null fields are returned.
    const bidAfterCancel = (await jewelSwapContract.getBuyerBids([walletId], otherAccount2.address))[0];
    expect(bidAfterCancel.buyer).to.equal(NULL_ADDRESS);
  });

  it('should fail when guard checks fail on canceling of all bids', async () => {
    // No active bids.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);
    await validateErrorMessage(
      async () => await jewelSwapContract.cancelAllBids(),
      'you have no active bids'
    );
  });

  it('should successfully cancel all bids', async () => {
    // FIRST SWAP.

    await addLockedJewels(ownerAccount, '100');

    jewelSwapContract = jewelSwapContract.connect(ownerAccount);
    const wallet1Id = BigNumber.from('0');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('444'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(ownerAccount.address, wallet1Id);

    // Fund the swap wallet with locked JEWEL tokens.
    jewelTokenContract = jewelTokenContract.connect(ownerAccount);
    await jewelTokenContract.transferAll((await jewelSwapContract.getWallet(wallet1Id)).walletAddress);
    expect(await jewelTokenContract.lockOf(ownerAccount.address)).to.equal(BigNumber.from('0'));

    // SECOND SWAP.

    await addLockedJewels(otherAccount1, '100');

    jewelSwapContract = jewelSwapContract.connect(otherAccount1);
    const wallet2Id = BigNumber.from('1');
    expect(await jewelSwapContract.createSwap(
      ethers.utils.parseEther('555'),
      busdContract.address,
      otherAccount2.address
    )).to.emit(jewelSwapContract, 'CreateSwap').withArgs(otherAccount1.address, wallet2Id);

    // Fund the swap wallet with locked JEWEL tokens.
    jewelTokenContract = jewelTokenContract.connect(otherAccount1);
    await jewelTokenContract.transferAll((await jewelSwapContract.getWallet(wallet2Id)).walletAddress);
    expect(await jewelTokenContract.lockOf(otherAccount1.address)).to.equal(BigNumber.from('0'));

    // Add tokens, approve spend.
    await addBusd(otherAccount2, '1000');
    busdContract = busdContract.connect(otherAccount2);
    await busdContract.approve(jewelSwapContract.address, ethers.utils.parseEther('1000'));

    // Place bids on two swaps.
    jewelSwapContract = jewelSwapContract.connect(otherAccount2);
    const expirationTime = secondsFromUnixEpoch(24 * 60 * 60);
    expect(
      await jewelSwapContract.placeBid(
        wallet1Id,
        ethers.utils.parseEther('333'),
        busdContract.address,
        expirationTime
      )
    ).to.emit(jewelSwapContract, 'PlaceBid').withArgs(otherAccount2.address, wallet1Id, false);
    expect(
      await jewelSwapContract.placeBid(
        wallet2Id,
        ethers.utils.parseEther('444'),
        busdContract.address,
        expirationTime
      )
    ).to.emit(jewelSwapContract, 'PlaceBid').withArgs(otherAccount2.address, wallet2Id, false);

    const bidsBeforeCancel = await jewelSwapContract.getBuyerBids([wallet1Id, wallet2Id], otherAccount2.address);
    expect(bidsBeforeCancel[0].amount).to.equal(ethers.utils.parseEther('333'));
    expect(bidsBeforeCancel[0].currency).to.equal(busdContract.address);
    expect(bidsBeforeCancel[0].buyer).to.equal(otherAccount2.address);
    expect(bidsBeforeCancel[0].expiryTime).to.equal(expirationTime);
    expect(bidsBeforeCancel[1].amount).to.equal(ethers.utils.parseEther('444'));
    expect(bidsBeforeCancel[1].currency).to.equal(busdContract.address);
    expect(bidsBeforeCancel[1].buyer).to.equal(otherAccount2.address);
    expect(bidsBeforeCancel[1].expiryTime).to.equal(expirationTime);

    // Cancel bids.
    expect(await jewelSwapContract.cancelAllBids())
      .to.emit(jewelSwapContract, 'CancelAllBids').withArgs(otherAccount2.address);

    // Bids after cancel are removed, null fields are returned.
    const bidsAfterCancel = await jewelSwapContract.getBuyerBids([wallet1Id, wallet2Id], otherAccount2.address);
    expect(bidsAfterCancel[0].buyer).to.equal(NULL_ADDRESS);
    expect(bidsAfterCancel[1].buyer).to.equal(NULL_ADDRESS);
  });
});
