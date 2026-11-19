# Titip

**Pay a name, not a random address.** Titip is an escrow payment layer
for Agent ID (`.ai`) names on BNB Chain. A buyer sends BNB to a name;
the money locks inside the TitipEscrow contract and can only be
claimed by whoever owns that name in the Agent ID registry at claim
time. If the deadline passes without a claim, the sender takes the
full amount back. No raw wallet addresses are ever typed by the buyer,
so the wrong-address failure mode of ordinary transfers is removed.

Built for the Binance Wallet x BNB Chain Agent ID Hackathon
(submission period 18 Nov to 9 Dec 2026).

## Live status (honest, dated 19 Nov 2026)

- **Testnet: live and proven end to end.** TitipEscrow is deployed on
  BSC Testnet (chain 97) against a mock Agent ID registry, and the
  full money flow (issue card, deposit, claim, refund after deadline)
  was executed both by script and from the product page itself, with
  every payout reconciled to the wei.
- **Mainnet: LIVE (deployed 19 Nov 2026).** TitipEscrow is deployed
  on BNB Chain (chain 56) against the real SPACE ID Agent ID
  registry, deploy tx
  `0x19e756c30280838b9447f32cce76f1e6d7231a236c942f2a95e8146285d9a3b9`,
  and its source is Sourcify **exact match** verified (creation and
  runtime). The deployed runtime bytecode is byte-identical to the
  proven testnet deployment except for the immutable registry
  address it points to. The web app's mainnet mode is the default
  and is wired to this contract; testnet mode stays available for
  rehearsal.
- Product site (mainnet mode, default):
  https://titip.utterhq.workers.dev/
- Preview (testnet mode):
  https://titip.utterhq.workers.dev/?network=testnet

## Contracts

| Network | Contract | Address |
|---|---|---|
| BSC Testnet (97) | TitipEscrow | `0x69CFC14869706EbD12EcD38a5746A0684E06b519` |
| BSC Testnet (97) | MockAgentID (test registry) | `0x66bFC04f22DC2892dDeD3aCb97F21B7edDF0Ca23` |
| BNB Chain (56) | TitipEscrow | `0x29a8b028a67696db8a07BccFCe0aB009D323E208` |
| BNB Chain (56) | Agent ID registry (SPACE ID) | `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` |

Testnet source verification: Sourcify **exact match** (creation and
runtime) for TitipEscrow on chain 97, verified 2026-11-18,
matchId 59484606:
https://repo.sourcify.dev/contracts/full_match/97/0x69CFC14869706EbD12EcD38a5746A0684E06b519/

Mainnet source verification: Sourcify **exact match** (creation and
runtime) for TitipEscrow on chain 56, verified 2026-11-19,
matchId 59508184:
https://repo.sourcify.dev/contracts/full_match/56/0x29a8b028a67696db8a07BccFCe0aB009D323E208/

## How it works

1. **Issue a card.** The owner of a `.ai` name calls
   `createCard(handle, item, suggestedAmount)`. Only the address that
   `ownerOfHandle(handle)` returns in the Agent ID registry can do
   this. One card is shared with all buyers.
2. **Send.** Anyone calls `deposit(cardId, deadlineSeconds)` with BNB.
   The name, item, and recipient are read from the contract, never
   from a link, so a shared link cannot be spoofed. Deadlines are
   bounded on-chain: minimum 1 hour, maximum 90 days.
3. **Claim or refund.** The current owner of the name (checked against
   the registry at claim time) calls `claim(escrowId)` and receives
   exactly the deposited amount. After the deadline, if the escrow is
   still locked, the original sender calls `refund(escrowId)` and
   receives exactly the deposited amount back.

## Who can move the money (security model)

Exactly two parties, enforced by the contract:

- the **name owner** (claim), resolved live from the Agent ID
  registry, and
- the **original sender** (refund, only after the deadline).

TitipEscrow has **no owner, no admin functions, no withdraw, sweep,
or pause**, and its registry address is immutable after deployment.
State is zeroed before payout and a reentrancy guard covers the
external call; both properties are exercised by adversarial tests in
`test/`, including a reentrant-claimer attacker contract. A recipient
that rejects payment cannot trap funds: the escrow stays locked and
the sender recovers in full via refund after the deadline.

## Repository layout

- `contracts/` TitipEscrow, the read-only IAgentID interface, and the
  test-only MockAgentID plus reentrancy attacker.
- `test/` Ganache behaviour suite (`run-tests.js`, 32 checks),
  adversarial edge suite (`edge-tests.js`, 27 checks), the hand-rolled
  Keccak/ABI codec fuzz against ethers (`codec-fuzz.js`), frontend
  behaviour tests, and a computed contrast check.
- `web/` The product: a single dependency-free page (HTML, CSS, JS)
  with a hand-rolled EIP-1193/EIP-6963 wallet adapter, simulation
  before every signature, plain-words confirmation sheets, and full
  ID/EN dictionaries.
- `docs/` The Agent ID ABI notes, the design blueprint, the security
  gate checklist, and the pre-release evaluation rubric.
- `agent.md` A machine-readable product description for agents.

## Run the tests

```bash
npm ci
npm test                  # contract behaviour suite (32 checks)
node test/edge-tests.js   # adversarial edge suite (27 checks)
node test/codec-fuzz.js   # codec fuzz vs ethers (6,745 comparisons)
node --check web/app.js
```

CI (GitHub Actions) runs the contract suite, the edge suite, the
codec fuzz, and the syntax check on every push.

## Licence

MIT. See `LICENSE`.
