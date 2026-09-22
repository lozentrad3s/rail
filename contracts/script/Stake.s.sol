// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {LPRegistry} from "../src/LPRegistry.sol";

/**
 * Stakes a provider into the registry.
 *
 * Every deployment needs this before an auction can happen, and onboarding a real provider needs
 * it too — so it is a script rather than something done by hand with `cast` and remembered wrongly
 * the next time.
 *
 *   LP_PRIVATE_KEY=0x… STAKE_AMOUNT=1000000000 \
 *     forge script script/Stake.s.sol --rpc-url $RPC_URL --broadcast
 *
 * `STAKE_AMOUNT` is in AUSD base units — 1_000_000 is one dollar. The registry's own `minStake`
 * is the floor, and a provider can never win more than its free stake will collateralise.
 */
contract Stake is Script {
    function run() external {
        address ausd = vm.envAddress("AUSD_ADDRESS");
        address registryAddress = vm.envAddress("LP_REGISTRY");
        uint256 lpKey = vm.envUint("LP_PRIVATE_KEY");
        uint256 amount = vm.envUint("STAKE_AMOUNT");

        LPRegistry registry = LPRegistry(registryAddress);
        address lp = vm.addr(lpKey);

        vm.startBroadcast(lpKey);

        // Approved exactly, not infinitely: an allowance left open is an allowance someone else
        // eventually finds a way to spend.
        IERC20(ausd).approve(registryAddress, amount);
        registry.stake(amount);

        vm.stopBroadcast();

        console.log("provider  ", lp);
        console.log("registry  ", registryAddress);
        console.log("staked    ", amount);
    }
}
