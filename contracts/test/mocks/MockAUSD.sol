// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {IERC3009} from "../../src/interfaces/IRail.sol";

/**
 * @title MockAUSD
 * @notice Stands in for Agora's AUSD, including the parts that can break Rail.
 * @dev Modelled on the live implementation (verified on Monad, 16 Sep 2026): 6 decimals, EIP-712
 *      domain "Agora Dollar" v1, and three global switches the real token really has —
 *      `isAccountFrozen`, `isTransferPaused` and `isSignatureVerificationPaused`. Rail must survive
 *      all three, so the tests need to flip them.
 */
contract MockAUSD is ERC20, EIP712, IERC3009 {
    bytes32 private constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    mapping(address => mapping(bytes32 => bool)) private _authorizationState;
    mapping(address => bool) public isAccountFrozen;
    bool public isTransferPaused;
    bool public isSignatureVerificationPaused;

    error AccountFrozen(address account);
    error TransferPaused();
    error SignatureVerificationPaused();
    error AuthorizationUsed();
    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error CallerMustBePayee();
    error InvalidSignature();

    constructor() ERC20("Agora Dollar", "AUSD") EIP712("Agora Dollar", "1") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice The real AUSD exposes this, and Rail's clients read it rather than hardcoding a domain.
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /*//////////////////////////////////////////////////////////////
                          TEST-ONLY CONTROLS
    //////////////////////////////////////////////////////////////*/

    function setFrozen(address account, bool frozen) external {
        isAccountFrozen[account] = frozen;
    }

    function setTransferPaused(bool paused) external {
        isTransferPaused = paused;
    }

    function setSignatureVerificationPaused(bool paused) external {
        isSignatureVerificationPaused = paused;
    }

    /*//////////////////////////////////////////////////////////////
                                EIP-3009
    //////////////////////////////////////////////////////////////*/

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationState[authorizer][nonce];
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        // The whole reason Rail uses `receive` rather than `transfer`: only the payee can submit it.
        if (msg.sender != to) revert CallerMustBePayee();
        if (isSignatureVerificationPaused) revert SignatureVerificationPaused();
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (_authorizationState[from][nonce]) revert AuthorizationUsed();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce
                )
            )
        );
        if (ECDSA.recover(digest, v, r, s) != from) revert InvalidSignature();

        _authorizationState[from][nonce] = true;
        _transfer(from, to, value);
    }

    /// @dev Every movement of AUSD can fail for reasons outside Rail's control.
    function _update(address from, address to, uint256 value) internal override {
        if (isTransferPaused) revert TransferPaused();
        if (from != address(0) && isAccountFrozen[from]) revert AccountFrozen(from);
        if (to != address(0) && isAccountFrozen[to]) revert AccountFrozen(to);
        super._update(from, to, value);
    }
}
