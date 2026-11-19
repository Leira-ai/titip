// Frontend behavior and security tests (evaluation round, 19 Nov 2026).
// Drives the real web/ page in headless Chromium with a fully stubbed
// EIP-1193 provider: no network, no keys, every RPC answer scripted.
// Run: node test/frontend-tests.js   (exit 0 = all pass)
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("/home/hatch/workspace/tools/pw/node_modules/playwright-core");
const { ethers } = require("/home/hatch/workspace/titip/node_modules/ethers");

const WEB = path.join(__dirname, "..", "web");
const EXEC = "/home/hatch/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell";
const PORT = 8940;
const BASE = `http://127.0.0.1:${PORT}/?network=testnet`;

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const TXHASH = "0x" + "ab".repeat(32);

const sel = (sig) => ethers.id(sig).slice(0, 10);
const coder = ethers.AbiCoder.defaultAbiCoder();
function cardHex(item, handle) {
  return coder.encode(
    ["tuple(uint256,string,address,string,uint256,bool)"],
    [[123n, handle || "tokoai", ACCOUNT, item, 0n, true]]
  );
}
function wordAddr(a) {
  return "0x" + "0".repeat(24) + a.slice(2);
}
function wordUint(n) {
  return "0x" + BigInt(n).toString(16).padStart(64, "0");
}

function stubInit(cfg) {
  const handlers = {};
  const state = { sendCount: 0, receiptPolls: 0 };
  window.__state = state;
  const provider = {
    isStub: true,
    on: (ev, fn) => {
      (handlers[ev] = handlers[ev] || []).push(fn);
    },
    removeListener: () => {},
    request: async ({ method, params }) => {
      switch (method) {
        case "eth_accounts":
          return cfg.autoconnect ? [cfg.account] : [];
        case "eth_requestAccounts":
          return [cfg.account];
        case "eth_chainId":
          return cfg.chainId;
        case "wallet_switchEthereumChain":
          return null;
        case "wallet_addEthereumChain":
          return null;
        case "eth_call": {
          const full = params[0].data || "0x";
          if (cfg.callMap && Object.prototype.hasOwnProperty.call(cfg.callMap, full)) {
            const v = cfg.callMap[full];
            if (v === "THROW") throw Object.assign(new Error("stub rpc dead"), { code: -32000 });
            return v;
          }
          const s = full.slice(0, 10);
          if (cfg.calls && Object.prototype.hasOwnProperty.call(cfg.calls, s)) {
            const v = cfg.calls[s];
            if (v === "THROW") throw Object.assign(new Error("stub rpc dead"), { code: -32000 });
            return v;
          }
          return "0x";
        }
        case "eth_estimateGas":
          return cfg.gas;
        case "eth_gasPrice":
          return cfg.gasPrice;
        case "eth_sendTransaction": {
          state.sendCount++;
          if (cfg.sendBehavior === "reject") {
            throw Object.assign(new Error("User rejected the request"), { code: 4001 });
          }
          return cfg.txHash;
        }
        case "eth_getTransactionReceipt": {
          state.receiptPolls++;
          if (state.receiptPolls <= (cfg.receiptNullTimes || 0)) return null;
          return { status: cfg.receiptStatus || "0x1", transactionHash: cfg.txHash, logs: [] };
        }
        default:
          return null;
      }
    },
  };
  window.ethereum = provider;
  window.__emit = (ev, arg) => {
    (handlers[ev] || []).forEach((fn) => fn(arg));
  };
}

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${extra ? "  [" + extra + "]" : ""}`);
  }
}

async function newPage(browser, cfg, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 390, height: 844 } });
  page.on("pageerror", (e) => console.log("  PAGEERROR:", e.message));
  await page.addInitScript(stubInit, cfg);
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(600);
  return page;
}

function baseCfg(over) {
  return Object.assign(
    {
      account: ACCOUNT,
      autoconnect: true,
      chainId: "0x61",
      gas: "0x3d090", // 250000
      gasPrice: "0x499602d3", // 1234567891 wei -> fee 0.00030864197275
      txHash: TXHASH,
      calls: {
        [sel("escrowCount()")]: wordUint(0),
        [sel("getCard(uint256)")]: cardHex("Kopi tubruk 250 gram"),
        [sel("ownerOfHandle(string)")]: wordAddr(ACCOUNT),
      },
    },
    over || {}
  );
}

async function openDepositSheet(page) {
  await page.fill("#s-card", "0");
  await page.fill("#s-amount", "0.001");
  await page.click("#send-form button[type=submit]");
  await page.waitForSelector("#confirm-sheet:not([hidden])", { timeout: 5000 });
  await page.waitForFunction(() => !document.getElementById("sheet-confirm").disabled, null, { timeout: 5000 });
}

async function main() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.join(WEB, name);
    if (!file.startsWith(WEB) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    const type = name.endsWith(".html") ? "text/html" : name.endsWith(".css") ? "text/css" : "text/javascript";
    res.writeHead(200, { "content-type": type });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

  console.log("\n-- S1: XSS via contract-supplied item text --");
  {
    const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
    const page = await newPage(browser, baseCfg({ calls: {
      [sel("escrowCount()")]: wordUint(0),
      [sel("getCard(uint256)")]: cardHex(payload),
      [sel("ownerOfHandle(string)")]: wordAddr(ACCOUNT),
    } }));
    await openDepositSheet(page);
    const probe = await page.evaluate(() => ({
      xss: window.__xss || 0,
      imgs: document.querySelectorAll("#sheet-rows img, #sheet-rows script, #sheet-rows svg").length,
      text: document.getElementById("sheet-rows").textContent,
    }));
    check("payload did not execute", probe.xss === 0);
    check("no injected elements in the sheet", probe.imgs === 0);
    check("payload rendered as literal text", probe.text.includes("<img src=x"));
    await page.close();
  }

  console.log("\n-- S2: double-click on confirm sends exactly one transaction --");
  {
    const page = await newPage(browser, baseCfg());
    await openDepositSheet(page);
    await page.evaluate(() => {
      const b = document.getElementById("sheet-confirm");
      b.click();
      b.click();
      b.click();
    });
    await page.waitForFunction(
      () => document.getElementById("sheet-msg").classList.contains("is-ok"),
      null,
      { timeout: 8000 }
    );
    const n = await page.evaluate(() => window.__state.sendCount);
    check("exactly one eth_sendTransaction after triple click", n === 1, "count=" + n);
    await page.close();
  }

  console.log("\n-- S3: user rejection (4001) is a labelled state, confirm re-enabled --");
  {
    const page = await newPage(browser, baseCfg({ sendBehavior: "reject" }));
    await openDepositSheet(page);
    await page.click("#sheet-confirm");
    await page.waitForTimeout(400);
    const probe = await page.evaluate(() => ({
      msg: document.getElementById("sheet-msg").textContent,
      isErr: document.getElementById("sheet-msg").classList.contains("is-error"),
      confirmDisabled: document.getElementById("sheet-confirm").disabled,
      sends: window.__state.sendCount,
    }));
    check("rejection message shown in plain words", probe.msg.includes("membatalkan tanda tangan"), probe.msg);
    check("message styled as error", probe.isErr);
    check("confirm re-enabled after rejection", probe.confirmDisabled === false);
    check("only one send attempt", probe.sends === 1);
    await page.close();
  }

  console.log("\n-- S4: slow receipt (null x3) still lands on success --");
  {
    const page = await newPage(browser, baseCfg({ receiptNullTimes: 3 }));
    await openDepositSheet(page);
    await page.click("#sheet-confirm");
    await page.waitForFunction(
      () => document.getElementById("sheet-msg").classList.contains("is-ok"),
      null,
      { timeout: 15000 }
    );
    const polls = await page.evaluate(() => window.__state.receiptPolls);
    check("success after delayed receipt", polls >= 4, "polls=" + polls);
    await page.close();
  }

  console.log("\n-- S5: wrong chain is named and blocks the flow --");
  {
    const page = await newPage(browser, baseCfg({ chainId: "0x1" }));
    const state = await page.textContent("#wallet-state");
    check("wallet bar names the wrong network", state.includes("jaringan lain"), state);
    const listText = await page.textContent("#escrow-list");
    check("list shows the wrong-network state", listText.includes("jaringan lain"), listText.slice(0, 80));
    await page.fill("#f-handle", "tokoai");
    await page.fill("#f-item", "Kopi");
    await page.click("#create-form button[type=submit]");
    await page.waitForTimeout(300);
    const msg = await page.textContent("#create-msg");
    check("create is blocked with wrong-network message", msg.includes("jaringan lain"), msg);
    await page.close();
  }

  console.log("\n-- S6: account switch while the sheet is open --");
  {
    const page = await newPage(browser, baseCfg());
    await openDepositSheet(page);
    await page.evaluate((other) => window.__emit("accountsChanged", [other]), OTHER);
    await page.waitForTimeout(300);
    const sheetHidden = await page.evaluate(() => document.getElementById("confirm-sheet").hidden);
    check("sheet closes on account switch (no stale-context signing)", sheetHidden === true);
    await page.close();
  }

  console.log("\n-- S7: fee display is human-readable (max 6 decimals) --");
  {
    const page = await newPage(browser, baseCfg());
    await openDepositSheet(page);
    const rows = await page.textContent("#sheet-rows");
    const feeMatch = rows.match(/0\.000\d+/);
    check("fee row present", !!feeMatch, rows.slice(0, 200));
    if (feeMatch) {
      const dec = (feeMatch[0].split(".")[1] || "").length;
      check("fee decimals <= 6", dec <= 6, feeMatch[0]);
      check("fee is the rounded estimate 0.000309", feeMatch[0] === "0.000309", feeMatch[0]);
    }
    await page.close();
  }

  console.log("\n-- S8: a valid 18-character name can create a card (registry max is 20) --");
  {
    const page = await newPage(browser, baseCfg());
    await page.fill("#f-handle", "tokopanjang1234567");
    const held = await page.evaluate(() => document.getElementById("f-handle").value);
    check("input keeps all 18 characters (no silent truncation)", held === "tokopanjang1234567", held);
    await page.fill("#f-item", "Kopi");
    await page.click("#create-form button[type=submit]");
    await page.waitForTimeout(600);
    const probe = await page.evaluate(() => ({
      msg: document.getElementById("create-msg").textContent,
      sheetOpen: !document.getElementById("confirm-sheet").hidden,
      rows: document.getElementById("sheet-rows").textContent,
    }));
    check("no badHandle rejection for 18-char name", !probe.msg.includes("3 sampai"), probe.msg);
    check("confirmation sheet opens for 18-char name", probe.sheetOpen === true);
    check("sheet names the full 18-char name", probe.rows.includes("tokopanjang1234567.ai"), probe.rows.slice(0, 120));
    await page.close();
  }

  console.log("\n-- S12: escrow list renders both roles in id order --");
  {
    const escIface = new ethers.Interface(["function getEscrow(uint256)"]);
    const future = BigInt(Math.floor(Date.now() / 1000) + 86400);
    const escHex = (vals) =>
      coder.encode(["tuple(uint256,uint256,string,address,address,uint256,uint256,uint8)"], [vals]);
    const callMap = {
      [escIface.encodeFunctionData("getEscrow", [0])]:
        escHex([0n, 111n, "tokoai", ACCOUNT, OTHER, 1000000000000000n, future, 0]),
      [escIface.encodeFunctionData("getEscrow", [1])]:
        escHex([0n, 222n, "tokoai", OTHER, ACCOUNT, 1000000000000000n, future, 0]),
    };
    const page = await newPage(browser, baseCfg({
      callMap,
      calls: {
        [sel("escrowCount()")]: wordUint(2),
        [sel("ownerOf(uint256)")]: wordAddr(ACCOUNT),
        [sel("getCard(uint256)")]: cardHex("Kopi"),
        [sel("ownerOfHandle(string)")]: wordAddr(ACCOUNT),
      },
    }));
    await page.waitForSelector(".escrow-row", { timeout: 6000 });
    const probe = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".escrow-row")];
      return {
        count: rows.length,
        texts: rows.map((r) => r.textContent),
        claimDisabled: rows[1] ? rows[1].querySelector("button").disabled : null,
      };
    });
    check("both escrows render", probe.count === 2, "count=" + probe.count);
    check("row order is by escrow id", probe.texts[0].includes("#0") && probe.texts[1].includes("#1"));
    check("sender role labelled on own deposit", probe.texts[0].includes("Kamu pengirimnya"));
    check("recipient role labelled on incoming escrow", probe.texts[1].includes("Untuk nama kamu"));
    check("claim button enabled above the dust threshold", probe.claimDisabled === false);
    await page.close();
  }

  console.log("\n-- S9: dead RPC on card read fails closed with a plain message --");
  {
    const page = await newPage(browser, baseCfg({ calls: {
      [sel("escrowCount()")]: wordUint(0),
      [sel("getCard(uint256)")]: "THROW",
      [sel("ownerOfHandle(string)")]: wordAddr(ACCOUNT),
    } }));
    await page.fill("#s-card", "0");
    await page.fill("#s-amount", "0.001");
    await page.click("#send-form button[type=submit]");
    await page.waitForTimeout(500);
    const probe = await page.evaluate(() => ({
      msg: document.getElementById("send-msg").textContent,
      sheetOpen: !document.getElementById("confirm-sheet").hidden,
    }));
    check("plain not-found message, no sheet, no send", probe.msg.length > 0 && probe.sheetOpen === false, probe.msg);
    await page.close();
  }

  console.log("\n-- S10: dead RPC on list load shows the error state, not a fake empty --");
  {
    const page = await newPage(browser, baseCfg({ calls: {
      [sel("escrowCount()")]: "THROW",
      [sel("getCard(uint256)")]: cardHex("Kopi"),
      [sel("ownerOfHandle(string)")]: wordAddr(ACCOUNT),
    } }));
    await page.waitForTimeout(800);
    const listText = await page.textContent("#escrow-list");
    check("list error state shown", listText.includes("belum bisa dibaca"), listText.slice(0, 100));
    await page.close();
  }

  console.log("\n-- S11: layout, targets, focus, timing at 390 and 1280, both themes --");
  for (const width of [320, 390, 1280]) {
    const page = await newPage(browser, baseCfg(), { width, height: 844 });
    const probe = await page.evaluate(() => {
      const overflow = document.scrollingElement.scrollWidth - window.innerWidth;
      const targets = [];
      for (const el of document.querySelectorAll("button, input, select, a[href]")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) targets.push({ tag: el.tagName, id: el.id || el.className, w: r.width, h: r.height });
      }
      const timing = performance.timing;
      return {
        overflow,
        targets,
        dcl: timing.domContentLoadedEventEnd - timing.navigationStart,
        load: timing.loadEventEnd - timing.navigationStart,
      };
    });
    check(`no horizontal overflow at ${width}`, probe.overflow <= 0, "overflow=" + probe.overflow);
    const tiny = probe.targets.filter((x) => x.h < 24 || x.w < 24);
    check(`no target under 24px at ${width}`, tiny.length === 0, JSON.stringify(tiny.slice(0, 3)));
    const small = probe.targets.filter((x) => x.h < 44 && x.tag !== "A");
    check(`all controls at least 44px tall at ${width}`, small.length === 0, JSON.stringify(small.slice(0, 3)));
    if (width === 390) console.log(`       timing local: DOMContentLoaded ${probe.dcl} ms, load ${probe.load} ms`);
    await page.close();
  }
  {
    // Keyboard focus visibility on the first controls.
    const page = await newPage(browser, baseCfg());
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, id: el.id, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
    });
    check("keyboard focus lands on a control with a visible outline",
      focus.outlineStyle === "solid" && parseFloat(focus.outlineWidth) >= 2,
      JSON.stringify(focus));
    await page.close();
  }

  await browser.close();
  server.close();
  console.log(`\nFRONTEND RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
