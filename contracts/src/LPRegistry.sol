// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {ILPRegistry, Stats} from "./interfaces/IRail.sol";

/**
 * @title LPRegistry
 * @notice Stake, collateral locks and derived reputation for liquidity providers.
 * @dev Two rules shape this contract. A provider always has more locked than it could steal, so a
 *      lock can only ever be taken from free stake. And reputation is derived, never written: the
 *      counters below are incremented by `RailCore` alone and there is no setter, no admin override
 *      and no way to reset a default (CLAUDE.md §6, §7).
 */
contract LPRegistry is ILPRegistry, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Account {
        uint256 staked;
        uint256 locked;
        uint256 pendingUnstake;
        uint64 unlockAt;
    }

    struct Lock {
        address lp;
        uint256 amount;
    }

    IERC20 public immutable ausd;
    uint256 public immutable minStake;
    uint64 public immutable unstakeCooldown;
    address private immutable deployer;

    address public rail;

    mapping(address => Account) private accounts;
    mapping(address => Stats) private stats;
    mapping(bytes32 => Lock) private locks;

    modifier onlyRail() {
        if (msg.sender != rail) revert NotRail();
        _;
    }

    constructor(address ausd_, uint256 minStake_, uint64 unstakeCooldown_) {
        if (ausd_ == address(0)) revert ZeroAddress();
        ausd = IERC20(ausd_);
        minStake = minStake_;
        unstakeCooldown = unstakeCooldown_;
        deployer = msg.sender;
    }

    /*//////////////////////////////////////////////////////////////
                              PROVIDERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Stakes AUSD as collateral. Requires an allowance for this contract.
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Account storage account = accounts[msg.sender];
        account.staked += amount;
        emit Staked(msg.sender, amount, account.staked);
        ausd.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Starts the cooldown on withdrawing `amount` of free stake.
     * @dev Locked collateral is not free stake, so a provider cannot begin pulling out money that
     *      is currently backing a bid it might default on. A second request restarts the clock.
     */
    function requestUnstake(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Account storage account = accounts[msg.sender];
        uint256 free = account.staked - account.locked;
        if (amount > free) revert InsufficientFreeStake(amount, free);

        account.staked -= amount;
        account.pendingUnstake += amount;
        account.unlockAt = uint64(block.timestamp) + unstakeCooldown;
        emit UnstakeRequested(msg.sender, amount, account.unlockAt);
    }

    /// @notice Withdraws everything whose cooldown has passed.
    function withdraw() external nonReentrant {
        Account storage account = accounts[msg.sender];
        uint256 amount = account.pendingUnstake;
        if (amount == 0) revert NothingPending();
        if (block.timestamp < account.unlockAt) revert CooldownActive(account.unlockAt);

        account.pendingUnstake = 0;
        account.unlockAt = 0;
        emit Withdrawn(msg.sender, amount);
        ausd.safeTransfer(msg.sender, amount);
    }

    /*//////////////////////////////////////////////////////////////
                             RAIL ONLY
    //////////////////////////////////////////////////////////////*/

    /// @notice Links `RailCore`, once and for all. This is the only privileged call in the contract.
    function setRail(address rail_) external {
        if (msg.sender != deployer) revert NotRail();
        if (rail_ == address(0)) revert ZeroAddress();
        if (rail != address(0)) revert RailAlreadySet();
        rail = rail_;
        emit RailSet(rail_);
    }

    /// @notice Locks collateral behind the leading bid on an order.
    function lock(bytes32 orderId, address lp, uint256 amount) external onlyRail {
        if (locks[orderId].lp != address(0)) revert LockExists(orderId);
        Account storage account = accounts[lp];
        uint256 free = account.staked - account.locked;
        if (amount > free) revert InsufficientFreeStake(amount, free);

        account.locked += amount;
        locks[orderId] = Lock({lp: lp, amount: amount});
        emit Locked(orderId, lp, amount);
    }

    /// @notice Releases a lock when its provider is outbid. No stats change: losing is not a fault.
    function unlock(bytes32 orderId) external onlyRail {
        (address lp, uint256 amount) = _release(orderId);
        emit Unlocked(orderId, lp, amount);
    }

    /// @notice Releases a lock on settlement and credits the provider's record.
    function settle(bytes32 orderId, uint256 volume) external onlyRail {
        (address lp, uint256 amount) = _release(orderId);
        Stats storage record = stats[lp];
        record.settled += 1;
        record.volumeSettled += uint128(volume);
        emit Settled(orderId, lp, volume);
        amount; // released above
    }

    /**
     * @notice Takes the locked collateral from a defaulting provider and hands it to `RailCore`.
     * @dev The money goes to the wronged sender, never to a treasury (CLAUDE.md §6). If the token
     *      refuses the transfer the whole refund reverts and can simply be retried — no state is
     *      left half-changed, and `refund` is permissionless so anyone can call it again.
     */
    function slash(bytes32 orderId) external onlyRail returns (address lp, uint256 amount) {
        (lp, amount) = _release(orderId);
        accounts[lp].staked -= amount;
        stats[lp].defaults += 1;
        emit Slashed(orderId, lp, amount);
        ausd.safeTransfer(rail, amount);
    }

    function recordCommit(address lp) external onlyRail {
        stats[lp].commits += 1;
    }

    function recordReveal(address lp) external onlyRail {
        stats[lp].reveals += 1;
    }

    function recordWin(address lp) external onlyRail {
        stats[lp].wins += 1;
    }

    /*//////////////////////////////////////////////////////////////
                                VIEWS
    //////////////////////////////////////////////////////////////*/

    function accountOf(address lp)
        external
        view
        returns (uint256 staked_, uint256 locked, uint256 pendingUnstake, uint64 unlockAt)
    {
        Account storage account = accounts[lp];
        return (account.staked, account.locked, account.pendingUnstake, account.unlockAt);
    }

    function freeStake(address lp) external view returns (uint256) {
        Account storage account = accounts[lp];
        return account.staked - account.locked;
    }

    function isEligible(address lp) external view returns (bool) {
        return accounts[lp].staked >= minStake;
    }

    function statsOf(address lp) external view returns (Stats memory) {
        return stats[lp];
    }

    /**
     * @notice Settled orders as a share of settled plus defaulted, in basis points.
     * @dev Laplace-smoothed, so a provider with one lucky settlement does not show as 100% reliable
     *      and a newcomer does not start at zero.
     */
    function reliabilityBps(address lp) external view returns (uint256) {
        Stats storage record = stats[lp];
        return ((uint256(record.settled) + 1) * 10_000) / (uint256(record.settled) + record.defaults + 2);
    }

    function lockOf(bytes32 orderId) external view returns (address lp, uint256 amount) {
        Lock storage entry = locks[orderId];
        return (entry.lp, entry.amount);
    }

    /*//////////////////////////////////////////////////////////////
                              INTERNAL
    //////////////////////////////////////////////////////////////*/

    function _release(bytes32 orderId) private returns (address lp, uint256 amount) {
        Lock storage entry = locks[orderId];
        lp = entry.lp;
        amount = entry.amount;
        if (lp == address(0)) revert NoLock(orderId);
        accounts[lp].locked -= amount;
        delete locks[orderId];
    }
}
