// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAttestor} from "../../src/interfaces/IRail.sol";

/// @notice Always says delivered.
contract TrueAttestor is IAttestor {
    function isDelivered(bytes32) external pure returns (bool) {
        return true;
    }
}

/// @notice Never says delivered.
contract FalseAttestor is IAttestor {
    function isDelivered(bytes32) external pure returns (bool) {
        return false;
    }
}

/// @notice Reverts on every call. A sender can name any address as their attestor, including this.
contract RevertingAttestor is IAttestor {
    error Nope();

    function isDelivered(bytes32) external pure returns (bool) {
        revert Nope();
    }
}

/// @notice Burns everything it is given, to try to make the caller's whole transaction fail.
contract GasBurningAttestor is IAttestor {
    function isDelivered(bytes32) external view returns (bool) {
        uint256 burn;
        while (gasleft() > 1000) {
            burn = uint256(keccak256(abi.encode(burn, gasleft())));
        }
        return true;
    }
}

/// @notice Returns far more data than a bool, to try to blow up the caller's memory.
contract BloatedAttestor is IAttestor {
    function isDelivered(bytes32) external pure returns (bool) {
        assembly {
            // 100k words of return data. A caller that copies it all pays for it.
            return(0, 3200000)
        }
    }
}

/// @notice Returns fewer than 32 bytes. Must read as "not delivered", never as garbage.
contract ShortReturnAttestor is IAttestor {
    function isDelivered(bytes32) external pure returns (bool) {
        assembly {
            mstore(0, 1)
            return(0, 8)
        }
    }
}

/// @notice Flips its answer, to test that evidence is read at the moment it is needed.
contract SwitchableAttestor is IAttestor {
    bool public delivered;

    function set(bool value) external {
        delivered = value;
    }

    function isDelivered(bytes32) external view returns (bool) {
        return delivered;
    }
}

/// @notice Tries to re-enter Rail while Rail is asking it whether a payout happened.
contract ReentrantAttestor is IAttestor {
    address public immutable rail;
    bytes public payload;

    constructor(address rail_) {
        rail = rail_;
    }

    function arm(bytes calldata payload_) external {
        payload = payload_;
    }

    function isDelivered(bytes32) external view returns (bool) {
        // staticcall context: any state-changing re-entry must fail, which is the point.
        (bool ok,) = rail.staticcall(payload);
        return ok;
    }
}
