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
    /**
     * How long a provider has to get a bid in.
     *
     * Five blocks is the theoretical floor at Monad's block time, and it is what the first
     * deployment used. Fifteen replaced it, and fifteen was still too tight: measured on the public
     * testnet RPC, inclusion alone takes 3 blocks at the median and 5 at the worst, and a real
     * commit — detect the order, price it, sign it, get it mined — was observed taking 7. One bid
     * in a live run missed its window by a single block and the auction closed with nobody in it.
     *
     * Thirty leaves roughly four times the worst measured inclusion latency as headroom, so a
     * provider on an ordinary connection can compete rather than only the luckiest one. The whole
     * auction still finishes inside half a minute, against days for the incumbents.
     *
     * **One hundred and fifty, because a person has to be able to bid.** Thirty blocks is twelve
     * seconds, which is fine for a bot and impossible for a human: the provider page polls, then
     * somebody has to read the request, decide a price, type it, approve a wallet prompt and wait
     * for inclusion. Rail is meant to be open to any provider holding naira and a bank account,
     * and a window only software can reach quietly makes it a professionals-only market, which is
     * the thing it exists to replace.
     *
     * A bot loses nothing: it still bids in under two seconds, and a wider window does not slow its
     * commit. What it costs is settlement time, about two minutes instead of twenty-four seconds,
     * and that is the right trade for a market anyone can join.
     *
     * The payout deadline moves with it: thirteen minutes to notice a win and complete a bank
     * transfer is tight for a person, thirty is not.
     *
     * The real fix for the inclusion variance is a dedicated RPC endpoint. Until there is one, the
     * padding stays. Override with COMMIT_BLOCKS / REVEAL_BLOCKS.
     */
    uint64 constant COMMIT_BLOCKS = 150;
    uint64 constant REVEAL_BLOCKS = 150;
    uint64 constant PAYOUT_BLOCKS = 4500;
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
