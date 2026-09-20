// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {
    IRailCore,
    IERC3009,
    IAttestor,
    ILPRegistry,
    Order,
    OrderIntent,
    Authorization,
    Status
} from "./interfaces/IRail.sol";

/**
 * @title RailCore
 * @notice Escrows a sender's dollars, runs a sealed-bid auction for who delivers the local
 *         currency, and releases the money against proof of payout — or slashes the provider.
 * @dev Four properties this contract exists to guarantee:
 *
 *      1. `finalize`, `refund` and `claim` are permissionless. No owner, pause or allowlist can
 *         block them, so escrowed money is never at the mercy of a backend staying alive.
 *      2. The sender captures the saving. The winner is paid exactly its bid and the difference
 *         from the reserve price goes back to the sender. The protocol takes none of it.
 *      3. The optimistic layer is native. The dispute window lives here, not in a pluggable
 *         module, so no configuration can unplug it. Attestors only ever accelerate settlement.
 *      4. One sender signature. Every order parameter is bound into the EIP-3009 nonce, so a
 *         relayer that alters the recipient, amount, currency, fee or attestor invalidates it.
 */
contract RailCore is IRailCore, EIP712, ReentrancyGuard {
    bytes32 private constant ORDER_INTENT_TYPEHASH = keccak256(
        "OrderIntent(address sender,bytes32 recipientCommitment,bytes3 currency,uint256 localAmount,uint256 maxAusd,uint256 fee,address relayer,address attestor,bytes32 salt)"
    );
    bytes32 private constant DISPUTE_TYPEHASH = keccak256("Dispute(bytes32 orderId)");

    /// @notice Gas handed to a sender-chosen attestor. Enough to answer, too little to matter.
    uint256 public constant ATTESTOR_GAS = 50_000;
    /// @dev Headroom for the rest of the calling function after the attestor's stipend.
    uint256 private constant GAS_BUFFER = 5000;

    IERC20 public immutable ausd;
    ILPRegistry public immutable registry;
    uint64 public immutable commitBlocks;
    uint64 public immutable revealBlocks;
    uint64 public immutable payoutBlocks;
    uint64 public immutable disputeBlocks;
    uint64 public immutable resolutionBlocks;
    uint16 public immutable collateralBps;

    address public owner;
    bool public createPaused;

    mapping(bytes32 => Order) private orders;
    mapping(bytes32 => mapping(address => bytes32)) private commitments;
    mapping(address => uint256) public claimable;

    constructor(
        address ausd_,
        address registry_,
        uint64 commitBlocks_,
        uint64 revealBlocks_,
        uint64 payoutBlocks_,
        uint64 disputeBlocks_,
        uint64 resolutionBlocks_,
        uint16 collateralBps_,
        address owner_
    ) EIP712("Rail", "1") {
        if (ausd_ == address(0) || registry_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        // Under 100% collateral, defaulting could pay better than delivering.
        if (collateralBps_ < 10_000) revert InvalidIntent();
        ausd = IERC20(ausd_);
        registry = ILPRegistry(registry_);
        commitBlocks = commitBlocks_;
        revealBlocks = revealBlocks_;
        payoutBlocks = payoutBlocks_;
        disputeBlocks = disputeBlocks_;
        resolutionBlocks = resolutionBlocks_;
        collateralBps = collateralBps_;
        owner = owner_;
    }

    /*//////////////////////////////////////////////////////////////
                                ORDERS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Escrows the sender's dollars and opens the auction.
     * @param intent What the sender agreed to. Its hash is the order id.
     * @param authorization The sender's EIP-3009 signature over `maxAusd + fee`.
     * @return orderId The EIP-712 hash of `intent`, which is also the authorisation nonce.
     */
    function createOrder(OrderIntent calldata intent, Authorization calldata authorization)
        external
        nonReentrant
        returns (bytes32 orderId)
    {
        if (createPaused) revert CreatePaused();
        if (intent.sender == address(0)) revert ZeroAddress();
        if (intent.maxAusd == 0 || intent.maxAusd > type(uint128).max) revert InvalidIntent();
        if (intent.localAmount == 0 || intent.currency == bytes3(0)) revert InvalidIntent();
        if (intent.recipientCommitment == bytes32(0)) revert InvalidIntent();
        if (intent.fee > 0 && intent.relayer == address(0)) revert InvalidIntent();

        orderId = _hashIntent(intent);
        if (orders[orderId].status != Status.None) revert OrderExists();

        uint64 commitEnd = uint64(block.number) + commitBlocks;
        uint64 revealEnd = commitEnd + revealBlocks;

        orders[orderId] = Order({
            sender: intent.sender,
            status: Status.Open,
            currency: intent.currency,
            commitEnd: commitEnd,
            winner: address(0),
            revealEnd: revealEnd,
            attestor: intent.attestor,
            payoutDeadline: revealEnd + payoutBlocks,
            maxAusd: uint128(intent.maxAusd),
            winningBid: 0,
            recipientCommitment: intent.recipientCommitment,
            localAmount: intent.localAmount,
            disputeEnd: 0,
            resolutionEnd: 0
        });

        emit OrderCreated(
            orderId,
            intent.sender,
            intent.currency,
            intent.localAmount,
            intent.maxAusd,
            intent.fee,
            intent.attestor,
            intent.recipientCommitment,
            commitEnd,
            revealEnd
        );

        // The token verifies the signature against this exact nonce, so any tampering fails here.
        IERC3009(address(ausd))
            .receiveWithAuthorization(
                intent.sender,
                address(this),
                intent.maxAusd + intent.fee,
                authorization.validAfter,
                authorization.validBefore,
                orderId,
                authorization.v,
                authorization.r,
                authorization.s
            );

        if (intent.fee > 0) _pay(intent.relayer, intent.fee);
    }

    /*//////////////////////////////////////////////////////////////
                               AUCTION
    //////////////////////////////////////////////////////////////*/

    /// @notice Seals a bid. The amount stays hidden until reveal.
    function commitBid(bytes32 orderId, bytes32 commitment) external {
        Order storage order = orders[orderId];
        if (order.status != Status.Open) revert NotOpen();
        if (block.number > order.commitEnd) revert CommitClosed();
        if (!registry.isEligible(msg.sender)) revert NotEligible();
        if (commitment == bytes32(0)) revert BadReveal();

        commitments[orderId][msg.sender] = commitment;
        registry.recordCommit(msg.sender);
        emit BidCommitted(orderId, msg.sender, commitment);
    }

    /**
     * @notice Opens a sealed bid. The lowest one leads; ties keep the earlier reveal.
     * @dev Leading costs collateral immediately, taken from free stake. A provider that cannot
     *      cover it cannot lead, which is what makes a default always cost more than it gains.
     */
    function revealBid(bytes32 orderId, uint256 amount, bytes32 salt) external {
        Order storage order = orders[orderId];
        if (order.status != Status.Open) revert NotOpen();
        if (block.number <= order.commitEnd) revert RevealNotStarted();
        if (block.number > order.revealEnd) revert RevealClosed();

        bytes32 sealed_ = commitments[orderId][msg.sender];
        if (sealed_ == bytes32(0)) revert NoCommitment();
        if (sealed_ != _commitment(orderId, msg.sender, amount, salt)) revert BadReveal();
        if (amount == 0 || amount > order.maxAusd) revert BidOutOfRange();

        delete commitments[orderId][msg.sender];
        registry.recordReveal(msg.sender);

        bool leading = order.winner == address(0) || amount < order.winningBid;
        if (leading) {
            if (order.winner != address(0)) registry.unlock(orderId);
            uint256 collateral = _collateralFor(amount);
            order.winner = msg.sender;
            order.winningBid = uint128(amount);
            registry.lock(orderId, msg.sender, collateral);
            emit CollateralLocked(orderId, msg.sender, collateral);
        }

        emit BidRevealed(orderId, msg.sender, amount, leading);
    }

    /// @notice Ends the auction once the reveal window has passed. Anyone may call it.
    function closeAuction(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.status != Status.Open) revert NotOpen();
        if (block.number <= order.revealEnd) revert AuctionLive();
        _closeOrAward(orderId, order);
    }

    /*//////////////////////////////////////////////////////////////
                         DELIVERY AND DISPUTE
    //////////////////////////////////////////////////////////////*/

    /// @notice The winner states it has paid the recipient, which starts the dispute window.
    function markPaid(bytes32 orderId) external {
        Order storage order = orders[orderId];
        _awardIfDue(orderId, order);
        if (order.status != Status.Awarded) revert WrongStatus(order.status);
        if (msg.sender != order.winner) revert NotWinner();
        if (block.number > order.payoutDeadline) revert DeadlinePassed();

        order.status = Status.Paid;
        order.disputeEnd = uint64(block.number) + disputeBlocks;
        emit MarkedPaid(orderId, msg.sender, order.disputeEnd);
    }

    /**
     * @notice The sender says the money never arrived, which pauses optimistic settlement.
     * @param signature Empty when the sender calls directly; otherwise their EIP-712 `Dispute`
     *        signature, so someone else can pay the gas to raise it.
     * @dev A dispute alone never slashes anybody. It buys time for evidence, and evidence wins:
     *      an attestation settles the order even from here.
     */
    function dispute(bytes32 orderId, bytes calldata signature) external {
        Order storage order = orders[orderId];
        if (order.status != Status.Paid) revert WrongStatus(order.status);
        if (block.number > order.disputeEnd) revert DeadlinePassed();

        if (signature.length == 0) {
            if (msg.sender != order.sender) revert NotSender();
        } else {
            bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(DISPUTE_TYPEHASH, orderId)));
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
            if (err != ECDSA.RecoverError.NoError || recovered != order.sender) revert BadSignature();
        }

        order.status = Status.Disputed;
        order.resolutionEnd = uint64(block.number) + resolutionBlocks;
        emit Disputed(orderId, order.sender, order.resolutionEnd);
    }

    /*//////////////////////////////////////////////////////////////
                              SETTLEMENT
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Pays the winner its bid and returns the saving to the sender. Anyone may call it.
     * @dev Two ways to get here: an attestor says the payout landed, or the dispute window closed
     *      with nobody objecting. Evidence dominates — it settles from Awarded, Paid or Disputed.
     */
    function finalize(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        _awardIfDue(orderId, order);

        Status status = order.status;
        if (status != Status.Awarded && status != Status.Paid && status != Status.Disputed) {
            revert WrongStatus(status);
        }

        if (!_isDelivered(order.attestor, orderId)) {
            // The optimistic path: only from Paid, and only once nobody has objected in time.
            if (status != Status.Paid || block.number <= order.disputeEnd) revert WindowOpen();
        }

        address winner = order.winner;
        uint256 bid = order.winningBid;
        uint256 change = order.maxAusd - bid;

        order.status = Status.Settled;
        registry.settle(orderId, bid);

        emit OrderSettled(orderId, winner, bid, change);
        _pay(winner, bid);
        _pay(order.sender, change);
    }

    /**
     * @notice Returns the sender's money, plus the defaulting provider's collateral. Anyone may
     *         call it.
     * @dev Impossible while the attestor reports delivery, at any point in the order's life.
     */
    function refund(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];

        // An auction nobody bid in simply gives the money back.
        if (order.status == Status.Open && block.number > order.revealEnd && order.winner == address(0)) {
            _closeOrAward(orderId, order);
            return;
        }
        _awardIfDue(orderId, order);

        Status status = order.status;
        if (status == Status.Awarded) {
            if (block.number <= order.payoutDeadline) revert WindowOpen();
        } else if (status == Status.Disputed) {
            if (block.number <= order.resolutionEnd) revert WindowOpen();
        } else {
            revert WrongStatus(status);
        }

        if (_isDelivered(order.attestor, orderId)) revert Attested();

        uint256 escrow = order.maxAusd;
        order.status = Status.Refunded;
        (, uint256 slashed) = registry.slash(orderId);

        emit OrderRefunded(orderId, order.sender, escrow, slashed);
        _pay(order.sender, escrow + slashed);
    }

    /// @notice Pays out money that was deferred because the token refused it earlier.
    function claim(address account) external nonReentrant {
        uint256 amount = claimable[account];
        if (amount == 0) revert NothingToClaim();
        claimable[account] = 0;
        emit Claimed(account, amount);
        // Deliberately not `_pay`: if this still fails, the whole call reverts and can be retried.
        ausd.transfer(account, amount);
    }

    /*//////////////////////////////////////////////////////////////
                                 ADMIN
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Stops new orders being created. That is the entire extent of the owner's power.
     * @dev It cannot touch an order that already exists: settlement, refunds and claims stay
     *      permissionless whatever this is set to.
     */
    function setCreatePaused(bool paused) external {
        if (msg.sender != owner) revert NotOwner();
        createPaused = paused;
        emit CreatePausedSet(paused);
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function hashIntent(OrderIntent calldata intent) external view returns (bytes32) {
        return _hashIntent(intent);
    }

    function computeCommitment(bytes32 orderId, address lp, uint256 amount, bytes32 salt)
        external
        pure
        returns (bytes32)
    {
        return _commitment(orderId, lp, amount, salt);
    }

    function commitmentOf(bytes32 orderId, address lp) external view returns (bytes32) {
        return commitments[orderId][lp];
    }

    function collateralFor(uint256 bid) external view returns (uint256) {
        return _collateralFor(bid);
    }

    function canFinalize(bytes32 orderId) external view returns (bool) {
        Order storage order = orders[orderId];
        Status status = _effectiveStatus(order);
        if (status != Status.Awarded && status != Status.Paid && status != Status.Disputed) return false;
        if (_isDelivered(order.attestor, orderId)) return true;
        return status == Status.Paid && block.number > order.disputeEnd;
    }

    function canRefund(bytes32 orderId) external view returns (bool) {
        Order storage order = orders[orderId];
        if (order.status == Status.Open && block.number > order.revealEnd && order.winner == address(0)) {
            return true;
        }
        Status status = _effectiveStatus(order);
        if (status == Status.Awarded) {
            if (block.number <= order.payoutDeadline) return false;
        } else if (status == Status.Disputed) {
            if (block.number <= order.resolutionEnd) return false;
        } else {
            return false;
        }
        return !_isDelivered(order.attestor, orderId);
    }

    /*//////////////////////////////////////////////////////////////
                               INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _hashIntent(OrderIntent calldata intent) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_INTENT_TYPEHASH,
                    intent.sender,
                    intent.recipientCommitment,
                    intent.currency,
                    intent.localAmount,
                    intent.maxAusd,
                    intent.fee,
                    intent.relayer,
                    intent.attestor,
                    intent.salt
                )
            )
        );
    }

    /// @dev Binds the bidder's address, so a copied commitment is useless to anyone else.
    function _commitment(bytes32 orderId, address lp, uint256 amount, bytes32 salt)
        private
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(orderId, lp, amount, salt));
    }

    function _collateralFor(uint256 bid) private view returns (uint256) {
        return (bid * collateralBps + 9999) / 10_000;
    }

    /// @dev Lazy award: any later call finishes an auction nobody bothered to close.
    function _awardIfDue(bytes32 orderId, Order storage order) private {
        if (order.status == Status.Open && block.number > order.revealEnd && order.winner != address(0)) {
            order.status = Status.Awarded;
            registry.recordWin(order.winner);
            emit OrderAwarded(orderId, order.winner, order.winningBid, order.payoutDeadline);
        }
    }

    function _closeOrAward(bytes32 orderId, Order storage order) private {
        if (order.winner != address(0)) {
            _awardIfDue(orderId, order);
            return;
        }
        uint256 escrow = order.maxAusd;
        order.status = Status.Cancelled;
        emit OrderCancelled(orderId, escrow);
        _pay(order.sender, escrow);
    }

    function _effectiveStatus(Order storage order) private view returns (Status) {
        if (order.status == Status.Open && block.number > order.revealEnd && order.winner != address(0)) {
            return Status.Awarded;
        }
        return order.status;
    }

    /**
     * @dev Asks a sender-chosen contract whether the payout landed, without trusting it.
     *      Capped gas, at most 32 bytes of return data copied, and anything other than a clean
     *      `true` reads as "not delivered" — so an attestor that reverts, burns its stipend or
     *      returns nonsense can never brick an order. Callers must leave enough gas for the
     *      stipend, otherwise starving the call could pass off a real attestation as silence.
     */
    function _isDelivered(address attestor, bytes32 orderId) private view returns (bool delivered) {
        if (attestor == address(0)) return false;
        if (gasleft() < (ATTESTOR_GAS * 64) / 63 + GAS_BUFFER) revert InsufficientGas();

        bytes4 selector = IAttestor.isDelivered.selector;
        uint256 stipend = ATTESTOR_GAS;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, selector)
            mstore(add(ptr, 0x04), orderId)
            let ok := staticcall(stipend, attestor, ptr, 0x24, 0x00, 0x20)
            delivered := and(and(ok, eq(returndatasize(), 0x20)), eq(mload(0x00), 1))
        }
    }

    /**
     * @dev Sends AUSD, and never lets a refusal strand an order.
     *      The token can reject a transfer for reasons outside Rail — a frozen account, a global
     *      pause — so a failure is recorded as a claimable balance instead of reverting the
     *      settlement. The order completes; the money waits.
     */
    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool success, bytes memory data) = address(ausd).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (success && (data.length == 0 || abi.decode(data, (bool)))) return;

        claimable[to] += amount;
        emit PaymentDeferred(to, amount);
    }
}
