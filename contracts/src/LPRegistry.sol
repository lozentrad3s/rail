// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ILPRegistry, Stats} from "./interfaces/IRail.sol";

/**
 * @title LPRegistry
 * @notice Stake, collateral locks and derived reputation for liquidity providers.
 * @dev Skeleton: the attack suite is written first (CLAUDE.md). Every entry point reverts until the
 *      behaviour it must survive is on record in `test/*.attack.t.sol`.
 */
contract LPRegistry is ILPRegistry {
    error Unimplemented();

    address public immutable ausd;
    uint256 public immutable minStake;
    uint64 public immutable unstakeCooldown;
    address public rail;

    constructor(address ausd_, uint256 minStake_, uint64 unstakeCooldown_) {
        if (ausd_ == address(0)) revert ZeroAddress();
        ausd = ausd_;
        minStake = minStake_;
        unstakeCooldown = unstakeCooldown_;
    }

    function stake(uint256) external pure {
        revert Unimplemented();
    }

    function requestUnstake(uint256) external pure {
        revert Unimplemented();
    }

    function withdraw() external pure {
        revert Unimplemented();
    }

    function setRail(address) external pure {
        revert Unimplemented();
    }

    function lock(bytes32, address, uint256) external pure {
        revert Unimplemented();
    }

    function unlock(bytes32) external pure {
        revert Unimplemented();
    }

    function settle(bytes32, uint256) external pure {
        revert Unimplemented();
    }

    function slash(bytes32) external pure returns (address, uint256) {
        revert Unimplemented();
    }

    function recordCommit(address) external pure {
        revert Unimplemented();
    }

    function recordReveal(address) external pure {
        revert Unimplemented();
    }

    function recordWin(address) external pure {
        revert Unimplemented();
    }

    function accountOf(address) external pure returns (uint256, uint256, uint256, uint64) {
        revert Unimplemented();
    }

    function freeStake(address) external pure returns (uint256) {
        revert Unimplemented();
    }

    function isEligible(address) external pure returns (bool) {
        revert Unimplemented();
    }

    function statsOf(address) external pure returns (Stats memory) {
        revert Unimplemented();
    }

    function reliabilityBps(address) external pure returns (uint256) {
        revert Unimplemented();
    }

    function lockOf(bytes32) external pure returns (address, uint256) {
        revert Unimplemented();
    }
}
