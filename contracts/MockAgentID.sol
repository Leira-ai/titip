// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test double for the Agent ID registry. Mirrors the ownership
///         semantics Titip relies on: tokenId = uint256(keccak256(label)),
///         one handle per address, handles never transfer.
contract MockAgentID {
    mapping(uint256 => address) private _owners;
    mapping(address => string) private _handles;
    mapping(address => uint256) private _balances;

    function registerForTest(string calldata handle, address owner) external {
        uint256 tokenId = uint256(keccak256(bytes(handle)));
        require(_owners[tokenId] == address(0), "taken");
        require(bytes(_handles[owner]).length == 0, "has handle");
        _owners[tokenId] = owner;
        _handles[owner] = handle;
        _balances[owner] = 1;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "ERC721NonexistentToken");
        return owner;
    }

    function ownerOfHandle(string calldata handle) external view returns (address) {
        return _owners[uint256(keccak256(bytes(handle)))];
    }

    function handleOf(address account) external view returns (string memory) {
        return _handles[account];
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function isValidHandle(string calldata handle) external pure returns (bool) {
        bytes memory b = bytes(handle);
        if (b.length < 3 || b.length > 20) return false;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9");
            if (!ok) return false;
        }
        return true;
    }
}

/// @notice Attacker used by the reentrancy test: tries to claim twice from
///         inside the payout of the first claim.
contract ReentrantClaimer {
    MockAgentID public immutable registry;
    address public escrow;
    uint256 public targetEscrowId;
    bool public attacked;

    constructor(address registry_) {
        registry = MockAgentID(registry_);
    }

    function setTarget(address escrow_, uint256 escrowId) external {
        escrow = escrow_;
        targetEscrowId = escrowId;
    }

    function createCardOn(address escrow_, string calldata handle, string calldata item, uint256 suggested)
        external
        returns (uint256)
    {
        (bool ok, bytes memory data) =
            escrow_.call(abi.encodeWithSignature("createCard(string,string,uint256)", handle, item, suggested));
        require(ok, "createCard failed");
        return abi.decode(data, (uint256));
    }

    function doClaim(address escrow_, uint256 escrowId) external {
        (bool ok,) = escrow_.call(abi.encodeWithSignature("claim(uint256)", escrowId));
        require(ok, "claim failed");
    }

    receive() external payable {
        if (!attacked && escrow != address(0)) {
            attacked = true;
            // Low-level call so a revert here does not mask the outer flow;
            // the test asserts this inner claim did NOT pay out again.
            escrow.call(abi.encodeWithSignature("claim(uint256)", targetEscrowId));
        }
    }
}
