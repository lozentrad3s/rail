// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IRailCore, Order, OrderIntent, Authorization} from "./interfaces/IRail.sol";

/**
 * @title RailCore
 * @notice Escrow, sealed-bid auction, settlement and slashing.
 * @dev Skeleton: the attack suite is written first (CLAUDE.md). Every entry point reverts until the
 *      behaviour it must survive is on record in `test/*.attack.t.sol`.
 */
contract RailCore is IRailCore {
    error Unimplemented();

    uint256 public constant ATTESTOR_GAS = 50_000;

    address public immutable ausd;
    address public immutable registry;
    uint64 public immutable commitBlocks;
    uint64 public immutable revealBlocks;
    uint64 public immutable payoutBlocks;
    uint64 public immutable disputeBlocks;
    uint64 public immutable resolutionBlocks;
    uint16 public immutable collateralBps;
    address public owner;
    bool public createPaused;

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
    ) {
        if (ausd_ == address(0) || registry_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        if (collateralBps_ < 10_000) revert InvalidIntent();
        ausd = ausd_;
        registry = registry_;
        commitBlocks = commitBlocks_;
        revealBlocks = revealBlocks_;
        payoutBlocks = payoutBlocks_;
        disputeBlocks = disputeBlocks_;
        resolutionBlocks = resolutionBlocks_;
        collateralBps = collateralBps_;
        owner = owner_;
    }

    function createOrder(OrderIntent calldata, Authorization calldata) external pure returns (bytes32) {
        revert Unimplemented();
    }

    function commitBid(bytes32, bytes32) external pure {
        revert Unimplemented();
    }

    function revealBid(bytes32, uint256, bytes32) external pure {
        revert Unimplemented();
    }

    function closeAuction(bytes32) external pure {
        revert Unimplemented();
    }

    function markPaid(bytes32) external pure {
        revert Unimplemented();
    }

    function dispute(bytes32, bytes calldata) external pure {
        revert Unimplemented();
    }

    function finalize(bytes32) external pure {
        revert Unimplemented();
    }

    function refund(bytes32) external pure {
        revert Unimplemented();
    }

    function claim(address) external pure {
        revert Unimplemented();
    }

    function setCreatePaused(bool) external pure {
        revert Unimplemented();
    }

    function getOrder(bytes32) external pure returns (Order memory) {
        revert Unimplemented();
    }

    function hashIntent(OrderIntent calldata) external pure returns (bytes32) {
        revert Unimplemented();
    }

    function computeCommitment(bytes32, address, uint256, bytes32) external pure returns (bytes32) {
        revert Unimplemented();
    }

    function commitmentOf(bytes32, address) external pure returns (bytes32) {
        revert Unimplemented();
    }

    function collateralFor(uint256) external pure returns (uint256) {
        revert Unimplemented();
    }

    function canFinalize(bytes32) external pure returns (bool) {
        revert Unimplemented();
    }

    function canRefund(bytes32) external pure returns (bool) {
        revert Unimplemented();
    }

    function claimable(address) external pure returns (uint256) {
        revert Unimplemented();
    }
}
