// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RailCore} from "../src/RailCore.sol";
import {LPRegistry} from "../src/LPRegistry.sol";
import {SignedAttestor} from "../src/SignedAttestor.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";
import {OrderIntent, Authorization, Status} from "../src/interfaces/IRail.sol";

/**
 * @notice Fixture shared by every Rail test: one token, one registry, one core, funded actors.
 * @dev Windows are the demo values from `docs/INTERFACES.md`. Blocks, never timestamps — a 1.5s
 *      auction phase cannot be expressed in Monad's 1-second timestamp granularity.
 */
abstract contract Base is Test {
    uint64 internal constant COMMIT_BLOCKS = 5;
    uint64 internal constant REVEAL_BLOCKS = 5;
    uint64 internal constant PAYOUT_BLOCKS = 2000;
    uint64 internal constant DISPUTE_BLOCKS = 200;
    uint64 internal constant RESOLUTION_BLOCKS = 2000;
    uint16 internal constant COLLATERAL_BPS = 11_000;
    uint256 internal constant MIN_STAKE = 100e6;
    uint64 internal constant UNSTAKE_COOLDOWN = 86_400;

    bytes32 internal constant ORDER_INTENT_TYPEHASH = keccak256(
        "OrderIntent(address sender,bytes32 recipientCommitment,bytes3 currency,uint256 localAmount,uint256 maxAusd,uint256 fee,address relayer,address attestor,bytes32 salt)"
    );
    bytes32 internal constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant DISPUTE_TYPEHASH = keccak256("Dispute(bytes32 orderId)");

    bytes3 internal constant NGN = bytes3("NGN");

    MockAUSD internal ausd;
    LPRegistry internal registry;
    RailCore internal core;
    SignedAttestor internal attestor;

    uint256 internal senderKey = 0xA11CE;
    address internal sender;
    address internal relayer = address(0xFEE);
    address internal lpOne = address(0x1D1);
    address internal lpTwo = address(0x1D2);
    address internal owner = address(0x0CE0);
    uint256 internal attestorSignerKey = 0xA77E;
    address internal attestorSigner;

    function setUp() public virtual {
        sender = vm.addr(senderKey);
        attestorSigner = vm.addr(attestorSignerKey);

        ausd = new MockAUSD();
        registry = new LPRegistry(address(ausd), MIN_STAKE, UNSTAKE_COOLDOWN);
        core = new RailCore(
            address(ausd),
            address(registry),
            COMMIT_BLOCKS,
            REVEAL_BLOCKS,
            PAYOUT_BLOCKS,
            DISPUTE_BLOCKS,
            RESOLUTION_BLOCKS,
            COLLATERAL_BPS,
            owner
        );
        attestor = new SignedAttestor(1, owner);

        ausd.mint(sender, 10_000e6);
        ausd.mint(lpOne, 10_000e6);
        ausd.mint(lpTwo, 10_000e6);

        // Auctions are measured in blocks from creation; start clear of genesis.
        vm.roll(1000);
    }

    /*//////////////////////////////////////////////////////////////
                               HELPERS
    //////////////////////////////////////////////////////////////*/

    function defaultIntent() internal view returns (OrderIntent memory) {
        return OrderIntent({
            // Salted: a bare 10-digit account number is brute-forceable in seconds (CLAUDE.md §3).
            recipientCommitment: keccak256(
                abi.encode(string("058"), string("0001234567"), bytes32(uint256(0xBEEF)))
            ),
            sender: sender,
            currency: NGN,
            localAmount: 5_000_000, // ₦50,000 in kobo
            maxAusd: 33_600_000, // $33.60 at 6 decimals — the reserve price
            fee: 130_000, // $0.13
            relayer: relayer,
            attestor: address(attestor),
            salt: bytes32(uint256(1))
        });
    }

    /// @dev The order id, computed here rather than asked of the contract under test.
    function orderIdOf(OrderIntent memory intent) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Rail"),
                keccak256("1"),
                block.chainid,
                address(core)
            )
        );
        bytes32 structHash = keccak256(
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
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    /// @dev Signs the sender's EIP-3009 authorisation, with the order id bound in as the nonce.
    function authorize(OrderIntent memory intent, uint256 key) internal view returns (Authorization memory) {
        bytes32 orderId = orderIdOf(intent);
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 120;
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                intent.sender,
                address(core),
                intent.maxAusd + intent.fee,
                validAfter,
                validBefore,
                orderId
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ausd.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return Authorization({validAfter: validAfter, validBefore: validBefore, v: v, r: r, s: s});
    }

    function createOrder(OrderIntent memory intent) internal returns (bytes32) {
        return core.createOrder(intent, authorize(intent, senderKey));
    }

    function commitment(bytes32 orderId, address lp, uint256 amount, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(orderId, lp, amount, salt));
    }

    function stakeFor(address lp, uint256 amount) internal {
        vm.startPrank(lp);
        ausd.approve(address(registry), amount);
        registry.stake(amount);
        vm.stopPrank();
    }

    function bid(bytes32 orderId, address lp, uint256 amount, bytes32 salt) internal {
        vm.prank(lp);
        core.commitBid(orderId, commitment(orderId, lp, amount, salt));
    }

    function reveal(bytes32 orderId, address lp, uint256 amount, bytes32 salt) internal {
        vm.prank(lp);
        core.revealBid(orderId, amount, salt);
    }

    function signDispute(bytes32 orderId, uint256 key) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Rail"),
                keccak256("1"),
                block.chainid,
                address(core)
            )
        );
        bytes32 structHash = keccak256(abi.encode(DISPUTE_TYPEHASH, orderId));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
