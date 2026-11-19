// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentID} from "./IAgentID.sol";

/// @title TitipEscrow
/// @notice Name-to-name BNB payments with escrow. A payment is addressed to
///         an Agent ID name (label of a name.ai), locked in this contract,
///         and can only ever leave through two doors:
///           1. claim()  - by the current owner of the recipient name,
///                         proven on-chain against the Agent ID registry.
///           2. refund() - back to the original sender, only after the
///                         deadline passed without a claim.
///         There is NO owner, NO admin role, NO pause, NO fee and NO
///         function that lets anyone else (including the deployer) move
///         escrowed funds. The registry address is immutable.
contract TitipEscrow {
    enum Status {
        Locked,
        Claimed,
        Refunded
    }

    struct Card {
        uint256 tokenId; // labelhash of the recipient name
        string handle; // label without the .ai suffix
        address creator; // owner of the name at creation time
        string item; // what the card sells / asks payment for
        uint256 suggestedAmount; // wei, 0 means "any amount"
        bool active;
    }

    struct Escrow {
        uint256 cardId;
        uint256 tokenId;
        string handle;
        address sender;
        address recipient; // snapshot of the name owner at deposit time (display only)
        uint256 amount; // wei
        uint256 deadline; // unix timestamp
        Status status;
    }

    uint256 public constant MIN_DEADLINE_SECONDS = 1 hours;
    uint256 public constant MAX_DEADLINE_SECONDS = 90 days;

    IAgentID public immutable agentID;

    Card[] private _cards;
    Escrow[] private _escrows;

    uint256 private _reentrancyLock = 1;

    event CardCreated(
        uint256 indexed cardId,
        uint256 indexed tokenId,
        string handle,
        address indexed creator,
        string item,
        uint256 suggestedAmount
    );
    event CardDeactivated(uint256 indexed cardId, uint256 indexed tokenId, address indexed creator);
    event Deposited(
        uint256 indexed escrowId,
        uint256 indexed cardId,
        uint256 indexed tokenId,
        string handle,
        address sender,
        address recipient,
        uint256 amount,
        uint256 deadline
    );
    event Claimed(uint256 indexed escrowId, uint256 indexed tokenId, address indexed claimer, uint256 amount);
    event Refunded(uint256 indexed escrowId, uint256 indexed tokenId, address indexed sender, uint256 amount);

    error NameNotRegistered(string handle);
    error NotNameOwner(string handle, address caller);
    error CardNotFound(uint256 cardId);
    error CardInactive(uint256 cardId);
    error NotCardCreator(uint256 cardId, address caller);
    error ZeroAmount();
    error DeadlineOutOfRange(uint256 deadlineSeconds);
    error EscrowNotFound(uint256 escrowId);
    error EscrowNotLocked(uint256 escrowId);
    error NotRecipient(uint256 escrowId, address caller);
    error NotSender(uint256 escrowId, address caller);
    error DeadlineNotReached(uint256 escrowId, uint256 deadline);
    error TransferFailed(address to, uint256 amount);
    error ReentrantCall();

    modifier nonReentrant() {
        if (_reentrancyLock != 1) revert ReentrantCall();
        _reentrancyLock = 2;
        _;
        _reentrancyLock = 1;
    }

    constructor(address agentIDRegistry) {
        require(agentIDRegistry != address(0), "registry is zero address");
        agentID = IAgentID(agentIDRegistry);
    }

    /// @notice Token id for a handle label: uint256(keccak256(bytes(label))).
    function tokenIdOf(string memory handle) public pure returns (uint256) {
        return uint256(keccak256(bytes(handle)));
    }

    /// @notice Issue a payment card for your own Agent ID name. Only the
    ///         verified owner of the name can create a card for it; this is
    ///         the opt-in that keeps Titip from being a name directory.
    function createCard(string calldata handle, string calldata item, uint256 suggestedAmount)
        external
        returns (uint256 cardId)
    {
        address owner = agentID.ownerOfHandle(handle);
        if (owner == address(0)) revert NameNotRegistered(handle);
        if (owner != msg.sender) revert NotNameOwner(handle, msg.sender);

        cardId = _cards.length;
        _cards.push(
            Card({
                tokenId: tokenIdOf(handle),
                handle: handle,
                creator: msg.sender,
                item: item,
                suggestedAmount: suggestedAmount,
                active: true
            })
        );
        emit CardCreated(cardId, tokenIdOf(handle), handle, msg.sender, item, suggestedAmount);
    }

    /// @notice Stop a card from receiving new deposits. Existing escrows
    ///         are untouched and still resolve through claim/refund.
    function deactivateCard(uint256 cardId) external {
        if (cardId >= _cards.length) revert CardNotFound(cardId);
        Card storage card = _cards[cardId];
        if (card.creator != msg.sender) revert NotCardCreator(cardId, msg.sender);
        card.active = false;
        emit CardDeactivated(cardId, card.tokenId, msg.sender);
    }

    /// @notice Lock BNB into escrow for the owner of a card's name.
    /// @param deadlineSeconds Seconds from now until the sender may refund.
    function deposit(uint256 cardId, uint256 deadlineSeconds) external payable returns (uint256 escrowId) {
        if (cardId >= _cards.length) revert CardNotFound(cardId);
        Card storage card = _cards[cardId];
        if (!card.active) revert CardInactive(cardId);
        if (msg.value == 0) revert ZeroAmount();
        if (deadlineSeconds < MIN_DEADLINE_SECONDS || deadlineSeconds > MAX_DEADLINE_SECONDS) {
            revert DeadlineOutOfRange(deadlineSeconds);
        }

        // Re-resolve the recipient at deposit time; never trust stored data
        // for who may receive funds.
        address recipient = agentID.ownerOf(card.tokenId);
        if (recipient == address(0)) revert NameNotRegistered(card.handle);

        uint256 deadline = block.timestamp + deadlineSeconds;
        escrowId = _escrows.length;
        _escrows.push(
            Escrow({
                cardId: cardId,
                tokenId: card.tokenId,
                handle: card.handle,
                sender: msg.sender,
                recipient: recipient,
                amount: msg.value,
                deadline: deadline,
                status: Status.Locked
            })
        );
        emit Deposited(escrowId, cardId, card.tokenId, card.handle, msg.sender, recipient, msg.value, deadline);
    }

    /// @notice Claim a locked escrow. Only the current owner of the
    ///         recipient Agent ID name can claim; claiming is also the
    ///         recipient's on-chain confirmation of receipt.
    function claim(uint256 escrowId) external nonReentrant {
        if (escrowId >= _escrows.length) revert EscrowNotFound(escrowId);
        Escrow storage esc = _escrows[escrowId];
        if (esc.status != Status.Locked) revert EscrowNotLocked(escrowId);

        address owner = agentID.ownerOf(esc.tokenId);
        if (owner != msg.sender) revert NotRecipient(escrowId, msg.sender);

        uint256 amount = esc.amount;
        esc.status = Status.Claimed;
        esc.amount = 0;
        emit Claimed(escrowId, esc.tokenId, msg.sender, amount);

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed(msg.sender, amount);
    }

    /// @notice Take back a locked escrow after its deadline passed
    ///         unclaimed. Only the original sender, only to themselves.
    function refund(uint256 escrowId) external nonReentrant {
        if (escrowId >= _escrows.length) revert EscrowNotFound(escrowId);
        Escrow storage esc = _escrows[escrowId];
        if (esc.status != Status.Locked) revert EscrowNotLocked(escrowId);
        if (esc.sender != msg.sender) revert NotSender(escrowId, msg.sender);
        if (block.timestamp <= esc.deadline) revert DeadlineNotReached(escrowId, esc.deadline);

        uint256 amount = esc.amount;
        esc.status = Status.Refunded;
        esc.amount = 0;
        emit Refunded(escrowId, esc.tokenId, msg.sender, amount);

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed(msg.sender, amount);
    }

    function cardCount() external view returns (uint256) {
        return _cards.length;
    }

    function escrowCount() external view returns (uint256) {
        return _escrows.length;
    }

    function getCard(uint256 cardId) external view returns (Card memory) {
        if (cardId >= _cards.length) revert CardNotFound(cardId);
        return _cards[cardId];
    }

    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        if (escrowId >= _escrows.length) revert EscrowNotFound(escrowId);
        return _escrows[escrowId];
    }
}
