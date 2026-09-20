// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title Rail interfaces
 * @notice Authoritative signatures, events and errors for the Rail protocol.
 * @dev Semantics live in `docs/INTERFACES.md`. If this file and that document disagree, the
 *      document wins — change it first, then this file, then the implementations.
 */

/*//////////////////////////////////////////////////////////////
                              TYPES
//////////////////////////////////////////////////////////////*/

enum Status {
    None,
    Open,
    Awarded,
    Paid,
    Disputed,
    Settled,
    Refunded,
    Cancelled
}

/// @notice What the sender signs, indirectly: its hash is the EIP-3009 nonce (docs §3.1–3.2).
struct OrderIntent {
    address sender;
    bytes32 recipientCommitment;
    bytes3 currency;
    uint256 localAmount;
    uint256 maxAusd;
    uint256 fee;
    address relayer;
    address attestor;
    bytes32 salt;
}

/// @notice The sender's EIP-3009 `ReceiveWithAuthorization` signature and its validity window.
struct Authorization {
    uint256 validAfter;
    uint256 validBefore;
    uint8 v;
    bytes32 r;
    bytes32 s;
}

/// @dev Packed so an order costs as few storage pages as possible (Monad prices per 128-slot page).
struct Order {
    address sender;
    Status status;
    bytes3 currency;
    uint64 commitEnd;
    address winner;
    uint64 revealEnd;
    address attestor;
    uint64 payoutDeadline;
    uint128 maxAusd;
    uint128 winningBid;
    bytes32 recipientCommitment;
    uint256 localAmount;
    uint64 disputeEnd;
    uint64 resolutionEnd;
}

/// @notice Append-only counters. No setter exists, and none may ever be added (CLAUDE.md §7).
struct Stats {
    uint64 commits;
    uint64 reveals;
    uint64 wins;
    uint64 settled;
    uint64 defaults;
    uint128 volumeSettled;
}

/*//////////////////////////////////////////////////////////////
                            EXTERNAL
//////////////////////////////////////////////////////////////*/

/// @notice The subset of AUSD that Rail uses.
interface IERC3009 {
    /**
     * @notice Pulls `value` from `from`, authorised by a signature the recipient submits.
     * @dev `receiveWithAuthorization`, never `transferWithAuthorization`: the latter can be
     *      front-run by anyone who sees the signature, because it does not bind the caller.
     */
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /// @notice True once `nonce` has been used by `authorizer`.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}

/**
 * @notice Evidence that a payout reached the recipient.
 * @dev Positive-only by construction: an attestor can make an order settle sooner, and can never
 *      cause a refund or a slash. `RailCore` calls this through a gas-capped staticcall and treats
 *      a revert, a short return, or anything other than `true` as "not delivered".
 */
interface IAttestor {
    function isDelivered(bytes32 orderId) external view returns (bool);
}

/*//////////////////////////////////////////////////////////////
                           LP REGISTRY
//////////////////////////////////////////////////////////////*/

interface ILPRegistry {
    event Staked(address indexed lp, uint256 amount, uint256 staked);
    event UnstakeRequested(address indexed lp, uint256 amount, uint64 unlockAt);
    event Withdrawn(address indexed lp, uint256 amount);
    event Locked(bytes32 indexed orderId, address indexed lp, uint256 amount);
    event Unlocked(bytes32 indexed orderId, address indexed lp, uint256 amount);
    event Settled(bytes32 indexed orderId, address indexed lp, uint256 volume);
    event Slashed(bytes32 indexed orderId, address indexed lp, uint256 amount);
    event RailSet(address indexed rail);

    error NotRail();
    error RailAlreadySet();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientFreeStake(uint256 required, uint256 available);
    error NothingPending();
    error CooldownActive(uint64 unlockAt);
    error LockExists(bytes32 orderId);
    error NoLock(bytes32 orderId);

    function stake(uint256 amount) external;
    function requestUnstake(uint256 amount) external;
    function withdraw() external;
    function setRail(address rail) external;

    function lock(bytes32 orderId, address lp, uint256 amount) external;
    function unlock(bytes32 orderId) external;
    function settle(bytes32 orderId, uint256 volume) external;
    function slash(bytes32 orderId) external returns (address lp, uint256 amount);
    function recordCommit(address lp) external;
    function recordReveal(address lp) external;
    function recordWin(address lp) external;

    function accountOf(address lp)
        external
        view
        returns (uint256 staked, uint256 locked, uint256 pendingUnstake, uint64 unlockAt);
    function freeStake(address lp) external view returns (uint256);
    function isEligible(address lp) external view returns (bool);
    function statsOf(address lp) external view returns (Stats memory);
    function reliabilityBps(address lp) external view returns (uint256);
    function lockOf(bytes32 orderId) external view returns (address lp, uint256 amount);
    function minStake() external view returns (uint256);
    function unstakeCooldown() external view returns (uint64);
}

/*//////////////////////////////////////////////////////////////
                             RAILCORE
//////////////////////////////////////////////////////////////*/

interface IRailCore {
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed sender,
        bytes3 indexed currency,
        uint256 localAmount,
        uint256 maxAusd,
        uint256 fee,
        address attestor,
        bytes32 recipientCommitment,
        uint64 commitEnd,
        uint64 revealEnd
    );
    event BidCommitted(bytes32 indexed orderId, address indexed lp, bytes32 commitment);
    event BidRevealed(bytes32 indexed orderId, address indexed lp, uint256 amount, bool leading);
    event CollateralLocked(bytes32 indexed orderId, address indexed lp, uint256 amount);
    event OrderAwarded(
        bytes32 indexed orderId, address indexed winner, uint256 winningBid, uint64 payoutDeadline
    );
    event OrderCancelled(bytes32 indexed orderId, uint256 refunded);
    event MarkedPaid(bytes32 indexed orderId, address indexed winner, uint64 disputeEnd);
    event Disputed(bytes32 indexed orderId, address indexed sender, uint64 resolutionEnd);
    event OrderSettled(
        bytes32 indexed orderId, address indexed winner, uint256 paidToLp, uint256 changeToSender
    );
    event OrderRefunded(bytes32 indexed orderId, address indexed sender, uint256 escrow, uint256 slashed);
    event PaymentDeferred(address indexed to, uint256 amount);
    event Claimed(address indexed account, uint256 amount);
    event CreatePausedSet(bool paused);

    error CreatePaused();
    error OrderExists();
    error InvalidIntent();
    error ZeroAddress();
    error NotEligible();
    error NotOpen();
    error CommitClosed();
    error RevealClosed();
    error RevealNotStarted();
    error NoCommitment();
    error BadReveal();
    error BidOutOfRange();
    error AuctionLive();
    error NoBids();
    error NotWinner();
    error NotSender();
    error BadSignature();
    error WrongStatus(Status found);
    error DeadlinePassed();
    error WindowOpen();
    error Attested();
    error InsufficientGas();
    error NothingToClaim();
    error NotOwner();

    function createOrder(OrderIntent calldata intent, Authorization calldata authorization)
        external
        returns (bytes32 orderId);
    function commitBid(bytes32 orderId, bytes32 commitment) external;
    function revealBid(bytes32 orderId, uint256 amount, bytes32 salt) external;
    function closeAuction(bytes32 orderId) external;
    function markPaid(bytes32 orderId) external;
    function dispute(bytes32 orderId, bytes calldata signature) external;
    function finalize(bytes32 orderId) external;
    function refund(bytes32 orderId) external;
    function claim(address account) external;
    function setCreatePaused(bool paused) external;

    function getOrder(bytes32 orderId) external view returns (Order memory);
    function hashIntent(OrderIntent calldata intent) external view returns (bytes32);
    function computeCommitment(bytes32 orderId, address lp, uint256 amount, bytes32 salt)
        external
        pure
        returns (bytes32);
    function commitmentOf(bytes32 orderId, address lp) external view returns (bytes32);
    function collateralFor(uint256 bid) external view returns (uint256);
    function canFinalize(bytes32 orderId) external view returns (bool);
    function canRefund(bytes32 orderId) external view returns (bool);
    function claimable(address account) external view returns (uint256);
}

/*//////////////////////////////////////////////////////////////
                          SIGNED ATTESTOR
//////////////////////////////////////////////////////////////*/

interface ISignedAttestor is IAttestor {
    /// @param layer 1 = recipient confirmation, 2 = bank alert, 3 = CRE. 0 removes the signer.
    event SignerSet(address indexed signer, uint8 layer);
    event Attested(bytes32 indexed orderId, address indexed signer, uint8 layer, bytes32 evidenceHash);

    error UnknownSigner();
    error NotHigherLayer();
    error InvalidLayer();
    error ZeroAddress();

    function attest(bytes32 orderId, bytes32 evidenceHash, bytes calldata signature) external;
    function setSigner(address signer, uint8 layer) external;
    function recordOf(bytes32 orderId)
        external
        view
        returns (uint8 layer, bytes32 evidenceHash, address signer);
    function signerLayer(address signer) external view returns (uint8);
    function minLayer() external view returns (uint8);
}
