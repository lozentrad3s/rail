// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {IRailCore, OrderIntent, Authorization, Order, Status} from "../src/interfaces/IRail.sol";
import {
    RevertingAttestor,
    GasBurningAttestor,
    BloatedAttestor,
    ShortReturnAttestor,
    SwitchableAttestor,
    TrueAttestor
} from "./mocks/Attestors.sol";

/**
 * @notice Adversarial tests for every path that moves money.
 * @dev One line per test, in plain English, stating the attack. These are written before the
 *      implementation: a fund-moving path with no attack test is not ready to be written.
 */
contract RailCoreAttackTest is Base {
    bytes32 internal constant SALT_ONE = bytes32(uint256(0xA1));
    bytes32 internal constant SALT_TWO = bytes32(uint256(0xB2));

    function setUp() public override {
        super.setUp();
        stakeFor(lpOne, 1000e6);
        stakeFor(lpTwo, 1000e6);
    }

    /*//////////////////////////////////////////////////////////////
                        THE SENDER'S ONE SIGNATURE
    //////////////////////////////////////////////////////////////*/

    /// A relayer redirects the money to itself by swapping the recipient after the sender signs.
    function test_attack_relayerCannotChangeRecipient() public {
        OrderIntent memory intent = defaultIntent();
        Authorization memory auth = authorize(intent, senderKey);

        intent.recipientCommitment = keccak256(abi.encode(string("058"), string("9999999999"), bytes32(0)));

        vm.expectRevert();
        core.createOrder(intent, auth);
    }

    /// A relayer inflates the amount the sender pays after the sender signs.
    function test_attack_relayerCannotChangeAmount() public {
        OrderIntent memory intent = defaultIntent();
        Authorization memory auth = authorize(intent, senderKey);

        intent.maxAusd = intent.maxAusd * 2;

        vm.expectRevert();
        core.createOrder(intent, auth);
    }

    /// A relayer pays itself a bigger fee than the sender agreed to.
    function test_attack_relayerCannotChangeFee() public {
        OrderIntent memory intent = defaultIntent();
        Authorization memory auth = authorize(intent, senderKey);

        intent.fee = intent.maxAusd;

        vm.expectRevert();
        core.createOrder(intent, auth);
    }

    /// A relayer swaps in an attestor that always says "delivered", so nothing has to be paid out.
    function test_attack_relayerCannotChangeAttestor() public {
        OrderIntent memory intent = defaultIntent();
        Authorization memory auth = authorize(intent, senderKey);

        intent.attestor = address(new TrueAttestor());

        vm.expectRevert();
        core.createOrder(intent, auth);
    }

    /// The same signed authorisation is replayed to escrow the sender's money twice.
    function test_attack_authorizationCannotBeReplayed() public {
        OrderIntent memory intent = defaultIntent();
        Authorization memory auth = authorize(intent, senderKey);
        core.createOrder(intent, auth);

        vm.expectRevert();
        core.createOrder(intent, auth);
    }

    /// Someone else's signature is reused to escrow money from an account they don't control.
    function test_attack_forgedSignatureIsRejected() public {
        OrderIntent memory intent = defaultIntent();
        Authorization memory auth = authorize(intent, 0xBADBAD);

        vm.expectRevert();
        core.createOrder(intent, auth);
    }

    /// A stale quote is submitted long after the sender approved it.
    function test_attack_expiredAuthorizationIsRejected() public {
        OrderIntent memory intent = defaultIntent();
        Authorization memory auth = authorize(intent, senderKey);

        vm.warp(block.timestamp + 1 hours);

        vm.expectRevert();
        core.createOrder(intent, auth);
    }

    /*//////////////////////////////////////////////////////////////
                              THE AUCTION
    //////////////////////////////////////////////////////////////*/

    /// A provider copies a rival's sealed bid and reveals it as their own.
    function test_attack_copiedCommitmentCannotBeRevealedByAnother() public {
        bytes32 orderId = createOrder(defaultIntent());
        uint256 amount = 32e6;

        bytes32 stolen = commitment(orderId, lpOne, amount, SALT_ONE);
        vm.prank(lpTwo);
        core.commitBid(orderId, stolen);

        vm.roll(block.number + COMMIT_BLOCKS + 1);

        // lpTwo holds lpOne's commitment, but the commitment binds the bidder's address.
        vm.prank(lpTwo);
        vm.expectRevert(IRailCore.BadReveal.selector);
        core.revealBid(orderId, amount, SALT_ONE);
    }

    /// A provider watches the reveals, then commits a cheaper bid after seeing them.
    function test_attack_cannotCommitAfterCommitWindow() public {
        bytes32 orderId = createOrder(defaultIntent());
        vm.roll(block.number + COMMIT_BLOCKS + 1);

        vm.prank(lpOne);
        vm.expectRevert(IRailCore.CommitClosed.selector);
        core.commitBid(orderId, commitment(orderId, lpOne, 30e6, SALT_ONE));
    }

    /// A provider reveals after the window closes, once it knows it would have won.
    function test_attack_cannotRevealAfterRevealWindow() public {
        bytes32 orderId = createOrder(defaultIntent());
        bid(orderId, lpOne, 32e6, SALT_ONE);

        vm.roll(block.number + COMMIT_BLOCKS + REVEAL_BLOCKS + 1);

        vm.prank(lpOne);
        vm.expectRevert(IRailCore.RevealClosed.selector);
        core.revealBid(orderId, 32e6, SALT_ONE);
    }

    /// A provider reveals a different amount than the one it sealed.
    function test_attack_revealMustMatchCommitment() public {
        bytes32 orderId = createOrder(defaultIntent());
        bid(orderId, lpOne, 32e6, SALT_ONE);
        vm.roll(block.number + COMMIT_BLOCKS + 1);

        vm.prank(lpOne);
        vm.expectRevert(IRailCore.BadReveal.selector);
        core.revealBid(orderId, 20e6, SALT_ONE);
    }

    /// A provider bids more than the sender's reserve price, to be paid above the agreed maximum.
    function test_attack_bidAboveReserveIsRejected() public {
        OrderIntent memory intent = defaultIntent();
        bytes32 orderId = createOrder(intent);
        uint256 tooMuch = intent.maxAusd + 1;

        bid(orderId, lpOne, tooMuch, SALT_ONE);
        vm.roll(block.number + COMMIT_BLOCKS + 1);

        vm.prank(lpOne);
        vm.expectRevert(IRailCore.BidOutOfRange.selector);
        core.revealBid(orderId, tooMuch, SALT_ONE);
    }

    /// A provider bids zero to win every auction and deliver nothing.
    function test_attack_zeroBidIsRejected() public {
        bytes32 orderId = createOrder(defaultIntent());
        bid(orderId, lpOne, 0, SALT_ONE);
        vm.roll(block.number + COMMIT_BLOCKS + 1);

        vm.prank(lpOne);
        vm.expectRevert(IRailCore.BidOutOfRange.selector);
        core.revealBid(orderId, 0, SALT_ONE);
    }

    /// A provider wins with more money than it has staked, so a default would cost it nothing.
    function test_attack_cannotLeadWithoutCollateral() public {
        bytes32 orderId = createOrder(defaultIntent());
        address poor = address(0xB0B);
        ausd.mint(poor, MIN_STAKE);
        stakeFor(poor, MIN_STAKE); // eligible to bid, nowhere near enough to collateralise 32 AUSD

        bid(orderId, poor, 32e6, SALT_ONE);
        vm.roll(block.number + COMMIT_BLOCKS + 1);

        vm.prank(poor);
        vm.expectRevert();
        core.revealBid(orderId, 32e6, SALT_ONE);
    }

    /// An unstaked stranger bids, so a defaulting provider has nothing to slash.
    function test_attack_ineligibleProviderCannotCommit() public {
        bytes32 orderId = createOrder(defaultIntent());

        vm.prank(address(0xDEAD));
        vm.expectRevert(IRailCore.NotEligible.selector);
        core.commitBid(orderId, commitment(orderId, address(0xDEAD), 30e6, SALT_ONE));
    }

    /// The auction is closed early, before rivals have had their chance to reveal.
    function test_attack_cannotCloseAuctionEarly() public {
        bytes32 orderId = createOrder(defaultIntent());
        bid(orderId, lpOne, 32e6, SALT_ONE);

        vm.expectRevert(IRailCore.AuctionLive.selector);
        core.closeAuction(orderId);
    }

    /// The loser's collateral stays locked forever, freezing capital it should get back.
    function test_attack_outbidProviderGetsCollateralBack() public {
        bytes32 orderId = createOrder(defaultIntent());
        bid(orderId, lpOne, 33e6, SALT_ONE);
        bid(orderId, lpTwo, 31e6, SALT_TWO);
        vm.roll(block.number + COMMIT_BLOCKS + 1);

        reveal(orderId, lpOne, 33e6, SALT_ONE);
        uint256 lockedAfterFirst = lockedOf(lpOne);
        reveal(orderId, lpTwo, 31e6, SALT_TWO);

        assertGt(lockedAfterFirst, 0, "leader must be collateralised");
        assertEq(lockedOf(lpOne), 0, "outbid provider must be released");
        assertGt(lockedOf(lpTwo), 0, "new leader must be collateralised");
    }

    /*//////////////////////////////////////////////////////////////
                          SETTLEMENT AND DEFAULT
    //////////////////////////////////////////////////////////////*/

    /// A provider that never paid claims the escrow anyway.
    function test_attack_winnerCannotBeatTheDisputeWindow() public {
        bytes32 orderId = awardedOrder(32e6);

        vm.prank(lpOne);
        core.markPaid(orderId);

        // One block before the window closes, the optimistic path must still be shut.
        vm.roll(block.number + DISPUTE_BLOCKS);
        vm.expectRevert();
        core.finalize(orderId);
    }

    /// Someone settles the same order twice and drains a second payout from the contract.
    function test_attack_cannotSettleTwice() public {
        bytes32 orderId = awardedOrder(32e6);
        vm.prank(lpOne);
        core.markPaid(orderId);
        vm.roll(block.number + DISPUTE_BLOCKS + 1);
        core.finalize(orderId);

        vm.expectRevert();
        core.finalize(orderId);
    }

    /// A settled order is then refunded, paying the sender twice.
    function test_attack_cannotRefundAfterSettlement() public {
        bytes32 orderId = awardedOrder(32e6);
        vm.prank(lpOne);
        core.markPaid(orderId);
        vm.roll(block.number + DISPUTE_BLOCKS + 1);
        core.finalize(orderId);

        vm.roll(block.number + PAYOUT_BLOCKS + RESOLUTION_BLOCKS + 1);
        vm.expectRevert();
        core.refund(orderId);
    }

    /// A stranger marks someone else's order as paid.
    function test_attack_onlyWinnerCanMarkPaid() public {
        bytes32 orderId = awardedOrder(32e6);

        vm.prank(lpTwo);
        vm.expectRevert(IRailCore.NotWinner.selector);
        core.markPaid(orderId);
    }

    /// A provider that missed its deadline marks paid anyway to avoid being slashed.
    function test_attack_cannotMarkPaidAfterDeadline() public {
        bytes32 orderId = awardedOrder(32e6);
        vm.roll(block.number + PAYOUT_BLOCKS + 1);

        vm.prank(lpOne);
        vm.expectRevert(IRailCore.DeadlinePassed.selector);
        core.markPaid(orderId);
    }

    /// A stranger disputes a transfer that isn't theirs, to freeze someone else's payout.
    function test_attack_onlySenderCanDispute() public {
        bytes32 orderId = awardedOrder(32e6);
        vm.prank(lpOne);
        core.markPaid(orderId);

        vm.prank(address(0xDEAD));
        vm.expectRevert();
        core.dispute(orderId, "");
    }

    /// A dispute signed by the wrong key freezes a payout.
    function test_attack_forgedDisputeSignatureIsRejected() public {
        bytes32 orderId = awardedOrder(32e6);
        vm.prank(lpOne);
        core.markPaid(orderId);

        vm.expectRevert();
        core.dispute(orderId, signDispute(orderId, 0xBADBAD));
    }

    /// A defaulting provider withdraws its stake before it can be slashed.
    function test_attack_cannotUnstakeLockedCollateral() public {
        bytes32 orderId = awardedOrder(32e6);

        vm.prank(lpOne);
        vm.expectRevert();
        registry.requestUnstake(1000e6);

        // Defaulting must still cost the provider: the sender gets escrow plus slashed collateral.
        vm.roll(block.number + PAYOUT_BLOCKS + 1);
        uint256 before = ausd.balanceOf(sender);
        core.refund(orderId);
        assertGt(ausd.balanceOf(sender) - before, 33_600_000, "sender must receive escrow plus slash");
        assertEq(orderId, orderId);
    }

    /// The sender is refunded even though the provider really did pay the recipient.
    function test_attack_attestedOrderCannotBeRefunded() public {
        SwitchableAttestor live = new SwitchableAttestor();
        OrderIntent memory intent = defaultIntent();
        intent.attestor = address(live);
        bytes32 orderId = awardedOrderWith(intent, 32e6);

        live.set(true);
        vm.roll(block.number + PAYOUT_BLOCKS + 1);

        vm.expectRevert(IRailCore.Attested.selector);
        core.refund(orderId);
    }

    /*//////////////////////////////////////////////////////////////
                         HOSTILE OUTSIDE CONTRACTS
    //////////////////////////////////////////////////////////////*/

    /// A sender names an attestor that reverts, bricking settlement and refunds for everyone.
    function test_attack_revertingAttestorCannotBrickAnOrder() public {
        OrderIntent memory intent = defaultIntent();
        intent.attestor = address(new RevertingAttestor());
        bytes32 orderId = awardedOrderWith(intent, 32e6);

        vm.roll(block.number + PAYOUT_BLOCKS + 1);
        core.refund(orderId); // must succeed: a broken attestor reads as "not delivered"
        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Refunded));
    }

    /// An attestor burns all the gas it is given, to make the refund transaction fail.
    function test_attack_gasBurningAttestorCannotBrickAnOrder() public {
        OrderIntent memory intent = defaultIntent();
        intent.attestor = address(new GasBurningAttestor());
        bytes32 orderId = awardedOrderWith(intent, 32e6);

        vm.roll(block.number + PAYOUT_BLOCKS + 1);
        core.refund(orderId);
        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Refunded));
    }

    /// An attestor returns megabytes of data to make the caller pay for copying it.
    function test_attack_bloatedAttestorReturnIsIgnored() public {
        OrderIntent memory intent = defaultIntent();
        intent.attestor = address(new BloatedAttestor());
        bytes32 orderId = awardedOrderWith(intent, 32e6);

        vm.roll(block.number + PAYOUT_BLOCKS + 1);
        uint256 gasBefore = gasleft();
        core.refund(orderId);
        assertLt(gasBefore - gasleft(), 1_000_000, "return data must be capped");
    }

    /// An attestor returns fewer than 32 bytes, hoping the leftovers read as "true".
    function test_attack_shortAttestorReturnIsNotDelivered() public {
        OrderIntent memory intent = defaultIntent();
        intent.attestor = address(new ShortReturnAttestor());
        bytes32 orderId = awardedOrderWith(intent, 32e6);

        vm.roll(block.number + PAYOUT_BLOCKS + 1);
        core.refund(orderId); // not attested, so the refund must go through
        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Refunded));
    }

    /// A caller starves the attestor call of gas so a real attestation is skipped and money refunded.
    function test_attack_gasStarvedRefundCannotSkipAttestation() public {
        SwitchableAttestor live = new SwitchableAttestor();
        OrderIntent memory intent = defaultIntent();
        intent.attestor = address(live);
        bytes32 orderId = awardedOrderWith(intent, 32e6);

        live.set(true);
        vm.roll(block.number + PAYOUT_BLOCKS + 1);

        // Just enough gas to run refund but not enough to honour the attestor stipend.
        (bool ok,) = address(core).call{gas: 60_000}(abi.encodeCall(core.refund, (orderId)));
        assertFalse(ok, "a gas-starved call must fail rather than ignore the attestor");
        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Awarded));
    }

    /*//////////////////////////////////////////////////////////////
                    A TOKEN THAT REFUSES TO COOPERATE
    //////////////////////////////////////////////////////////////*/

    /// A frozen sender account makes settlement revert, trapping the provider's money forever.
    function test_attack_frozenSenderCannotBlockSettlement() public {
        bytes32 orderId = awardedOrder(32e6);
        vm.prank(lpOne);
        core.markPaid(orderId);
        vm.roll(block.number + DISPUTE_BLOCKS + 1);

        ausd.setFrozen(sender, true);
        core.finalize(orderId); // the change owed to the sender must not block the provider

        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Settled));
        assertGt(core.claimable(sender), 0, "the sender's change is held for later");
        assertEq(ausd.balanceOf(lpOne), 10_000e6 - 1000e6 + 32e6, "the provider is paid now");
    }

    /// A frozen provider blocks the sender's refund.
    function test_attack_frozenProviderCannotBlockRefund() public {
        bytes32 orderId = awardedOrder(32e6);
        vm.roll(block.number + PAYOUT_BLOCKS + 1);

        ausd.setFrozen(lpOne, true);
        core.refund(orderId);
        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Refunded));
    }

    /// The token pauses transfers globally, and an order is stuck mid-settlement.
    function test_attack_pausedTokenDefersRatherThanBricks() public {
        bytes32 orderId = awardedOrder(32e6);
        vm.prank(lpOne);
        core.markPaid(orderId);
        vm.roll(block.number + DISPUTE_BLOCKS + 1);

        ausd.setTransferPaused(true);
        core.finalize(orderId);
        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Settled));

        ausd.setTransferPaused(false);
        uint256 owed = core.claimable(lpOne);
        assertGt(owed, 0, "payment was deferred, not lost");
        core.claim(lpOne);
        assertEq(core.claimable(lpOne), 0, "claim pays out once the token works again");
    }

    /*//////////////////////////////////////////////////////////////
                           NOBODY IS IN CHARGE
    //////////////////////////////////////////////////////////////*/

    /// The owner pauses the protocol to trap money that is already escrowed.
    function test_attack_ownerCannotBlockSettlementOrRefund() public {
        bytes32 orderId = awardedOrder(32e6);

        vm.prank(owner);
        core.setCreatePaused(true);

        vm.prank(lpOne);
        core.markPaid(orderId);
        vm.roll(block.number + DISPUTE_BLOCKS + 1);
        core.finalize(orderId); // pausing creation must never touch money already in escrow
        assertEq(uint8(core.getOrder(orderId).status), uint8(Status.Settled));
    }

    /// A stranger pauses order creation.
    function test_attack_onlyOwnerCanPauseCreation() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        core.setCreatePaused(true);
    }

    /// A stranger calls the registry directly to lock, slash or credit stats.
    function test_attack_registryRejectsCallsThatAreNotRail() public {
        vm.startPrank(address(0xDEAD));
        vm.expectRevert();
        registry.lock(bytes32(uint256(1)), lpOne, 1e6);
        vm.expectRevert();
        registry.slash(bytes32(uint256(1)));
        vm.expectRevert();
        registry.recordWin(lpOne);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                               HELPERS
    //////////////////////////////////////////////////////////////*/

    function lockedOf(address lp) internal view returns (uint256 locked) {
        (, locked,,) = registry.accountOf(lp);
    }

    function awardedOrder(uint256 amount) internal returns (bytes32) {
        return awardedOrderWith(defaultIntent(), amount);
    }

    /// Runs one auction to completion with lpOne winning at `amount`.
    function awardedOrderWith(OrderIntent memory intent, uint256 amount) internal returns (bytes32 orderId) {
        orderId = createOrder(intent);
        bid(orderId, lpOne, amount, SALT_ONE);
        vm.roll(block.number + COMMIT_BLOCKS + 1);
        reveal(orderId, lpOne, amount, SALT_ONE);
        vm.roll(block.number + REVEAL_BLOCKS + 1);
        core.closeAuction(orderId);
    }
}
