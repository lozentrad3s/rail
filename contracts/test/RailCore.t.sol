// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {OrderIntent, Status, Stats} from "../src/interfaces/IRail.sol";

/// @notice The path a real transfer takes, and the promises Rail makes while taking it.
contract RailCoreTest is Base {
    bytes32 internal constant SALT_ONE = bytes32(uint256(0xA1));
    bytes32 internal constant SALT_TWO = bytes32(uint256(0xB2));

    function setUp() public override {
        super.setUp();
        stakeFor(lpOne, 1000e6);
        stakeFor(lpTwo, 1000e6);
        vm.prank(owner);
        attestor.setSigner(attestorSigner, 1);
    }

    /// The order id must be computable off-chain, or the relayer cannot build the signature.
    function test_orderIdIsTheIndependentlyComputedHash() public view {
        OrderIntent memory intent = defaultIntent();
        assertEq(core.hashIntent(intent), orderIdOf(intent));
    }

    /// Competition lowers the price and the difference goes back to the sender, not to Rail.
    function test_senderCapturesTheAuctionSaving() public {
        OrderIntent memory intent = defaultIntent();
        uint256 senderBefore = ausd.balanceOf(sender);
        bytes32 orderId = createOrder(intent);

        assertEq(senderBefore - ausd.balanceOf(sender), intent.maxAusd + intent.fee, "escrow plus fee");
        assertEq(ausd.balanceOf(relayer), intent.fee, "the relayer is paid its fee up front");

        bid(orderId, lpOne, 33e6, SALT_ONE);
        bid(orderId, lpTwo, 32_610_000, SALT_TWO); // $32.61
        vm.roll(block.number + COMMIT_BLOCKS + 1);
        reveal(orderId, lpOne, 33e6, SALT_ONE);
        reveal(orderId, lpTwo, 32_610_000, SALT_TWO);
        vm.roll(block.number + REVEAL_BLOCKS + 1);

        core.closeAuction(orderId);
        assertEq(core.getOrder(orderId).winner, lpTwo, "the lower bid wins");

        uint256 lpBefore = ausd.balanceOf(lpTwo);
        uint256 senderBeforeSettle = ausd.balanceOf(sender);

        vm.prank(lpTwo);
        core.markPaid(orderId);
        vm.roll(block.number + DISPUTE_BLOCKS + 1);
        core.finalize(orderId);

        assertEq(ausd.balanceOf(lpTwo) - lpBefore, 32_610_000, "the winner is paid exactly its bid");
        assertEq(
            ausd.balanceOf(sender) - senderBeforeSettle,
            intent.maxAusd - 32_610_000,
            "every cent of the saving returns to the sender"
        );
        assertEq(ausd.balanceOf(address(core)), 0, "the protocol keeps nothing");
        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Settled));
    }

    /// Evidence beats waiting: an attestation settles without sitting out the dispute window.
    function test_attestationSettlesImmediately() public {
        bytes32 orderId = createOrder(defaultIntent());
        bid(orderId, lpOne, 32e6, SALT_ONE);
        vm.roll(block.number + COMMIT_BLOCKS + 1);
        reveal(orderId, lpOne, 32e6, SALT_ONE);
        vm.roll(block.number + REVEAL_BLOCKS + 1);
        core.closeAuction(orderId);

        // The recipient confirms they received the money (layer 1).
        bytes32 evidenceHash = keccak256("recipient-confirm");
        attestor.attest(orderId, evidenceHash, signAttestation(orderId, evidenceHash, attestorSignerKey));

        assertTrue(core.canFinalize(orderId), "attested orders settle at once");
        core.finalize(orderId);
        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Settled));
    }

    /// An auction nobody bids in returns the sender's money, and anyone can trigger that.
    function test_auctionWithNoBidsRefundsTheSender() public {
        OrderIntent memory intent = defaultIntent();
        uint256 before = ausd.balanceOf(sender);
        bytes32 orderId = createOrder(intent);
        vm.roll(block.number + COMMIT_BLOCKS + REVEAL_BLOCKS + 1);

        vm.prank(address(0xDEAD)); // a stranger, because refunds must never need our backend
        core.refund(orderId);

        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Cancelled));
        assertEq(before - ausd.balanceOf(sender), intent.fee, "only the fee is spent");
    }

    /// Reputation is derived from what happened, and only RailCore can add to it.
    function test_reputationCountsRealOutcomes() public {
        bytes32 orderId = createOrder(defaultIntent());
        bid(orderId, lpOne, 32e6, SALT_ONE);
        vm.roll(block.number + COMMIT_BLOCKS + 1);
        reveal(orderId, lpOne, 32e6, SALT_ONE);
        vm.roll(block.number + REVEAL_BLOCKS + 1);
        core.closeAuction(orderId);
        vm.prank(lpOne);
        core.markPaid(orderId);
        vm.roll(block.number + DISPUTE_BLOCKS + 1);
        core.finalize(orderId);

        Stats memory record = registry.statsOf(lpOne);
        assertEq(record.commits, 1);
        assertEq(record.reveals, 1);
        assertEq(record.wins, 1);
        assertEq(record.settled, 1);
        assertEq(record.defaults, 0);
        assertEq(record.volumeSettled, 32e6);
        assertGt(registry.reliabilityBps(lpOne), 6000);
    }

    /// Collateral is at least the bid, whatever rounding does.
    function testFuzz_collateralNeverUndercutsTheBid(uint128 amount) public view {
        vm.assume(amount > 0);
        assertGe(core.collateralFor(amount), amount);
    }

    function signAttestation(bytes32 orderId, bytes32 evidenceHash, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("RailSignedAttestor"),
                keccak256("1"),
                block.chainid,
                address(attestor)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(keccak256("Attestation(bytes32 orderId,bytes32 evidenceHash)"), orderId, evidenceHash)
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }
}
