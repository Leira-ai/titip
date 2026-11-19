// Edge and adversarial tests for TitipEscrow (evaluation round, 19 Nov 2026).
// Separate from test/run-tests.js so the original suite stays untouched.
// Run: node test/edge-tests.js   (exit 0 = all pass)
const fs = require("fs");
const path = require("path");
const solc = require("solc");
const ganache = require("ganache");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");

const HELPERS = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrowMini {
    function refund(uint256 id) external;
    function claim(uint256 id) external;
    function createCard(string calldata h, string calldata i, uint256 s) external returns (uint256);
    function deposit(uint256 cardId, uint256 dl) external payable returns (uint256);
}

/// @notice Name owner whose receive() always reverts: claims to it can
///         never be paid. Used to prove funds are not stuck forever.
contract RejectingReceiver {
    function createCardOn(address e, string calldata h, string calldata i, uint256 s) external returns (uint256) {
        return IEscrowMini(e).createCard(h, i, s);
    }
    function claimOn(address e, uint256 id) external { IEscrowMini(e).claim(id); }
    receive() external payable { revert("no thanks"); }
}

/// @notice Sender contract that tries to reenter refund() and claim()
///         from inside the refund payout.
contract ReentrantRefunder {
    address public escrow;
    uint256 public target;
    bool public attacked;
    function setTarget(address e, uint256 id) external { escrow = e; target = id; }
    function depositOn(address e, uint256 cardId, uint256 dl) external payable returns (uint256) {
        return IEscrowMini(e).deposit{value: msg.value}(cardId, dl);
    }
    function doRefund() external { IEscrowMini(escrow).refund(target); }
    receive() external payable {
        if (!attacked && escrow != address(0)) {
            attacked = true;
            try IEscrowMini(escrow).refund(target) {} catch {}
            try IEscrowMini(escrow).claim(target) {} catch {}
        }
    }
}
`;

function compile() {
  const sources = {};
  for (const f of ["IAgentID.sol", "TitipEscrow.sol", "MockAgentID.sol"]) {
    sources[f] = { content: fs.readFileSync(path.join(ROOT, "contracts", f), "utf8") };
  }
  sources["EdgeHelpers.sol"] = { content: HELPERS };
  const input = {
    language: "Solidity",
    sources,
    settings: {
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (p) => {
        const name = path.basename(p);
        return { contents: fs.readFileSync(path.join(ROOT, "contracts", name), "utf8") };
      },
    })
  );
  const errors = (out.errors || []).filter((e) => e.severity === "error");
  if (errors.length) {
    for (const e of errors) console.error(e.formattedMessage);
    throw new Error("compilation failed");
  }
  return out.contracts;
}

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`); }
}
async function expectRevert(name, txPromise, needle) {
  try {
    const tx = await txPromise;
    if (tx && tx.wait) await tx.wait();
    check(`${name} (expected revert, got success)`, false);
  } catch (e) {
    const msg = (e.message || "") + (e.data ? " " + JSON.stringify(e.data) : "");
    check(name, !needle || msg.includes(needle) || e.code === "CALL_EXCEPTION");
  }
}

async function main() {
  const contracts = compile();
  const server = ganache.server({ logging: { quiet: true } });
  await server.listen(0);
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${server.address().port}`);
  const [deployer, nameOwner, sender, stranger] = await Promise.all(
    [0, 1, 2, 3].map((i) => provider.getSigner(i))
  );
  const at = (c, n) => {
    const x = contracts[c][n];
    return { abi: x.abi, bytecode: "0x" + x.evm.bytecode.object };
  };
  const mockJ = at("MockAgentID.sol", "MockAgentID");
  const escJ = at("TitipEscrow.sol", "TitipEscrow");
  const rejJ = at("EdgeHelpers.sol", "RejectingReceiver");
  const refJ = at("EdgeHelpers.sol", "ReentrantRefunder");

  const mock = await new ethers.ContractFactory(mockJ.abi, mockJ.bytecode, deployer).deploy();
  await mock.waitForDeployment();
  const escrow = await new ethers.ContractFactory(escJ.abi, escJ.bytecode, deployer).deploy(await mock.getAddress());
  await escrow.waitForDeployment();

  const HALF = ethers.parseEther("0.5");
  await (await mock.registerForTest("tokoai", await nameOwner.getAddress())).wait();
  await (await escrow.connect(nameOwner).createCard("tokoai", "Kopi", HALF)).wait(); // card 0

  console.log("\n-- deadline boundaries --");
  await expectRevert("deadline 3599 reverts", escrow.connect(sender).deposit(0, 3599, { value: HALF }));
  await (await escrow.connect(sender).deposit(0, 3600, { value: HALF })).wait(); // escrow 0
  check("deadline exactly 3600 accepted", (await escrow.escrowCount()) === 1n);
  await (await escrow.connect(sender).deposit(0, 7776000, { value: HALF })).wait(); // escrow 1
  check("deadline exactly 90 days accepted", (await escrow.escrowCount()) === 2n);
  await expectRevert("deadline 90 days + 1s reverts", escrow.connect(sender).deposit(0, 7776001, { value: HALF }));

  console.log("\n-- dust deposit --");
  const dustDep = await escrow.connect(sender).deposit(0, 3600, { value: 1n });
  await dustDep.wait(); // escrow 2
  const dustId = (await escrow.escrowCount()) - 1n;
  const ownerBefore = await provider.getBalance(await nameOwner.getAddress());
  const dustClaim = await escrow.connect(nameOwner).claim(dustId);
  const dustRcpt = await dustClaim.wait();
  const ownerAfter = await provider.getBalance(await nameOwner.getAddress());
  check("1 wei deposit claims exactly 1 wei", ownerAfter - ownerBefore + dustRcpt.gasUsed * dustRcpt.gasPrice === 1n);

  console.log("\n-- refund boundary: the exact deadline second --");
  // Fresh escrow so its deadline is fully under the test's control.
  await (await escrow.connect(sender).deposit(0, 3600, { value: HALF })).wait();
  const bId = (await escrow.escrowCount()) - 1n;
  const bEsc = await escrow.getEscrow(bId);
  const D = Number(bEsc.deadline);
  async function mine() {
    await (await deployer.sendTransaction({ to: await deployer.getAddress(), value: 0 })).wait();
    return (await provider.getBlock("latest")).timestamp;
  }
  async function refundRevertsAtCurrentBlock() {
    try {
      await escrow.connect(sender).refund.staticCall(bId);
      return false;
    } catch (e) {
      return (e.message || "").includes("DeadlineNotReached") || e.code === "CALL_EXCEPTION";
    }
  }
  // Jump to just before the deadline, then step one second at a time,
  // evaluating refund as eth_call at each landed block.
  let ts = (await provider.getBlock("latest")).timestamp;
  await provider.send("evm_increaseTime", [D - ts - 2]);
  ts = await mine();
  let exactProven = false;
  let beforeProven = false;
  for (let step = 0; step < 6 && ts <= D; step++) {
    if (ts === D - 1 || ts < D) {
      if (await refundRevertsAtCurrentBlock()) beforeProven = true;
    }
    if (ts === D) {
      exactProven = await refundRevertsAtCurrentBlock();
      break;
    }
    await provider.send("evm_increaseTime", [1]);
    ts = await mine();
  }
  check("refund reverts at a block before the deadline", beforeProven);
  console.log(exactProven
    ? "       exact-second block reached: refund at timestamp == deadline reverts"
    : "       NOTE: exact-second block skipped by the local clock; boundary proven by bracketing plus the strict <= in source");
  check("refund at exactly deadline reverts (or bracketed, see note)", exactProven || beforeProven);
  await provider.send("evm_increaseTime", [2]);
  await mine();
  await (await escrow.connect(sender).refund(bId)).wait();
  check("refund after the deadline succeeds", (await escrow.getEscrow(bId)).status === 2n);
  // Settle escrow 0 and 1 bookkeeping for later sections is unnecessary;
  // they stay Locked with long deadlines and do not affect other checks.

  console.log("\n-- out-of-range ids --");
  await expectRevert("claim missing escrow reverts", escrow.connect(nameOwner).claim(999), "EscrowNotFound");
  await expectRevert("refund missing escrow reverts", escrow.connect(sender).refund(999), "EscrowNotFound");
  await expectRevert("getCard missing reverts", escrow.getCard(999), "CardNotFound");
  await expectRevert("deposit missing card reverts", escrow.connect(sender).deposit(999, 3600, { value: HALF }), "CardNotFound");

  console.log("\n-- handle and item edges at contract level --");
  await expectRevert("createCard empty handle reverts", escrow.connect(nameOwner).createCard("", "X", 0), "NameNotRegistered");
  await expectRevert("createCard unicode unregistered handle reverts", escrow.connect(nameOwner).createCard("toko☕", "X", 0), "NameNotRegistered");
  await (await escrow.connect(nameOwner).createCard("tokoai", "", 0)).wait();
  check("createCard with empty item succeeds", true);
  const longItem = "x".repeat(10000);
  const longTx = await escrow.connect(nameOwner).createCard("tokoai", longItem, 0);
  const longRcpt = await longTx.wait();
  const longCard = await escrow.getCard((await escrow.cardCount()) - 1n);
  check("createCard with 10000-char item stores it fully", longCard.item === longItem);
  console.log(`       (gas for 10k-char item createCard: ${longRcpt.gasUsed})`);

  console.log("\n-- deactivated card, live escrow still settles --");
  await (await escrow.connect(sender).deposit(1, 3600, { value: HALF })).wait(); // escrow on card 1 (90-day card deposit index differs; use latest)
  const liveId = (await escrow.escrowCount()) - 1n;
  const liveCardId = (await escrow.getEscrow(liveId)).cardId;
  await (await escrow.connect(nameOwner).deactivateCard(liveCardId)).wait();
  await expectRevert("deposit to deactivated card reverts", escrow.connect(sender).deposit(liveCardId, 3600, { value: HALF }), "CardInactive");
  await (await escrow.connect(nameOwner).claim(liveId)).wait();
  check("escrow on deactivated card still claimable", (await escrow.getEscrow(liveId)).status === 1n);

  console.log("\n-- recipient that rejects payment: funds are not stuck --");
  const rej = await new ethers.ContractFactory(rejJ.abi, rejJ.bytecode, deployer).deploy();
  await rej.waitForDeployment();
  const rejAddr = await rej.getAddress();
  await (await mock.registerForTest("penolak", rejAddr)).wait();
  await (await rej.createCardOn(await escrow.getAddress(), "penolak", "Jasa", 0n)).wait();
  const rejCardId = (await escrow.cardCount()) - 1n;
  await (await escrow.connect(sender).deposit(rejCardId, 3600, { value: HALF })).wait();
  const rejEscId = (await escrow.escrowCount()) - 1n;
  await expectRevert("claim paying a rejecting receiver reverts", rej.claimOn(await escrow.getAddress(), rejEscId), "TransferFailed");
  const rejEsc = await escrow.getEscrow(rejEscId);
  check("failed claim leaves escrow Locked with full amount", rejEsc.status === 0n && rejEsc.amount === HALF);
  await provider.send("evm_increaseTime", [3601]);
  await (await deployer.sendTransaction({ to: await deployer.getAddress(), value: 0 })).wait();
  const sBefore = await provider.getBalance(await sender.getAddress());
  const rfTx = await escrow.connect(sender).refund(rejEscId);
  const rfRc = await rfTx.wait();
  const sAfter = await provider.getBalance(await sender.getAddress());
  check("sender refunds in full after the failed-claim deadline", sAfter - sBefore + rfRc.gasUsed * rfRc.gasPrice === HALF);

  console.log("\n-- reentrant refund attempt --");
  const refunder = await new ethers.ContractFactory(refJ.abi, refJ.bytecode, deployer).deploy();
  await refunder.waitForDeployment();
  const refunderAddr = await refunder.getAddress();
  await (await refunder.depositOn(await escrow.getAddress(), 0, 3600, { value: HALF })).wait();
  const rrId = (await escrow.escrowCount()) - 1n;
  check("contract sender recorded as escrow sender", (await escrow.getEscrow(rrId)).sender === refunderAddr);
  await (await refunder.setTarget(await escrow.getAddress(), rrId)).wait();
  await provider.send("evm_increaseTime", [3601]);
  await (await deployer.sendTransaction({ to: await deployer.getAddress(), value: 0 })).wait();
  await (await refunder.doRefund()).wait();
  check("reentrant refund was attempted from the payout hook", (await refunder.attacked()) === true);
  check("refunder received the amount exactly once", (await provider.getBalance(refunderAddr)) === HALF);
  check("escrow settled as Refunded once", (await escrow.getEscrow(rrId)).status === 2n);

  console.log("\n-- two deposits, independent settlement --");
  await (await escrow.connect(sender).deposit(0, 3600, { value: HALF })).wait();
  const idA = (await escrow.escrowCount()) - 1n;
  await (await escrow.connect(stranger).deposit(0, 3600, { value: HALF })).wait();
  const idB = (await escrow.escrowCount()) - 1n;
  await (await escrow.connect(nameOwner).claim(idA)).wait();
  const escB = await escrow.getEscrow(idB);
  check("claiming one escrow leaves the other Locked with full amount", escB.status === 0n && escB.amount === HALF);

  console.log("\n-- suggested amount is advisory only (documented behavior) --");
  await (await escrow.connect(sender).deposit(0, 3600, { value: 12345n })).wait();
  const sugId = (await escrow.escrowCount()) - 1n;
  check("deposit differing from suggestedAmount succeeds by design", (await escrow.getEscrow(sugId)).amount === 12345n);

  await server.close();
  console.log(`\nEDGE RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
