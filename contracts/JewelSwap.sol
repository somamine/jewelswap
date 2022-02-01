// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract JewelSwap is Ownable {
    using SafeERC20 for IERC20Metadata;

    /*
    ///////////////////////////////////////////////////////////////
                            WALLETS
    //////////////////////////////////////////////////////////////
    */

    mapping(uint256 => address) private wallets;
    mapping(uint256 => address) private sellers;
    mapping(uint256 => address) private buyers;
    mapping(uint256 => Ask) private asks;
    mapping(uint256 => Bid[]) private bids;
    mapping(uint256 => Sale) private sales;
    mapping(uint256 => State) private states;
    mapping(uint256 => uint256) private createdAtTimestamps;
    mapping(uint256 => uint256) private updatedAtTimestamps;

    // Indexes
    mapping(address => uint256[]) public sellerWallets; // walletIds created by seller
    mapping(address => uint256[]) public buyerWallets; // walletIds created for buyer
    mapping(address => uint256[]) public buyerBids; // walletIds that buyer has placed bids on
    uint256[] public openSwaps; // walletIds in CREATED state
    uint256[] public completedSwaps; // walletIds in SOLD state
    uint256[] public canceledSwaps; // walletIds in CANCELED state

    uint256 public nextWalletId;

    address public walletImplementation; // JewelSwap wallet contract address.

    enum State {
        CREATED,
        SOLD,
        CANCELED
    }

    /*
    ///////////////////////////////////////////////////////////////
                            MARKET
    //////////////////////////////////////////////////////////////
    */

    struct Ask {
        uint256 amount;
        address currency;
    }

    struct Bid {
        uint256 amount;
        address currency;
        address buyer;
        uint256 expiryTime;
    }

    struct Sale {
        uint256 lockedJewelAmount;
        uint256 amount;
        address currency;
        address buyer;
        uint256 soldAt;
    }

    mapping(address => bool) public currencies; // authorized erc20s

    address[] private volumeCurrencies;
    mapping(address => uint256) public volumeTraded;

    uint256 private MAX_EXPIRY_INTERVAL = 2678400; // 1 month

    /*
    ///////////////////////////////////////////////////////////////
                            FEE
    //////////////////////////////////////////////////////////////
    */

    uint256 public fee = 20; // 2% of tx value
    uint256 public feeGracePeriodAmount = 1000000 * 1e18; // 1 million
    address private feePaymentAddress = 0x6616E63C042fB0ff73E2F58CC92bB0BFf43eF2cf;

    /*
    ///////////////////////////////////////////////////////////////
                            CURRENCIES
    //////////////////////////////////////////////////////////////
    */

    address USDC;
    address USDT;
    address DAI;
    address UST;
    address BUSD;

    address JEWEL;
    JewelToken jewelContract;

    /*
    ///////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////
    */

    constructor(address _walletImplementation,
                address _jewelAddress,
                address _usdcAddress,
                address _usdtAddress,
                address _daiAddress,
                address _ustAddress,
                address _busdAddress) {
        walletImplementation = _walletImplementation;

        JEWEL = _jewelAddress;
        USDC = _usdcAddress;
        USDT = _usdtAddress;
        DAI = _daiAddress;
        UST = _ustAddress;
        BUSD = _busdAddress;

        currencies[USDC] = true;
        currencies[USDT] = true;
        currencies[DAI] = true;
        currencies[UST] = true;
        currencies[BUSD] = true;

        jewelContract = JewelToken(JEWEL);
    }

    /*
    ///////////////////////////////////////////////////////////////
                            VIEWERS
    //////////////////////////////////////////////////////////////
    */

    function getWallet(uint256 _id) public view returns (
        address walletAddress,
        address seller,
        address buyer,
        Ask memory ask,
        Bid[] memory bidArray,
        Sale memory sale,
        State state,
        uint256 lockedJewelAmount,
        uint256 createdAt,
        uint256 updatedAt
    ) {
        walletAddress = wallets[_id];
        seller = sellers[_id];
        buyer = buyers[_id];
        ask = asks[_id];
        bidArray = bids[_id];
        sale = sales[_id];
        state = states[_id];
        lockedJewelAmount = jewelContract.lockOf(walletAddress);
        createdAt = createdAtTimestamps[_id];
        updatedAt = updatedAtTimestamps[_id];
    }

    function getWallets(uint256[] memory _ids) public view returns (
        address[] memory _walletAddresses,
        address[] memory _sellers,
        address[] memory _buyers,
        Ask[] memory _asks,
        Bid[][] memory _bids,
        Sale[] memory _sales,
        State[] memory _states,
        uint256[] memory _lockedJewelAmounts,
        uint256[] memory _createdAt,
        uint256[] memory _updatedAt
    ) {
        uint256 length = _ids.length;
        
        _walletAddresses = new address[](length);
        _sellers = new address[](length);
        _buyers = new address[](length);
        _asks = new Ask[](length);
        _bids = new Bid[][](length);
        _sales = new Sale[](length);
        _states = new State[](length);
        _lockedJewelAmounts = new uint256[](length);
        _createdAt = new uint256[](length);
        _updatedAt = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 id = _ids[i];

            _walletAddresses[i] = wallets[id];
            _sellers[i] = sellers[id];
            _buyers[i] = buyers[id];
            _asks[i] = asks[id];
            _bids[i] = bids[id];
            _sales[i] = sales[id];
            _states[i] = states[id];
            _lockedJewelAmounts[i] = jewelContract.lockOf(wallets[id]);
            _createdAt[i] = createdAtTimestamps[id];
            _updatedAt[i] = updatedAtTimestamps[id];
        }
    }

    function getBuyerBids(uint256[] memory _ids, address _buyer) public view returns (Bid[] memory _bids) {
        uint256 length = _ids.length;
        _bids = new Bid[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 id = _ids[i];

            (bool exists, bool valid, uint256 bidIndex) = _getBid(id, _buyer);
            if (exists && valid) {
                _bids[i] = bids[id][bidIndex];
            }
        }

        return _bids;
    }

    function getSellerWalletIds(address _seller) public view returns (uint256[] memory) {
        return sellerWallets[_seller];
    }

    function getBuyerWalletIds(address _buyer) public view returns (uint256[] memory) {
        return buyerWallets[_buyer];
    }

    function getBuyerBidIds(address _buyer) public view returns (uint256[] memory) {
        return buyerBids[_buyer];
    }

    function getOpenSwaps() public view returns (uint256[] memory) {
        return openSwaps;
    }

    function getCompletedSwaps() public view returns (uint256[] memory) {
        return completedSwaps;
    }

    function getCanceledSwaps() public view returns (uint256[] memory) {
        return canceledSwaps;
    }

    /*
    ///////////////////////////////////////////////////////////////
                            FACTORY LOGIC
    //////////////////////////////////////////////////////////////
    */

    event CreateSwap(address indexed seller, uint256 id);
    event UpdateSwap(address indexed seller, uint256 id, address currency, uint256 amount);

    function createSwap(uint256 _amount, address _currency, address _buyer) external {
        require(_isValidCurrency(_currency), "invalid currency");
        require(_amount > 0, "amount needs to be greater than zero");
        require(jewelContract.lockOf(msg.sender) > 0, "must have locked jewel");

        // Get new wallet id
        // If existing unfunded wallet exists, use that one
        uint256 id;
        address walletAddress;
        (bool exists, uint256 existingWalletId) = _checkForUnfundedWallet(msg.sender);

        if (exists) {
            // Use existing unfunded wallet
            id = existingWalletId;
            walletAddress = wallets[id];
        } else {
            // Get new id
            id = nextWalletId;
            nextWalletId++;

            // Create wallet for seller
            walletAddress = _deploy();
            createdAtTimestamps[id] = block.timestamp;
        }

        // Update indexes
        if (!exists) {
            sellerWallets[msg.sender].push(id);
            buyerWallets[_buyer].push(id);
            openSwaps.push(id);
        } else {
            // Update buyerWallets index
            address prevBuyer = buyers[id];
            if (prevBuyer != _buyer) {
                _deleteElement(buyerWallets[prevBuyer], id);
                buyerWallets[_buyer].push(id);
            }
        }

        // Add to storage
        wallets[id] = walletAddress;
        sellers[id] = msg.sender;
        buyers[id] = _buyer;
        asks[id] = Ask({amount : _amount, currency : _currency});
        states[id] = State.CREATED;
        updatedAtTimestamps[id] = block.timestamp;

        // Emit events
        emit CreateSwap(msg.sender, id);
    }

    function updateSwap(uint256 _id, uint256 _amount, address _currency) external {
        require(_id >= 0 && _id < nextWalletId, "invalid wallet id");
        require(sellers[_id] == msg.sender, "you are not the seller");
        require(states[_id] == State.CREATED, "swap already completed or canceled");
        require(jewelContract.lockOf(wallets[_id]) > 0, "swap must be funded with locked jewel");
        require(_isValidCurrency(_currency), "invalid currency");
        require(_amount > 0, "amount needs to be greater than zero");

        asks[_id] = Ask({amount : _amount, currency : _currency});
        updatedAtTimestamps[_id] = block.timestamp;

        // Emit events
        emit UpdateSwap(msg.sender, _id, _currency, _amount);
    }

    function _deploy() internal returns (address proxy) {
        bytes20 targetBytes = bytes20(walletImplementation);
        assembly {
            let clone := mload(0x40)
            mstore(clone, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(clone, 0x14), targetBytes)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            proxy := create(0, clone, 0x37)
        }
        JewelSwapWallet(proxy).initialize(JEWEL);
    }

    /*
    ///////////////////////////////////////////////////////////////
                            MARKET LOGIC
    //////////////////////////////////////////////////////////////
    */

    event PlaceBid(address indexed buyer, uint256 id, bool didCompleteSwap);

    event AcceptSwap(address indexed buyer, uint256 id);
    event AcceptBid(address indexed buyer, uint256 id);

    event CancelSwap(address indexed seller, uint256 id);
    event CancelBid(address indexed buyer, uint256 id);
    event CancelAllBids(address indexed buyer);

    function acceptSwap(uint256 _id) external {
        require(_id >= 0 && _id < nextWalletId, "invalid wallet id");
        require(buyers[_id] == address(0) || buyers[_id] == msg.sender, "private swap not created for you");
        require(states[_id] == State.CREATED, "swap already completed or canceled");

        // Get ask
        Ask memory ask = asks[_id];

        // Complete swap
        _completeSwap(_id, ask.amount, ask.currency, msg.sender);

        // Emit events
        emit AcceptSwap(msg.sender, _id);
    }

    function cancelSwap(uint256 _id) external {
        require(_id >= 0 && _id < nextWalletId, "invalid wallet id");
        require(sellers[_id] == msg.sender, "you are not the seller");
        require(states[_id] == State.CREATED, "swap already completed or canceled");

        // Transfer locked jewel back to seller
        address walletAddress = wallets[_id];
        JewelSwapWallet wallet = JewelSwapWallet(walletAddress);
        wallet.transferAll(msg.sender);

        // Update the wallet state
        states[_id] = State.CANCELED;

        // Update indices
        canceledSwaps.push(_id);
        _deleteElement(openSwaps, _id);

        // Clear swap bids
        _clearSwapBids(_id);

        // Emit events
        emit CancelSwap(msg.sender, _id);
    }

    function placeBid(uint256 _id, uint256 _amount, address _currency, uint256 _expiryTime) external {
        require(_id >= 0 && _id < nextWalletId, "invalid wallet id");
        require(_isValidCurrency(_currency), "invalid currency");
        require(_amount > 0, "amount needs to be greater than zero");
        require(_expiryTime > block.timestamp, "expiry time needs to be in the future");
        require(_expiryTime < (block.timestamp + MAX_EXPIRY_INTERVAL), "expiry time needs to be less than one month in the future");
        require(sellers[_id] != msg.sender, "cannot bid on your own swap");
        require(buyers[_id] == address(0) || buyers[_id] == msg.sender, "private swap not created for you");
        require(jewelContract.lockOf(wallets[_id]) > 0, "swap must be funded with locked jewel");
        require(states[_id] == State.CREATED, "swap already completed or canceled");

        // Ensure bidder has enough _currency in wallet and approved to make the bid
        IERC20Metadata token = IERC20Metadata(_currency);
        require(token.balanceOf(msg.sender) >= _amount, "you do not have enough tokens");
        require(token.allowance(msg.sender, address(this)) >= _amount, "you do not have enough tokens approved");

        // If _currency matches ask currency and _amount is >= to ask amount, complete the swap
        Ask memory ask = asks[_id];
        if (_currency == ask.currency && _amount >= ask.amount) {
            // Complete swap
            _completeSwap(_id, ask.amount, ask.currency, msg.sender);

            // Emit events
            emit PlaceBid(msg.sender, _id, true);
        } else {
            // Replace bid if one already exists
            (bool exists, , uint256 bidIndex) = _getBid(_id, msg.sender);
            if (exists) {
                // Get existing bid from storage
                Bid storage bid = bids[_id][bidIndex];

                // Replace bid
                bid.amount = _amount;
                bid.currency = _currency;
                bid.buyer = msg.sender;
                bid.expiryTime = _expiryTime;
            } else {
                // Create new bid and add to storage
                bids[_id].push(Bid({
                    amount: _amount,
                    currency: _currency,
                    buyer: msg.sender,
                    expiryTime: _expiryTime
                }));

                // Update buyerBids index
                buyerBids[msg.sender].push(_id);
            }

            // Emit events
            emit PlaceBid(msg.sender, _id, false);
        }
    }

    function acceptBid(uint256 _id, address _buyer) external {
        require(_id >= 0 && _id < nextWalletId, "invalid wallet id");
        require(sellers[_id] == msg.sender, "you are not the seller");
        require(states[_id] == State.CREATED, "swap already completed or canceled");

        // Get and validate bid
        (bool exists, bool valid, uint256 bidIndex) = _getBid(_id, _buyer);
        require(exists, "bid does not exist");
        require(valid, "invalid bid");

        // Complete swap
        _completeSwap(_id, bids[_id][bidIndex].amount, bids[_id][bidIndex].currency, _buyer);

        // Emit events
        emit AcceptBid(_buyer, _id);
    }

    function cancelBid(uint256 _id) external {
        require(_id >= 0 && _id < nextWalletId, "invalid wallet id");

        // Check if bid exists and is valid
        (bool exists, , ) = _getBid(_id, msg.sender);
        require(exists, "bid does not exist");

        // Remove bid from buyerBids index
        _deleteElement(buyerBids[msg.sender], _id);

        // Remove bid from bids array
        for (uint256 i = 0; i < bids[_id].length; i++) {
            if (bids[_id][i].buyer == msg.sender) {
                bids[_id][i] = bids[_id][bids[_id].length - 1];
                bids[_id].pop();
                break;
            }
        }

        // Emit events
        emit CancelBid(msg.sender, _id);
    }

    function cancelAllBids() external {
        uint256[] memory ids = buyerBids[msg.sender];
        require(ids.length > 0, "you have no active bids");

        // Remove each bid
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];

            (bool exists, , uint256 bidIndex) = _getBid(id, msg.sender);
            if (exists) {
                bids[id][bidIndex] = bids[id][bids[id].length - 1];
                bids[id].pop();
            }
        }

        // Clear buyerBids index
        delete buyerBids[msg.sender];

        // Emit events
        emit CancelAllBids(msg.sender);
    }

    function _completeSwap(uint256 _id, uint256 _amount, address _currency, address _buyer) internal {
        // Get locked jewel amount
        address walletAddress = wallets[_id];
        uint256 lockedJewelAmount = jewelContract.lockOf(walletAddress);

        // Get seller
        address seller = sellers[_id];

        // Get token interface
        IERC20Metadata token = IERC20Metadata(_currency);

        // Calculate fee
        uint256 totalVolumeTraded = getTotalVolumeTraded();
        uint256 feeAmount = 0;

        if (totalVolumeTraded > feeGracePeriodAmount) {
            // If fee grace period is over then take full fee from the amount.
            feeAmount = (_amount * fee) / 1000;
        } else if ((totalVolumeTraded + (_amount * _volumeMultiplier(_currency))) > feeGracePeriodAmount) {
            // If fee grace period is not over but current swap will end it, then take partial fee from the amount.
            uint256 gracedAmount = (feeGracePeriodAmount - totalVolumeTraded) / _volumeMultiplier(_currency);
            feeAmount = (_amount - gracedAmount) * fee / 1000;
        }

        if (feeAmount != 0) {
            // Transfer fee
            token.safeTransferFrom(_buyer, feePaymentAddress, feeAmount);
            // Transfer the rest to the seller
            token.safeTransferFrom(_buyer, seller, (_amount - feeAmount));
        } else {
            // Transfer full amount to the seller
            token.safeTransferFrom(_buyer, seller, _amount);
        }

        // Transfer locked jewel from escrow wallet to bidder
        JewelSwapWallet wallet = JewelSwapWallet(walletAddress);
        wallet.transferAll(_buyer);

        // Record sale
        sales[_id] = Sale({
            lockedJewelAmount: lockedJewelAmount,
            amount: _amount,
            currency: _currency,
            buyer: _buyer,
            soldAt: block.timestamp
        });

        // Add to currency volume
        if (_indexOf(volumeCurrencies, _currency) == -1) {
            volumeCurrencies.push(_currency);
        }
        volumeTraded[_currency] += _amount;

        // Update the wallet state
        states[_id] = State.SOLD;

        // Update indexes
        completedSwaps.push(_id);
        _deleteElement(openSwaps, _id);

        // Clear swap bids
        _clearSwapBids(_id);
    }

    function setMaxExpiryInterval(uint256 _maxExpiryInterval) external onlyOwner {
        MAX_EXPIRY_INTERVAL = _maxExpiryInterval;
    }

    function _clearSwapBids(uint256 _id) internal {
        // Remove bids from buyerBids index
        for (uint256 i = 0; i < bids[_id].length; i++) {
            address _bidBuyer = bids[_id][i].buyer;
            _deleteElement(buyerBids[_bidBuyer], _id);
        }

        // Remove all swap bids
        delete bids[_id];
    }

    /*
    ///////////////////////////////////////////////////////////////
                            TOTAL VOLUME LOGIC
    //////////////////////////////////////////////////////////////
    */

    function getTotalVolumeTraded() public view returns (uint256) {
        uint256 totalVolumeTraded = 0;
        for (uint256 i = 0; i < volumeCurrencies.length; i++) {
            totalVolumeTraded += volumeTraded[volumeCurrencies[i]] * _volumeMultiplier(volumeCurrencies[i]);
        }

        return totalVolumeTraded;
    }

    function _volumeMultiplier(address _currency) internal view returns (uint256) {
        IERC20Metadata token = IERC20Metadata(_currency);
        return 10 ** (18 - token.decimals());
    }

    /*
    ///////////////////////////////////////////////////////////////
                            FEE LOGIC
    //////////////////////////////////////////////////////////////
    */

    function setFee(uint256 _fee) external onlyOwner {
        fee = _fee;
    }

    function setFeeGracePeriodAmount(uint256 _feeGracePeriodAmount) external onlyOwner {
        feeGracePeriodAmount = _feeGracePeriodAmount;
    }

    function setFeePaymentAddress(address _feePaymentAddress) external onlyOwner {
        feePaymentAddress = _feePaymentAddress;
    }

    /*
    ///////////////////////////////////////////////////////////////
                            CURRENCY LOGIC
    //////////////////////////////////////////////////////////////
    */

    function addCurrency(address _currency) external onlyOwner {
        currencies[_currency] = true;
    }

    function removeCurrency(address _currency) external onlyOwner {
        currencies[_currency] = false;
    }

    function _isValidCurrency(address _currency) internal view returns (bool) {
        return currencies[_currency];
    }

    /*
    ///////////////////////////////////////////////////////////////
                            UTILITIES
    //////////////////////////////////////////////////////////////
    */

    function _getBid(uint256 _id, address _buyer) internal view returns (bool exists, bool valid, uint256 bidIndex) {
        // Find bid if exists
        for (uint256 i = 0; i < bids[_id].length; i++) {
            if (_buyer == bids[_id][i].buyer) {
                // Check if bid is valid
                if (states[_id] == State.CREATED && jewelContract.lockOf(wallets[_id]) > 0 && bids[_id][i].expiryTime > block.timestamp) {
                    return (true, true, i); // valid
                } else {
                    return (true, false, i); // invalid
                }
            }
        }

        // Bid does not exist
        return (false, false, 0);
    }

    function _checkForUnfundedWallet(address _address) internal view returns (
        bool exists,
        uint256 existingWalletId
    ) {
        uint256[] memory ids = sellerWallets[_address];
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            State walletState = states[id];
            if (walletState == State.CREATED) {
                address walletAddress = wallets[id];
                uint256 lockedJewelAmount = jewelContract.lockOf(walletAddress);
                if (lockedJewelAmount == 0) {
                    return (true, id);
                }
            }
        }

        return (false, 0);
    }

    function _deleteElement(uint256[] storage _array, uint256 _element) internal {
        // Get index to delete
        uint256 idxToDelete;
        for (uint256 i = 0; i < _array.length; i++) {
            if (_element == _array[i]) {
                idxToDelete = i;
                break;
            }
        }

        // Move the last element to the deleted spot. Remove the last element.
        _array[idxToDelete] = _array[_array.length - 1];
        _array.pop();
    }

    function _indexOf(address[] storage _array, address _element) internal view returns (int256) {
        int256 idx = -1;
        for (uint256 i = 0; i < _array.length; i++) {
            if (_element == _array[i]) {
                idx = int256(i);
                break;
            }
        }

        return idx;
    }

}

interface JewelSwapWallet {

    function initialize(address _jewelContract) external;

    function transferAll(address _to) external;

}

interface JewelToken {

    function lockOf(address _holder) external view returns (uint256);

}