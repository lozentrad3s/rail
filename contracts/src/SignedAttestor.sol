// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {ISignedAttestor} from "./interfaces/IRail.sol";

/**
 * @title SignedAttestor
 * @notice Records signed evidence that a payout reached the recipient.
 * @dev Positive-only and permanent. An attestation can make an order settle sooner; nothing here
 *      can cause a refund, a slash, or the removal of evidence already recorded. Layers rank the
 *      strength of proof — 1 the recipient's own confirmation, 2 a bank alert, 3 a Chainlink CRE
 *      report — and only a stronger layer may overwrite a weaker one.
 *
 *      This is not the optimistic layer. That one lives inside `RailCore` as the dispute window,
 *      precisely so no configuration can unplug it (CLAUDE.md §8).
 */
contract SignedAttestor is ISignedAttestor, EIP712 {
    bytes32 private constant ATTESTATION_TYPEHASH =
        keccak256("Attestation(bytes32 orderId,bytes32 evidenceHash)");

    struct Record {
        uint8 layer;
        bytes32 evidenceHash;
        address signer;
    }

    /// @notice The weakest evidence this instance accepts. Deploy one per trust policy.
    uint8 public immutable minLayer;
    address public owner;

    mapping(address => uint8) public signerLayer;
    mapping(bytes32 => Record) private records;

    constructor(uint8 minLayer_, address owner_) EIP712("RailSignedAttestor", "1") {
        if (owner_ == address(0)) revert ZeroAddress();
        if (minLayer_ == 0 || minLayer_ > 3) revert InvalidLayer();
        minLayer = minLayer_;
        owner = owner_;
    }

    /**
     * @notice Records evidence for an order. Anyone may submit it; only the signature matters.
     * @param evidenceHash keccak256 of the evidence itself — the SMS body, the confirmation
     *        record, the CRE report. The evidence stays off-chain; no PII ever lands here.
     */
    function attest(bytes32 orderId, bytes32 evidenceHash, bytes calldata signature) external {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(ATTESTATION_TYPEHASH, orderId, evidenceHash)));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError) revert UnknownSigner();

        uint8 layer = signerLayer[signer];
        if (layer == 0) revert UnknownSigner();
        if (layer <= records[orderId].layer) revert NotHigherLayer();

        records[orderId] = Record({layer: layer, evidenceHash: evidenceHash, signer: signer});
        emit Attested(orderId, signer, layer, evidenceHash);
    }

    /// @notice Authorises a signer at a layer, or removes it with layer 0.
    function setSigner(address signer, uint8 layer) external {
        if (msg.sender != owner) revert UnknownSigner();
        if (signer == address(0)) revert ZeroAddress();
        if (layer > 3) revert InvalidLayer();
        signerLayer[signer] = layer;
        emit SignerSet(signer, layer);
    }

    /// @notice True once evidence at or above this instance's minimum layer exists.
    function isDelivered(bytes32 orderId) external view returns (bool) {
        uint8 layer = records[orderId].layer;
        return layer > 0 && layer >= minLayer;
    }

    function recordOf(bytes32 orderId)
        external
        view
        returns (uint8 layer, bytes32 evidenceHash, address signer)
    {
        Record storage record = records[orderId];
        return (record.layer, record.evidenceHash, record.signer);
    }
}
