// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {RailCore} from "../src/RailCore.sol";
import {LPRegistry} from "../src/LPRegistry.sol";
import {SignedAttestor} from "../src/SignedAttestor.sol";

/**
 * @notice Deploys Rail and links the registry to the core.
 * @dev Windows are in blocks, from `docs/INTERFACES.md`. The demo values put a whole auction
 *      inside ~3 seconds at Monad's 300ms cadence; production dispute windows are hours, not 60
 *      seconds, and that number is the only thing standing between a lying provider and the
 *      escrow when no attestor has spoken.
 *
 *      RAIL_OWNER can only ever pause the creation of new orders. Settlement, refunds and claims
 *      stay permissionless whoever holds it.
 *
 *      forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
 */
contract Deploy is Script {
    uint64 constant COMMIT_BLOCKS = 5;
    uint64 constant REVEAL_BLOCKS = 5;
    uint64 constant PAYOUT_BLOCKS = 2000;
    uint64 constant DISPUTE_BLOCKS = 200;
    uint64 constant RESOLUTION_BLOCKS = 2000;
    uint16 constant COLLATERAL_BPS = 11_000;
    uint256 constant MIN_STAKE = 100e6;
    uint64 constant UNSTAKE_COOLDOWN = 86_400;

    function run() external {
        address ausd = vm.envAddress("AUSD_ADDRESS");
        uint256 deployerKey = vm.envUint("TESTNET_DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        LPRegistry registry = new LPRegistry(ausd, MIN_STAKE, UNSTAKE_COOLDOWN);
        RailCore core = new RailCore(
            ausd,
            address(registry),
            COMMIT_BLOCKS,
            REVEAL_BLOCKS,
            PAYOUT_BLOCKS,
            DISPUTE_BLOCKS,
            RESOLUTION_BLOCKS,
            COLLATERAL_BPS,
            owner
        );
        SignedAttestor attestor = new SignedAttestor(1, owner);
        registry.setRail(address(core));

        vm.stopBroadcast();

        console.log("AUSD          ", ausd);
        console.log("LPRegistry    ", address(registry));
        console.log("RailCore      ", address(core));
        console.log("SignedAttestor", address(attestor));
        console.log("owner         ", owner);
    }
}
