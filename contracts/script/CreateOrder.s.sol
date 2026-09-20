// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {RailCore} from "../src/RailCore.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {OrderIntent, Authorization} from "../src/interfaces/IRail.sol";

interface IDomain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/**
 * @notice Creates one real order on testnet, from an account that holds no MON.
 * @dev This is the spike that matters: the sender signs, a relayer pays the fee, and the live AUSD
 *      contract — not a mock — decides whether the signature is good. The token's domain is read
 *      from the token itself rather than hardcoded.
 *
 *      forge script script/CreateOrder.s.sol --rpc-url $RPC_URL --broadcast
 */
contract CreateOrder is Script {
    bytes32 constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function run() external {
        address ausd = vm.envAddress("AUSD_ADDRESS");
        RailCore core = RailCore(vm.envAddress("RAIL_CORE"));
        address attestor = vm.envAddress("RAIL_ATTESTOR");
        uint256 senderKey = vm.envUint("TESTNET_SENDER_PRIVATE_KEY");
        uint256 relayerKey = vm.envUint("TESTNET_DEPLOYER_PRIVATE_KEY");

        address sender = vm.addr(senderKey);
        address relayer = vm.addr(relayerKey);

        OrderIntent memory intent = OrderIntent({
            sender: sender,
            // Salted commitment: the bank details themselves never touch the chain.
            recipientCommitment: keccak256(
                abi.encode(string("058"), string("0001234567"), keccak256(abi.encode(block.number, sender)))
            ),
            currency: bytes3("NGN"),
            localAmount: 5_000_000, // ₦50,000 in kobo
            maxAusd: 33_600_000, // $33.60 reserve
            fee: 130_000, // $0.13 to the relayer
            relayer: relayer,
            attestor: attestor,
            salt: keccak256(abi.encode(block.timestamp, block.number))
        });

        bytes32 orderId = core.hashIntent(intent);
        Authorization memory auth = _authorize(ausd, address(core), intent, orderId, senderKey);

        uint256 senderBefore = IERC20(ausd).balanceOf(sender);

        vm.startBroadcast(relayerKey);
        core.createOrder(intent, auth);
        vm.stopBroadcast();

        console.log("orderId");
        console.logBytes32(orderId);
        console.log("sender          ", sender);
        console.log("sender MON      ", sender.balance);
        console.log("sender AUSD before", senderBefore);
        console.log("sender AUSD after ", IERC20(ausd).balanceOf(sender));
        console.log("escrowed in core  ", IERC20(ausd).balanceOf(address(core)));
        console.log("status (1 = Open) ", uint8(core.getOrder(orderId).status));
    }

    /// @dev The token's own domain, read from the token. Never hardcode it.
    function _authorize(address ausd, address core, OrderIntent memory intent, bytes32 orderId, uint256 key)
        private
        view
        returns (Authorization memory)
    {
        uint256 validAfter = block.timestamp - 60;
        uint256 validBefore = block.timestamp + 3600;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                IDomain(ausd).DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                        intent.sender,
                        core,
                        intent.maxAusd + intent.fee,
                        validAfter,
                        validBefore,
                        orderId // the order id IS the nonce: tamper with anything and this breaks
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return Authorization({validAfter: validAfter, validBefore: validBefore, v: v, r: r, s: s});
    }
}
