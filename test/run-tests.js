// Compile TitipEscrow + test doubles with solc-js and run the behavioural
// test suite against an in-process Ganache chain. Local only: no external
// network, no real funds, no deployment anywhere.
const fs = require("fs");
const path = require("path");
const solc = require("solc");
const ganache = require("ganache");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");

function compile() {
  const sources = {};
  for (const f of ["IAgentID.sol", "TitipEscrow.sol", "MockAgentID.sol"]) {
    sources[f] = { content: fs.readFileSync(path.join(ROOT, "contracts", f), "utf8") };
  }
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
  const warnings = (out.errors || []).filter((e) => e.severity === "warning");
  if (errors.length) {
    for (const e of errors) console.error(e.formattedMessage);
    throw new Error("compilation failed");
  }
  fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
  for (const name of ["TitipEscrow", "MockAgentID", "ReentrantClaimer"]) {
    const c = out.contracts["TitipEscrow.sol"]?.[name] || out.contracts["MockAgentID.sol"]?.[name];
    fs.writeFileSync(
      path.join(ROOT, "build", `${name}.json`),
      JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2)
    );
  }
  return { warnings: warnings.length, solcVersion: solc.version() };
}

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
  }
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
  const { warnings, solcVersion } = compile();
  console.log(`Compiled OK with solc ${solcVersion}; warnings: ${warnings}`);

  const server = ganache.server({ logging: { quiet: true } });
  await server.listen(0);
  const port = server.address().port;
  const provider = new ethers.JsonRpcProvider(`http://127.0.0.1:${port}`);
  const [deployer, nameOwner, sender, stranger] = await Promise.all(
    [0, 1, 2, 3].map((i) => provider.getSigner(i))
  );

  const mockJson = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "MockAgentID.json"), "utf8"));
  const escJson = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "TitipEscrow.json"), "utf8"));
  const reentJson = JSON.parse(fs.readFileSync(path.join(ROOT, "build", "ReentrantClaimer.json"), "utf8"));

  const mock = await new ethers.ContractFactory(mockJson.abi, mockJson.bytecode, deployer).deploy();
  await mock.waitForDeployment();
  const escrow = await new ethers.ContractFactory(escJson.abi, escJson.bytecode, deployer).deploy(
    await mock.getAddress()
  );
  await escrow.waitForDeployment();
  console.log(`MockAgentID: ${await mock.getAddress()}`);
  console.log(`TitipEscrow: ${await escrow.getAddress()}`);

  const ONE = ethers.parseEther("1");
  const HALF = ethers.parseEther("0.5");

  // Setup: nameOwner owns "tokoai", stranger owns "lainnya".
  await (await mock.registerForTest("tokoai", await nameOwner.getAddress())).wait();
  await (await mock.registerForTest("lainnya", await stranger.getAddress())).wait();

  console.log("\n-- createCard gates --");
  await expectRevert(
    "createCard by non-owner reverts",
    escrow.connect(sender).createCard("tokoai", "Kopi", 0)
  );
  await expectRevert(
    "createCard for unregistered name reverts",
    escrow.connect(sender).createCard("belumada", "Kopi", 0)
  );
  const cardTx = await escrow.connect(nameOwner).createCard("tokoai", "Kopi tubruk 250g", HALF);
  await cardTx.wait();
  check("createCard by name owner succeeds", (await escrow.cardCount()) === 1n);
  const card = await escrow.getCard(0);
  check("card stores handle and creator", card.handle === "tokoai" && card.creator === (await nameOwner.getAddress()));
  check(
    "card tokenId equals labelhash",
    card.tokenId === BigInt(ethers.keccak256(ethers.toUtf8Bytes("tokoai")))
  );

  console.log("\n-- deposit gates --");
  await expectRevert("deposit zero value reverts", escrow.connect(sender).deposit(0, 3600, { value: 0 }));
  await expectRevert(
    "deposit deadline too short reverts",
    escrow.connect(sender).deposit(0, 60, { value: HALF })
  );
  await expectRevert(
    "deposit to missing card reverts",
    escrow.connect(sender).deposit(99, 3600, { value: HALF })
  );
  const depTx = await escrow.connect(sender).deposit(0, 3600, { value: HALF });
  await depTx.wait();
  check("deposit succeeds", (await escrow.escrowCount()) === 1n);
  check(
    "contract holds the escrowed amount",
    (await provider.getBalance(await escrow.getAddress())) === HALF
  );
  let esc = await escrow.getEscrow(0);
  check(
    "escrow records sender, recipient snapshot, Locked",
    esc.sender === (await sender.getAddress()) &&
      esc.recipient === (await nameOwner.getAddress()) &&
      esc.status === 0n
  );

  console.log("\n-- claim gates --");
  await expectRevert("claim by non-owner (sender) reverts", escrow.connect(sender).claim(0));
  await expectRevert("claim by non-owner (stranger) reverts", escrow.connect(stranger).claim(0));
  const ownerBefore = await provider.getBalance(await nameOwner.getAddress());
  const claimTx = await escrow.connect(nameOwner).claim(0);
  const claimReceipt = await claimTx.wait();
  const claimGas = claimReceipt.gasUsed * claimReceipt.gasPrice;
  const ownerAfter = await provider.getBalance(await nameOwner.getAddress());
  check("claim by name owner succeeds and pays exactly the amount", ownerAfter - ownerBefore + claimGas === HALF);
  esc = await escrow.getEscrow(0);
  check("escrow status is Claimed and amount zeroed", esc.status === 1n && esc.amount === 0n);
  check("contract balance back to zero", (await provider.getBalance(await escrow.getAddress())) === 0n);
  await expectRevert("double claim reverts", escrow.connect(nameOwner).claim(0));
  await expectRevert("refund after claim reverts", escrow.connect(sender).refund(0));

  console.log("\n-- refund gates --");
  const dep2 = await escrow.connect(sender).deposit(0, 3600, { value: HALF });
  await dep2.wait(); // escrow id 1
  await expectRevert("refund before deadline reverts", escrow.connect(sender).refund(1));
  // Advance time past the deadline. Ganache only applies evm_increaseTime
  // to blocks mined by real transactions, so mine one dummy transfer.
  await provider.send("evm_increaseTime", [7200]);
  await (await deployer.sendTransaction({ to: await deployer.getAddress(), value: 0 })).wait();
  const afterWarp = await provider.getBlock("latest");
  check("test clock is past the deadline", BigInt(afterWarp.timestamp) > (await escrow.getEscrow(1)).deadline);
  await expectRevert("refund by non-sender reverts", escrow.connect(stranger).refund(1));
  const senderBefore = await provider.getBalance(await sender.getAddress());
  const refTx = await escrow.connect(sender).refund(1);
  const refReceipt = await refTx.wait();
  const refGas = refReceipt.gasUsed * refReceipt.gasPrice;
  const senderAfter = await provider.getBalance(await sender.getAddress());
  check("refund after deadline returns exactly the amount", senderAfter - senderBefore + refGas === HALF);
  esc = await escrow.getEscrow(1);
  check("escrow status is Refunded", esc.status === 2n);
  await expectRevert("double refund reverts", escrow.connect(sender).refund(1));
  await expectRevert("claim after refund reverts", escrow.connect(nameOwner).claim(1));

  console.log("\n-- card deactivation --");
  await expectRevert(
    "deactivate by non-creator reverts",
    escrow.connect(sender).deactivateCard(0)
  );
  await (await escrow.connect(nameOwner).deactivateCard(0)).wait();
  await expectRevert(
    "deposit to deactivated card reverts",
    escrow.connect(sender).deposit(0, 3600, { value: HALF })
  );

  console.log("\n-- reentrancy: payout hook cannot claim twice --");
  const claimer = await new ethers.ContractFactory(reentJson.abi, reentJson.bytecode, deployer).deploy(
    await mock.getAddress()
  );
  await claimer.waitForDeployment();
  const claimerAddr = await claimer.getAddress();
  await (await mock.registerForTest("agenjahat", claimerAddr)).wait();
  const evilCardTx = await claimer.createCardOn(await escrow.getAddress(), "agenjahat", "Jasa uji", 0n);
  await evilCardTx.wait();
  const evilCardId = (await escrow.cardCount()) - 1n;
  const dep3 = await escrow.connect(sender).deposit(evilCardId, 3600, { value: HALF });
  await dep3.wait();
  const evilEscrowId = (await escrow.escrowCount()) - 1n;
  await (await claimer.setTarget(await escrow.getAddress(), evilEscrowId)).wait();
  const claimerBefore = await provider.getBalance(claimerAddr);
  await (await claimer.doClaim(await escrow.getAddress(), evilEscrowId)).wait();
  const claimerAfter = await provider.getBalance(claimerAddr);
  check("reentrant inner claim was attempted", (await claimer.attacked()) === true);
  check("attacker received the amount exactly once", claimerAfter - claimerBefore === HALF);
  const evilEsc = await escrow.getEscrow(evilEscrowId);
  check("escrow settled as Claimed once", evilEsc.status === 1n);

  console.log("\n-- no owner / no drain surface --");
  const fnNames = escJson.abi.filter((x) => x.type === "function").map((x) => x.name);
  check(
    "contract exposes no withdraw/sweep/pause/owner functions",
    !fnNames.some((n) => ["withdraw", "sweep", "pause", "owner", "setRegistry"].includes(n))
  );
  check("registry address is the mock", (await escrow.agentID()) === (await mock.getAddress()));
  void ONE;

  await server.close();
  console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
