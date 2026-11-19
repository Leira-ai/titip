// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal read-only interface for the SPACE ID Agent ID registry
///         (0x60b9262456de011f7d15a54cdd8c48baaa8b022f on BNB Chain).
///         Signatures verified against the Sourcify-verified ABI on
///         19 Nov 2026; see docs/AGENTID-ABI.md. Titip only ever reads
///         from the registry, it never writes to it.
interface IAgentID {
    /// @notice Owner of a token id, where tokenId = uint256(keccak256(bytes(label))).
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice Resolve a handle (label without the .ai suffix) to its owner.
    function ownerOfHandle(string calldata handle) external view returns (address);

    /// @notice Resolve an address back to its handle. Empty string when none.
    function handleOf(address account) external view returns (string memory);

    /// @notice Number of Agent IDs held by an address (0 or 1 in practice).
    function balanceOf(address account) external view returns (uint256);

    /// @notice Whether a handle string is a valid Agent ID label.
    function isValidHandle(string calldata handle) external view returns (bool);
}
