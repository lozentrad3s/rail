// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ISignedAttestor} from "./interfaces/IRail.sol";

/**
 * @title SignedAttestor
 * @notice Records signed evidence that a payout reached the recipient. Positive-only.
 * @dev Skeleton: the attack suite is written first (CLAUDE.md).
 */
contract SignedAttestor is ISignedAttestor {
    error Unimplemented();

    uint8 public immutable minLayer;
    address public owner;

    constructor(uint8 minLayer_, address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        if (minLayer_ == 0 || minLayer_ > 3) revert InvalidLayer();
        minLayer = minLayer_;
        owner = owner_;
    }

    function attest(bytes32, bytes32, bytes calldata) external pure {
        revert Unimplemented();
    }

    function setSigner(address, uint8) external pure {
        revert Unimplemented();
    }

    function isDelivered(bytes32) external pure returns (bool) {
        revert Unimplemented();
    }

    function recordOf(bytes32) external pure returns (uint8, bytes32, address) {
        revert Unimplemented();
    }

    function signerLayer(address) external pure returns (uint8) {
        revert Unimplemented();
    }
}
