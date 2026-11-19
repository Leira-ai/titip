"use strict";
/*
 * Titip frontend.
 *
 * Wallet layer: EIP-6963 provider discovery with an injected EIP-1193
 * fallback, chain check, switch/add chain flow (EIP-3326 / EIP-3085),
 * live account and chain listeners, silent reconnect via eth_accounts.
 * No signature is ever requested for browsing or connecting.
 *
 * Transaction adapter (Gate 9): every state-changing action is
 * simulated with eth_call first and stops fail-closed when the
 * simulation fails; the confirmation sheet shows the decoded effect
 * plus the estimated network fee before any signature is requested;
 * then eth_sendTransaction, then receipt polling with the final status
 * and tx hash shown in place. Contract errors are decoded to
 * plain-words messages in both languages.
 *
 * Network modes:
 * - mainnet (default): BNB Chain (56) with the real Agent ID registry.
 *   escrowAddress stays null, so the adapter is fail-closed absolutely:
 *   it refuses to broadcast anything on chain 56, and every action
 *   stops at the confirmation sheet with a plain-words message.
 * - testnet (?network=testnet): BSC Testnet (97) wired to the Titip
 *   testnet deployment and its MockAgentID registry, clearly labelled.
 *   The four actions (create card, deposit, claim, refund) broadcast
 *   real testnet transactions from the connected wallet.
 *
 * The chain codec below (Keccak-256 + a minimal ABI coder) is
 * hand-rolled so the page keeps zero runtime dependencies.
 */

const NETWORKS = {
  mainnet: {
    chainIdHex: "0x38", // BNB Chain, 56
    chainProfile: {
      chainId: "0x38",
      chainName: "BNB Smart Chain",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: ["https://bsc-dataseed.binance.org"],
      blockExplorerUrls: ["https://bscscan.com"],
    },
    agentIdRegistry: "0x60b9262456de011f7d15a54cdd8c48baaa8b022f",
    escrowAddress: null, // mainnet deploy is a separate, later phase
  },
  testnet: {
    chainIdHex: "0x61", // BSC Testnet, 97
    chainProfile: {
      chainId: "0x61",
      chainName: "BNB Smart Chain Testnet",
      nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
      rpcUrls: ["https://bsc-testnet-rpc.publicnode.com"],
      blockExplorerUrls: ["https://testnet.bscscan.com"],
    },
    // MockAgentID testnet deployment (deploy/testnet-state.json)
    agentIdRegistry: "0x66bFC04f22DC2892dDeD3aCb97F21B7edDF0Ca23",
    // TitipEscrow testnet deployment, Sourcify exact match on chain 97
    escrowAddress: "0x69CFC14869706EbD12EcD38a5746A0684E06b519",
  },
};

const NETWORK_MODE =
  new URLSearchParams(window.location.search).get("network") === "testnet" ? "testnet" : "mainnet";

const CONFIG = Object.assign({}, NETWORKS[NETWORK_MODE], {
  network: NETWORK_MODE,
  isTestnet: NETWORK_MODE === "testnet",
});

const STRINGS = {
  id: {
    connect: "Hubungkan Wallet", disconnect: "Putuskan", switchChain: "Pindah ke BNB Chain",
    headline: "Bayar ke nama, bukan ke alamat acak.",
    lede: "Kirim BNB ke nama .ai lewat Titip. Uang terkunci di kontrak dan hanya bisa diambil pemilik nama itu. Lewat tenggat tanpa klaim, uang kembali utuh ke pengirim.",
    deployNote: "Status: fondasi. Kontrak belum dideploy, jadi tombol transaksi menampilkan ringkasan dulu dan belum mengirim apa pun.",
    testnetNote: "Testnet: halaman ini memakai deployment uji di BSC Testnet (chain 97) dengan registry Agent ID tiruan. Semua dana tBNB uji, bukan uang asli. Tombol transaksi di mode ini mengirim transaksi testnet beneran dari wallet kamu. Kontrak mainnet belum dideploy.",
    labStamp: "Sudah diklaim", labTo: "Penerima", labAmount: "Nominal",
    labAmountValue: "0,001 tBNB", labCard: "Kartu", labDeadline: "Tenggat",
    labDeadlineValue: "1 jam", labFrom: "Pengirim", labTx: "Tx klaim",
    labCaption: "Contoh nyata dari testnet Titip, terbukti on-chain.",
    ctaSend: "Mulai kirim", ctaCreate: "Buat kartu",
    step1T: "Terbitkan kartu",
    step1B: "Pemilik nama .ai menerbitkan satu kartu pembayaran untuk dibagikan ke semua pembeli.",
    step2T: "Kirim ke kartu itu",
    step2B: "BNB terkunci di kontrak Titip, bukan di alamat pribadi siapa pun.",
    step3T: "Klaim, atau kembali",
    step3B: "Pemilik nama mengambilnya. Lewat tenggat tanpa klaim, pengirim menariknya kembali utuh.",
    switchChainTn: "Pindah ke BSC Testnet", onChainTn: "BSC Testnet",
    createTitle: "Buat kartu pembayaran",
    createHint: "Kartu hanya bisa diterbitkan oleh pemilik nama. Satu kartu cukup untuk dibagikan ke semua pembeli.",
    fName: "Nama .ai kamu", fItem: "Barang atau jasa", fItemPh: "Contoh: Kopi 250 gram",
    fAmount: "Nominal saran (BNB, boleh kosong)", createBtn: "Terbitkan kartu",
    sendTitle: "Kirim ke nama",
    sendHint: "Nama dan barang dibaca dari kontrak, bukan dari tautan, jadi tidak bisa dipalsukan pengirim tautan.",
    fCardId: "Nomor kartu", fSendAmount: "Nominal (BNB)", fDeadline: "Tenggat klaim",
    d0h: "1 jam", d1: "1 hari", d3: "3 hari", d7: "7 hari", d30: "30 hari", sendBtn: "Tinjau dan kirim",
    listTitle: "Titipan saya",
    emptyTitle: "Hubungkan wallet untuk melihat titipanmu.",
    emptyBody: "Sesudah wallet terhubung, titipan yang kamu kirim dan yang menunggu kamu klaim tampil di sini dengan statusnya.",
    ownerTitle: "Siapa bisa memindahkan uang di Titip?",
    ownerBody: "Hanya dua pihak: pemilik nama penerima (untuk mengambil) dan pengirim asal (untuk menarik kembali sesudah tenggat). Kontrak Titip tidak punya pemilik, tidak punya tombol admin, dan tidak bisa menarik dana pengguna. Alamat registry Agent ID tidak bisa diganti sesudah deploy.",
    footContract: "Kontrak:", footPrivacy: "Titip tidak mencatat alamat wallet untuk analitik.",
    sheetTitle: "Periksa dulu sebelum tanda tangan",
    sheetVol: "Nilai BNB bisa naik turun. Pastikan nominal dan nama penerima sudah benar.",
    cancel: "Batal", confirmSend: "Kirim lewat wallet",
    confirmCreate: "Terbitkan lewat wallet", confirmClaim: "Klaim lewat wallet", confirmRefund: "Tarik lewat wallet",
    notDeployed: "Kontrak Titip belum dideploy. Ringkasan ini contoh tampilan; belum ada transaksi yang dikirim.",
    needWallet: "Hubungkan wallet dulu untuk melanjutkan.",
    noProvider: "Tidak ada wallet yang terdeteksi di browser ini. Buka halaman ini di browser wallet atau pasang wallet EIP-1193.",
    wrongNetwork: "Wallet kamu di jaringan lain. Titip hanya berjalan di BNB Chain.",
    connectedAs: "Terhubung:", onChain: "BNB Chain",
    badHandle: "Nama hanya boleh huruf kecil dan angka, 3 sampai 20 karakter.",
    badAmount: "Nominal harus angka lebih dari nol.",
    badCard: "Nomor kartu harus angka.",
    rowTo: "Untuk kartu nomor", rowAmount: "Nominal", rowDeadline: "Tenggat",
    rowEffect: "Yang terjadi",
    effectText: "BNB kamu terkunci di kontrak Titip. Hanya pemilik nama penerima yang bisa mengambilnya. Lewat tenggat tanpa klaim, kamu bisa menariknya kembali utuh.",
    copied: "Alamat lengkap disalin.",
    rowName: "Nama penerima", rowItem: "Barang atau jasa", rowEscrow: "Titipan nomor",
    rowYouGet: "Kamu menerima", rowYouBack: "Kembali ke kamu",
    gasFee: "Perkiraan biaya jaringan", totalOut: "Total keluar",
    anyAmount: "Bebas, pembeli yang menentukan",
    createEffect: "Kartu pembayaran untuk nama kamu terbit di kontrak Titip. Sesudah terbit, siapa pun bisa mengirim ke kartu ini dan hanya kamu, pemilik namanya, yang bisa mengambil uangnya.",
    claimEffect: "BNB dari titipan ini pindah dari kontrak Titip ke wallet kamu, dan titipan ditandai sudah diklaim. Ini juga konfirmasi penerimaanmu yang tercatat on-chain.",
    refundEffect: "BNB dari titipan ini kembali dari kontrak Titip ke wallet kamu, dan titipan ditandai sudah kembali.",
    checking: "Memeriksa transaksi ini di kontrak dulu...",
    waitSign: "Menunggu tanda tangan di wallet kamu...",
    processing: "Transaksi terkirim. Menunggu konfirmasi jaringan...",
    viewTx: "Lihat di penjelajah",
    successCreate: "Kartu terbit di kontrak.",
    successSend: "Titipanmu terkunci di kontrak.",
    successClaim: "Titipan sudah masuk ke wallet kamu.",
    successRefund: "Titipan sudah kembali ke wallet kamu.",
    cardIssued: "Kartu nomor {n} terbit. Pembeli bisa mengirim ke nomor kartu ini.",
    errRejected: "Kamu membatalkan tanda tangan di wallet. Tidak ada transaksi yang dikirim.",
    errFunds: "Saldo wallet kamu tidak cukup untuk nominal dan biaya jaringan ini.",
    errSimGeneric: "Kontrak menolak transaksi ini pada pemeriksaan awal, jadi tidak dikirim. Tidak ada dana yang bergerak.",
    errNameNotRegistered: "Nama ini belum terdaftar di Agent ID, jadi kartu tidak bisa diterbitkan untuknya.",
    errNotNameOwner: "Wallet kamu bukan pemilik nama ini. Kartu hanya bisa diterbitkan oleh pemilik namanya.",
    errCardNotFound: "Nomor kartu ini tidak ada di kontrak.",
    errCardInactive: "Kartu ini sudah dinonaktifkan penerbitnya, jadi tidak menerima kiriman baru.",
    errZeroAmount: "Nominal tidak boleh nol.",
    errDeadlineRange: "Tenggat di luar batas kontrak (1 jam sampai 90 hari).",
    errEscrowNotFound: "Titipan ini tidak ditemukan di kontrak.",
    errNotLocked: "Titipan ini sudah selesai, sudah diklaim atau sudah kembali, jadi tidak bisa diproses lagi.",
    errNotRecipient: "Hanya pemilik nama penerima yang bisa mengambil titipan ini.",
    errNotSender: "Hanya pengirim asal yang bisa menarik kembali titipan ini.",
    errDeadlineNotReached: "Tenggat belum lewat. Refund baru terbuka sesudah tenggat berakhir tanpa klaim.",
    errTxFailed: "Transaksi gagal di jaringan. Dana tidak berpindah; cek tx di penjelajah untuk rinciannya.",
    errSlow: "Transaksi belum terkonfirmasi sesudah 90 detik. Cek statusnya di penjelajah sebelum mencoba lagi.",
    claimBtn: "Klaim", refundBtn: "Tarik kembali",
    stLocked: "Terkunci", stClaimed: "Sudah diklaim", stRefunded: "Sudah kembali",
    listFrom: "Dari", roleSender: "Kamu pengirimnya", roleRecipient: "Untuk nama kamu",
    dustWhy: "Nominal ini lebih kecil dari perkiraan biaya klaimnya, jadi tombol klaim dimatikan supaya kamu tidak rugi biaya.",
    refundWhy: "Refund terbuka sesudah tenggat lewat tanpa klaim.",
    deadlinePassed: "Tenggat sudah lewat",
    listLoading: "Membaca titipan dari kontrak...",
    listError: "Daftar titipan belum bisa dibaca dari kontrak. Coba hubungkan ulang wallet kamu.",
    listNoneTitle: "Belum ada titipan untuk wallet ini.",
    listNoneBody: "Titipan yang kamu kirim dan yang menunggu kamu klaim akan tampil di sini.",
    readingCard: "Membaca kartu dari kontrak...",
  },
  en: {
    connect: "Connect Wallet", disconnect: "Disconnect", switchChain: "Switch to BNB Chain",
    headline: "Pay a name, not a random address.",
    lede: "Send BNB to a .ai name through Titip. The money locks in the contract and only the name owner can take it. Past the deadline with no claim, it returns to the sender in full.",
    deployNote: "Status: foundation. The contract is not deployed yet, so transaction buttons show a summary first and send nothing.",
    testnetNote: "Testnet: this page uses the Titip test deployment on BSC Testnet (chain 97) with a mock Agent ID registry. All funds are test tBNB, not real money. Transaction buttons in this mode send real testnet transactions from your wallet. The mainnet contract is not deployed yet.",
    labStamp: "Claimed", labTo: "Recipient", labAmount: "Amount",
    labAmountValue: "0.001 tBNB", labCard: "Card", labDeadline: "Deadline",
    labDeadlineValue: "1 hour", labFrom: "Sender", labTx: "Claim tx",
    labCaption: "A real example from the Titip testnet, proven on-chain.",
    ctaSend: "Start sending", ctaCreate: "Create a card",
    step1T: "Issue a card",
    step1B: "The .ai name owner issues one payment card to share with every buyer.",
    step2T: "Send to that card",
    step2B: "BNB locks in the Titip contract, not in anyone's personal address.",
    step3T: "Claimed, or returned",
    step3B: "The name owner claims it. Past the deadline with no claim, the sender takes it back in full.",
    switchChainTn: "Switch to BSC Testnet", onChainTn: "BSC Testnet",
    createTitle: "Create a payment card",
    createHint: "Only the owner of a name can issue its card. One card is enough to share with every buyer.",
    fName: "Your .ai name", fItem: "Item or service", fItemPh: "Example: Coffee 250 g",
    fAmount: "Suggested amount (BNB, optional)", createBtn: "Issue card",
    sendTitle: "Send to a name",
    sendHint: "The name and item are read from the contract, not from the link, so a link sender cannot fake them.",
    fCardId: "Card number", fSendAmount: "Amount (BNB)", fDeadline: "Claim deadline",
    d0h: "1 hour", d1: "1 day", d3: "3 days", d7: "7 days", d30: "30 days", sendBtn: "Review and send",
    listTitle: "My escrows",
    emptyTitle: "Connect your wallet to see your escrows.",
    emptyBody: "After your wallet is connected, escrows you sent and escrows waiting for your claim appear here with their status.",
    ownerTitle: "Who can move money in Titip?",
    ownerBody: "Only two parties: the owner of the recipient name (to claim) and the original sender (to take it back after the deadline). The Titip contract has no owner, no admin button, and cannot withdraw user funds. The Agent ID registry address can never be changed after deployment.",
    footContract: "Contract:", footPrivacy: "Titip does not record wallet addresses for analytics.",
    sheetTitle: "Check before you sign",
    sheetVol: "BNB value moves up and down. Make sure the amount and the recipient name are right.",
    cancel: "Cancel", confirmSend: "Send via wallet",
    confirmCreate: "Issue via wallet", confirmClaim: "Claim via wallet", confirmRefund: "Take back via wallet",
    notDeployed: "The Titip contract is not deployed yet. This summary is a preview; no transaction was sent.",
    needWallet: "Connect your wallet first to continue.",
    noProvider: "No wallet was detected in this browser. Open this page in a wallet browser or install an EIP-1193 wallet.",
    wrongNetwork: "Your wallet is on another network. Titip only runs on BNB Chain.",
    connectedAs: "Connected:", onChain: "BNB Chain",
    badHandle: "Names are lowercase letters and digits only, 3 to 20 characters.",
    badAmount: "The amount must be a number above zero.",
    badCard: "The card number must be a number.",
    rowTo: "For card number", rowAmount: "Amount", rowDeadline: "Deadline",
    rowEffect: "What happens",
    effectText: "Your BNB is locked in the Titip contract. Only the owner of the recipient name can take it. Past the deadline without a claim, you can take it back in full.",
    copied: "Full address copied.",
    rowName: "Recipient name", rowItem: "Item or service", rowEscrow: "Escrow number",
    rowYouGet: "You receive", rowYouBack: "Back to you",
    gasFee: "Estimated network fee", totalOut: "Total out",
    anyAmount: "Any amount, the buyer decides",
    createEffect: "A payment card for your name is issued in the Titip contract. Once issued, anyone can send to this card and only you, the name owner, can take the money.",
    claimEffect: "The BNB in this escrow moves from the Titip contract to your wallet, and the escrow is marked claimed. This is also your on-chain confirmation of receipt.",
    refundEffect: "The BNB in this escrow returns from the Titip contract to your wallet, and the escrow is marked refunded.",
    checking: "Checking this transaction against the contract first...",
    waitSign: "Waiting for your signature in your wallet...",
    processing: "Transaction sent. Waiting for network confirmation...",
    viewTx: "View in explorer",
    successCreate: "Card issued in the contract.",
    successSend: "Your payment is locked in the contract.",
    successClaim: "The payment is now in your wallet.",
    successRefund: "The payment is back in your wallet.",
    cardIssued: "Card number {n} issued. Buyers can send to this card number.",
    errRejected: "You cancelled the signature in your wallet. No transaction was sent.",
    errFunds: "Your wallet balance is not enough for this amount plus the network fee.",
    errSimGeneric: "The contract rejected this transaction in the pre-check, so it was not sent. No funds moved.",
    errNameNotRegistered: "This name is not registered in Agent ID, so no card can be issued for it.",
    errNotNameOwner: "Your wallet does not own this name. Only the name owner can issue its card.",
    errCardNotFound: "This card number does not exist in the contract.",
    errCardInactive: "This card was deactivated by its issuer and no longer accepts payments.",
    errZeroAmount: "The amount cannot be zero.",
    errDeadlineRange: "The deadline is outside the contract range (1 hour to 90 days).",
    errEscrowNotFound: "This escrow was not found in the contract.",
    errNotLocked: "This escrow is already settled, claimed or refunded, and cannot be processed again.",
    errNotRecipient: "Only the owner of the recipient name can claim this escrow.",
    errNotSender: "Only the original sender can take this escrow back.",
    errDeadlineNotReached: "The deadline has not passed yet. A refund only opens after it ends unclaimed.",
    errTxFailed: "The transaction failed on-chain. No funds moved; check the tx in the explorer for details.",
    errSlow: "The transaction is not confirmed after 90 seconds. Check it in the explorer before trying again.",
    claimBtn: "Claim", refundBtn: "Take back",
    stLocked: "Locked", stClaimed: "Claimed", stRefunded: "Refunded",
    listFrom: "From", roleSender: "You are the sender", roleRecipient: "For your name",
    dustWhy: "This amount is smaller than the estimated claim fee, so the claim button is disabled to keep the claim from costing more than it pays.",
    refundWhy: "Refund opens after the deadline passes unclaimed.",
    deadlinePassed: "Deadline passed",
    listLoading: "Reading escrows from the contract...",
    listError: "The escrow list could not be read from the contract. Try reconnecting your wallet.",
    listNoneTitle: "No escrows for this wallet yet.",
    listNoneBody: "Escrows you send and escrows waiting for your claim will appear here.",
    readingCard: "Reading the card from the contract...",
  },
};

let lang = "id";
let account = null;
let chainOk = false;
let provider = null;
let providerWired = false;

const $ = (id) => document.getElementById(id);

function t(key) {
  return STRINGS[lang][key] || STRINGS.id[key] || key;
}

function applyLang(next) {
  lang = next;
  document.documentElement.lang = next;
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n"));
  }
  for (const el of document.querySelectorAll("[data-i18n-ph]")) {
    el.placeholder = t(el.getAttribute("data-i18n-ph"));
  }
  $("lang-id").classList.toggle("is-on", next === "id");
  $("lang-en").classList.toggle("is-on", next === "en");
  if (CONFIG.isTestnet) {
    // The deploy note carries the testnet label; applyLang's data-i18n
    // pass writes the mainnet foundation note, so override it here.
    $("deploy-note").textContent = t("testnetNote");
    const badge = $("network-badge");
    if (badge) badge.hidden = false;
  }
  renderWalletBar();
  renderList();
}

/* ------------------------------------------------------------------ */
/* Keccak-256 (pure JS, BigInt lanes) + minimal ABI codec.            */
/* Verified against reference vectors and the deployed contract ABI   */
/* in the QA harness; the page itself keeps zero runtime dependencies. */
/* ------------------------------------------------------------------ */

const MASK64 = (1n << 64n) - 1n;
const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// Rotation offsets indexed [x][y] for the lane at (x, y).
const KECCAK_ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function rotl64(v, n) {
  if (n === 0) return v;
  const b = BigInt(n);
  return ((v << b) | (v >> (64n - b))) & MASK64;
}

function keccakF1600(s) {
  const C = new Array(5);
  const D = new Array(5);
  const B = new Array(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] ^= D[x];
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl64(s[x + 5 * y], KECCAK_ROT[x][y]);
      }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        s[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & B[((x + 2) % 5) + 5 * y]);
      }
    }
    s[0] ^= KECCAK_RC[round];
  }
}

function keccak256(bytes) {
  const RATE = 136; // Keccak-256: rate 1088 bits, capacity 512 bits
  const s = new Array(25).fill(0n);
  const padded = Array.from(bytes);
  padded.push(0x01); // original Keccak pad10*1 domain byte (not SHA3's 0x06)
  while (padded.length % RATE !== 0) padded.push(0);
  // pad10*1: the last byte of the final block carries the 0x80 bit. When
  // the domain byte itself lands on that last byte (input length one
  // short of a rate multiple) the two merge into 0x81 in the same block;
  // an earlier version of this code wrongly opened a new block there and
  // hashed every input of length 135 mod 136 incorrectly.
  padded[padded.length - 1] |= 0x80;
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE; i++) {
      const lane = Math.floor(i / 8);
      s[lane] ^= BigInt(padded[off + i]) << BigInt(8 * (i % 8));
    }
    keccakF1600(s);
  }
  const out = [];
  for (let i = 0; i < 32; i++) {
    out.push(Number((s[Math.floor(i / 8)] >> BigInt(8 * (i % 8))) & 0xffn));
  }
  return out;
}

function utf8Bytes(str) {
  return Array.from(new TextEncoder().encode(str));
}

function bytesToHex(bytes) {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function keccak256Hex(str) {
  return bytesToHex(keccak256(utf8Bytes(str)));
}

function selectorOf(sig) {
  return "0x" + keccak256Hex(sig).slice(0, 8);
}

/* --- ABI encoding: uint256, address, bool, string --- */

function wordHex(v) {
  return BigInt(v).toString(16).padStart(64, "0");
}

function encValue(type, value) {
  if (type === "uint256") return { dyn: false, hex: wordHex(value) };
  if (type === "address") return { dyn: false, hex: "0".repeat(24) + String(value).slice(2).toLowerCase() };
  if (type === "bool") return { dyn: false, hex: wordHex(value ? 1n : 0n) };
  if (type === "string") {
    const b = utf8Bytes(value);
    const data = bytesToHex(b).padEnd(Math.ceil(b.length / 32) * 64, "0");
    return { dyn: true, hex: wordHex(BigInt(b.length)) + data };
  }
  throw new Error("unsupported ABI type " + type);
}

function encodeCall(sig, types, values) {
  const parts = types.map((ty, i) => encValue(ty, values[i]));
  let head = "";
  let tail = "";
  let offset = types.length * 32;
  for (const p of parts) {
    if (p.dyn) {
      head += wordHex(BigInt(offset));
      tail += p.hex;
      offset += p.hex.length / 2;
    } else {
      head += p.hex;
    }
  }
  return selectorOf(sig) + head + tail;
}

/* --- ABI decoding helpers --- */

function hexToBytes(hex) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = [];
  for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
}

function wordAt(hex, idx) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  return h.slice(idx * 64, idx * 64 + 64);
}

function decUintWord(w) {
  return BigInt("0x" + w);
}

function decAddrWord(w) {
  return "0x" + w.slice(24).toLowerCase();
}

function decStringAt(hex, byteOffset) {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const len = Number(decUintWord(h.slice(byteOffset * 2, byteOffset * 2 + 64)));
  const dataHex = h.slice(byteOffset * 2 + 64, byteOffset * 2 + 64 + len * 2);
  return new TextDecoder().decode(Uint8Array.from(hexToBytes(dataHex)));
}

/* A single struct return value is ABI-encoded as a one-component
 * tuple: the first word is the byte offset of the struct encoding,
 * and the struct's own string offsets are relative to that base. */
function tupleBase(hex) {
  return Number(decUintWord(wordAt(hex, 0)));
}

function decodeCard(hex) {
  const base = tupleBase(hex);
  const w = (i) => wordAt(hex, base / 32 + i);
  return {
    tokenId: decUintWord(w(0)),
    handle: decStringAt(hex, base + Number(decUintWord(w(1)))),
    creator: decAddrWord(w(2)),
    item: decStringAt(hex, base + Number(decUintWord(w(3)))),
    suggestedAmount: decUintWord(w(4)),
    active: decUintWord(w(5)) !== 0n,
  };
}

function decodeEscrow(hex) {
  const base = tupleBase(hex);
  const w = (i) => wordAt(hex, base / 32 + i);
  return {
    cardId: decUintWord(w(0)),
    tokenId: decUintWord(w(1)),
    handle: decStringAt(hex, base + Number(decUintWord(w(2)))),
    sender: decAddrWord(w(3)),
    recipient: decAddrWord(w(4)),
    amount: decUintWord(w(5)),
    deadline: decUintWord(w(6)),
    status: Number(decUintWord(w(7))), // 0 Locked, 1 Claimed, 2 Refunded
  };
}

/* Contract error signatures -> plain-words dictionary keys. */
const ERROR_KEYS = {};
for (const [sig, key] of [
  ["NameNotRegistered(string)", "errNameNotRegistered"],
  ["NotNameOwner(string,address)", "errNotNameOwner"],
  ["CardNotFound(uint256)", "errCardNotFound"],
  ["CardInactive(uint256)", "errCardInactive"],
  ["NotCardCreator(uint256,address)", "errNotNameOwner"],
  ["ZeroAmount()", "errZeroAmount"],
  ["DeadlineOutOfRange(uint256)", "errDeadlineRange"],
  ["EscrowNotFound(uint256)", "errEscrowNotFound"],
  ["EscrowNotLocked(uint256)", "errNotLocked"],
  ["NotRecipient(uint256,address)", "errNotRecipient"],
  ["NotSender(uint256,address)", "errNotSender"],
  ["DeadlineNotReached(uint256,uint256)", "errDeadlineNotReached"],
  ["TransferFailed(address,uint256)", "errTxFailed"],
  ["ReentrantCall()", "errSimGeneric"],
]) {
  ERROR_KEYS[selectorOf(sig)] = key;
}

function extractRevertHex(e) {
  const seen = [e && e.data, e && e.error && e.error.data, e && e.info && e.info.error && e.info.error.data];
  for (const v of seen) {
    if (typeof v === "string" && v.startsWith("0x") && v.length >= 10) return v;
    if (v && typeof v === "object" && typeof v.originalError === "object") {
      const inner = v.originalError && v.originalError.data;
      if (typeof inner === "string" && inner.startsWith("0x")) return inner;
    }
  }
  return null;
}

function plainError(e, fallbackKey) {
  if (e && e.code === 4001) return t("errRejected");
  const msg = (e && e.message) || "";
  if (/insufficient funds/i.test(msg)) return t("errFunds");
  const hex = extractRevertHex(e);
  if (hex) {
    const sel = hex.slice(0, 10).toLowerCase();
    if (ERROR_KEYS[sel]) return t(ERROR_KEYS[sel]);
    if (sel === "0x08c379a0") {
      // Error(string) from a require(): still a contract rejection.
      return t(fallbackKey || "errSimGeneric");
    }
  }
  return t(fallbackKey || "errSimGeneric");
}

/* ------------------------------------------------------------------ */
/* Provider layer: EIP-6963 discovery, injected fallback (Gate 8).    */
/* ------------------------------------------------------------------ */

const announcedProviders = [];
window.addEventListener("eip6963:announceProvider", (ev) => {
  if (ev.detail && ev.detail.provider) {
    announcedProviders.push(ev.detail);
    pickProvider();
  }
});

function pickProvider() {
  if (provider) return provider;
  if (announcedProviders.length > 0) provider = announcedProviders[0].provider;
  else if (window.ethereum) provider = window.ethereum;
  if (provider && !providerWired) {
    providerWired = true;
    provider.on("accountsChanged", (accs) => {
      account = accs && accs[0] ? accs[0] : null;
      // An open confirmation sheet was simulated and worded for the
      // previous account; never let it be signed by a different one.
      closeSheet();
      renderWalletBar();
      refreshList();
    });
    provider.on("chainChanged", () => {
      closeSheet();
      refreshChain();
    });
  }
  return provider;
}

async function ensureProvider() {
  pickProvider();
  if (provider) return provider;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 300));
  return pickProvider();
}

async function rpc(method, params) {
  const p = await ensureProvider();
  if (!p) throw new Error("no provider");
  return p.request({ method, params });
}

function truncateAddress(addr) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function renderWalletBar() {
  const bar = $("wallet-bar");
  const btn = $("connect-btn");
  if (!account) {
    bar.hidden = true;
    btn.textContent = t("connect");
    btn.disabled = false;
    return;
  }
  bar.hidden = false;
  btn.textContent = truncateAddress(account);
  const state = $("wallet-state");
  const chainName = CONFIG.isTestnet ? t("onChainTn") : t("onChain");
  state.textContent =
    t("connectedAs") + " " + truncateAddress(account) + " · " + (chainOk ? chainName : t("wrongNetwork"));
  state.title = account;
  const switchBtn = $("switch-chain-btn");
  switchBtn.textContent = CONFIG.isTestnet ? t("switchChainTn") : t("switchChain");
  switchBtn.hidden = chainOk;
}

async function refreshChain() {
  try {
    const id = await rpc("eth_chainId");
    chainOk = id === CONFIG.chainIdHex;
  } catch (e) {
    chainOk = false;
  }
  renderWalletBar();
}

async function connect() {
  const p = await ensureProvider();
  if (!p) {
    $("create-msg").textContent = t("noProvider");
    $("create-msg").classList.add("is-error");
    return;
  }
  const btn = $("connect-btn");
  btn.disabled = true;
  try {
    const accounts = await p.request({ method: "eth_requestAccounts" });
    account = accounts && accounts[0] ? accounts[0] : null;
    await refreshChain();
    refreshList();
  } catch (e) {
    btn.disabled = false;
  }
  renderWalletBar();
}

async function switchChain() {
  try {
    await rpc("wallet_switchEthereumChain", [{ chainId: CONFIG.chainIdHex }]);
  } catch (e) {
    if (e && e.code === 4902) {
      await rpc("wallet_addEthereumChain", [CONFIG.chainProfile]);
      await rpc("wallet_switchEthereumChain", [{ chainId: CONFIG.chainIdHex }]);
    }
  }
  await refreshChain();
}

function disconnect() {
  account = null;
  renderWalletBar();
  renderList();
}

/* ------------------------------------------------------------------ */
/* Amounts, dates.                                                    */
/* ------------------------------------------------------------------ */

function parseAmountToWei(str) {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(String(str).trim());
  if (!m) return null;
  const whole = BigInt(m[1]) * 10n ** 18n;
  const frac = BigInt((m[2] || "").padEnd(18, "0") || "0");
  const wei = whole + frac;
  return wei > 0n ? wei : null;
}

function formatBnb(wei) {
  const s = wei.toString().padStart(19, "0");
  const whole = s.slice(0, -18);
  const frac = s.slice(-18).replace(/0+$/, "");
  return frac ? whole + "." + frac : whole;
}

/* Display-only rounding for estimated fees and their totals: rounds
 * half-up to 6 decimals so an estimate never renders as a 12+ decimal
 * string. The amount rows stay exact, and the value that is actually
 * signed is never touched by this formatter. */
function formatBnbRounded(wei) {
  const STEP = 10n ** 12n; // 0.000001 of a coin, in wei
  const rounded = ((wei + STEP / 2n) / STEP) * STEP;
  if (rounded === 0n && wei > 0n) return "<0.000001";
  return formatBnb(rounded);
}

function currencyUnit() {
  return CONFIG.isTestnet ? "tBNB" : "BNB";
}

function formatDateTime(unixSeconds) {
  return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(Number(unixSeconds) * 1000));
}

/* ------------------------------------------------------------------ */
/* Contract reads through the connected provider (Gate 9 transport:   */
/* sequential, bounded, successes only).                              */
/* ------------------------------------------------------------------ */

async function callView(to, sig, types, values) {
  const data = encodeCall(sig, types, values);
  return rpc("eth_call", [{ to, data }, "latest"]);
}

async function readCard(cardId) {
  const hex = await callView(CONFIG.escrowAddress, "getCard(uint256)", ["uint256"], [BigInt(cardId)]);
  return decodeCard(hex);
}

async function readEscrow(escrowId) {
  const hex = await callView(CONFIG.escrowAddress, "getEscrow(uint256)", ["uint256"], [BigInt(escrowId)]);
  return decodeEscrow(hex);
}

async function readCount(sig) {
  const hex = await callView(CONFIG.escrowAddress, sig, [], []);
  return Number(decUintWord(wordAt(hex, 0)));
}

async function readOwnerOfHandle(handle) {
  const hex = await callView(CONFIG.agentIdRegistry, "ownerOfHandle(string)", ["string"], [handle]);
  return decAddrWord(wordAt(hex, 0));
}

async function readOwnerOf(tokenId) {
  const hex = await callView(CONFIG.agentIdRegistry, "ownerOf(uint256)", ["uint256"], [tokenId]);
  return decAddrWord(wordAt(hex, 0));
}

function tokenIdOfHandle(handle) {
  return BigInt("0x" + keccak256Hex(handle));
}

/* ------------------------------------------------------------------ */
/* Confirmation sheet + transaction runner (Gate 9 and Gate 16).      */
/*                                                                    */
/* Flow: open sheet with decoded effect -> simulate (eth_call) ->     */
/* estimate fee -> user confirms -> eth_sendTransaction -> poll       */
/* receipt -> final status in place. Simulation failure means the     */
/* confirm button never enables: the action is not offered.           */
/* Mainnet is fail-closed absolutely: escrowAddress is null there,    */
/* and the runner refuses any send unless the wallet is on the        */
/* configured chain of a mode that has a deployed escrow.             */
/* ------------------------------------------------------------------ */

let pendingAction = null;

function setSheetMsg(text, kind) {
  const m = $("sheet-msg");
  m.textContent = text || "";
  m.classList.toggle("is-error", kind === "error");
  m.classList.toggle("is-ok", kind === "ok");
}

function setSheetTx(hash) {
  const el = $("sheet-tx");
  if (!hash) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  el.hidden = false;
  el.replaceChildren();
  const span = document.createElement("span");
  span.textContent = "Tx: " + hash;
  const a = document.createElement("a");
  a.href = CONFIG.chainProfile.blockExplorerUrls[0] + "/tx/" + hash;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = t("viewTx");
  el.append(span, document.createTextNode(" · "), a);
}

function renderSheetRows(rows) {
  const dl = $("sheet-rows");
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const div = document.createElement("div");
    div.className = "row";
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    div.append(dt, dd);
    dl.append(div);
  }
}

/* Dialog semantics (F-10): the sheet is role=dialog aria-modal in the
   markup; here it gains Escape-to-close, initial focus on its heading,
   a Tab cycle that stays inside the sheet, and focus returned to the
   control that opened it when it closes. */
let sheetReturnFocus = null;

function openSheet() {
  sheetReturnFocus = document.activeElement;
  $("sheet-backdrop").hidden = false;
  $("confirm-sheet").hidden = false;
  const h = $("sheet-h");
  if (h) h.focus();
}

function closeSheet() {
  $("sheet-backdrop").hidden = true;
  $("confirm-sheet").hidden = true;
  pendingAction = null;
  if (sheetReturnFocus && document.contains(sheetReturnFocus)) {
    sheetReturnFocus.focus();
  }
  sheetReturnFocus = null;
}

function onSheetKeydown(e) {
  const sheet = $("confirm-sheet");
  if (sheet.hidden) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeSheet();
    return;
  }
  if (e.key !== "Tab") return;
  const cycle = [$("sheet-h")].concat(
    Array.from(sheet.querySelectorAll("button:not([disabled]), a[href]"))
  );
  if (cycle.length < 2) return;
  const first = cycle[0];
  const last = cycle[cycle.length - 1];
  if (e.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function adapterArmed() {
  // The adapter may only ever broadcast in a mode with a deployed
  // escrow (today: testnet). Mainnet stays fail-closed, always.
  return Boolean(CONFIG.escrowAddress);
}

async function openActionSheet(action) {
  // action: { kind, confirmKey, rows, tx:{to,data,value}, successKey,
  //           onSuccess(receipt) }
  pendingAction = action;
  renderSheetRows(action.rows);
  setSheetMsg("", null);
  setSheetTx(null);
  $("sheet-confirm").textContent = t(action.confirmKey);
  $("sheet-confirm").disabled = true;
  openSheet();

  if (!adapterArmed()) {
    setSheetMsg(t("notDeployed"), "error");
    return;
  }
  if (!guardWallet($("sheet-msg"))) {
    return;
  }
  setSheetMsg(t("checking"), null);
  const txReq = { from: account, to: action.tx.to, data: action.tx.data };
  if (action.tx.value && action.tx.value > 0n) txReq.value = "0x" + action.tx.value.toString(16);
  try {
    await rpc("eth_call", [txReq, "latest"]); // simulation gate
  } catch (e) {
    setSheetMsg(plainError(e, "errSimGeneric"), "error");
    pendingAction = null;
    return;
  }
  // Fee estimate for the sheet. If eth_estimateGas fails after a clean
  // simulation, fall back to a generous per-action bound for display;
  // the send itself carries no gas field, so the wallet estimates.
  let gas = action.gasFallback;
  try {
    const est = await rpc("eth_estimateGas", [txReq]);
    gas = BigInt(est);
  } catch (e) { /* display fallback above */ }
  let gasPrice = 0n;
  try {
    gasPrice = BigInt(await rpc("eth_gasPrice"));
  } catch (e) { /* fee row skipped if the price is unreadable */ }
  if (gasPrice > 0n) {
    const fee = gas * gasPrice;
    const rows = action.rows.slice();
    rows.push([t("gasFee"), formatBnbRounded(fee) + " " + currencyUnit()]);
    if (action.tx.value && action.tx.value > 0n) {
      rows.push([t("totalOut"), formatBnbRounded(action.tx.value + fee) + " " + currencyUnit()]);
    }
    renderSheetRows(rows);
  }
  setSheetMsg("", null);
  if (pendingAction === action) $("sheet-confirm").disabled = false;
}

async function confirmPending() {
  const action = pendingAction;
  if (!action) return;
  const btn = $("sheet-confirm");
  btn.disabled = true;
  setSheetMsg(t("waitSign"), null);
  const txReq = { from: account, to: action.tx.to, data: action.tx.data };
  if (action.tx.value && action.tx.value > 0n) txReq.value = "0x" + action.tx.value.toString(16);
  let hash;
  try {
    hash = await rpc("eth_sendTransaction", [txReq]);
  } catch (e) {
    setSheetMsg(plainError(e, "errSimGeneric"), "error");
    btn.disabled = false;
    return;
  }
  setSheetTx(hash);
  setSheetMsg(t("processing"), null);
  const receipt = await pollReceipt(hash);
  if (!receipt) {
    setSheetMsg(t("errSlow"), "error");
    return;
  }
  if (receipt.status !== "0x1") {
    setSheetMsg(t("errTxFailed"), "error");
    return;
  }
  setSheetMsg(t(action.successKey), "ok");
  if (action.onSuccess) action.onSuccess(receipt, hash);
  refreshList();
}

async function pollReceipt(hash) {
  for (let i = 0; i < 45; i++) {
    try {
      const r = await rpc("eth_getTransactionReceipt", [hash]);
      if (r) return r;
    } catch (e) { /* keep polling */ }
    await new Promise((res) => setTimeout(res, 2000));
  }
  return null;
}

function eventTopicId(receipt, eventSig, topicIndex) {
  const topic0 = "0x" + keccak256Hex(eventSig);
  for (const log of receipt.logs || []) {
    if (
      log.address.toLowerCase() === CONFIG.escrowAddress.toLowerCase() &&
      log.topics[0] === topic0
    ) {
      return Number(decUintWord(log.topics[topicIndex].slice(2)));
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Escrow list: reads, states, claim and refund actions.              */
/* ------------------------------------------------------------------ */

let escrowCache = null; // null = not loaded yet
let listLoading = false;

function renderList() {
  const wrap = $("escrow-list");
  const msg = $("list-msg");
  wrap.replaceChildren();
  msg.textContent = "";
  msg.classList.remove("is-error");
  if (!account) {
    wrap.append(stateBlock(t("emptyTitle"), t("emptyBody")));
    return;
  }
  if (!chainOk) {
    wrap.append(stateBlock(t("emptyTitle"), t("wrongNetwork")));
    return;
  }
  if (listLoading) {
    wrap.append(stateBlock(t("listTitle"), t("listLoading")));
    return;
  }
  if (!escrowCache) {
    wrap.append(stateBlock(t("emptyTitle"), t("listLoading")));
    return;
  }
  if (escrowCache.error) {
    wrap.append(stateBlock(t("emptyTitle"), t("listError")));
    return;
  }
  if (escrowCache.rows.length === 0) {
    wrap.append(stateBlock(t("listNoneTitle"), t("listNoneBody")));
    return;
  }
  for (const row of escrowCache.rows) wrap.append(row);
}

function stateBlock(title, body) {
  const div = document.createElement("div");
  div.className = "state state-empty";
  const p1 = document.createElement("p");
  p1.className = "state-title";
  p1.textContent = title;
  const p2 = document.createElement("p");
  p2.className = "state-body";
  p2.textContent = body;
  div.append(p1, p2);
  return div;
}

async function refreshList() {
  if (!account || !chainOk || !adapterArmed()) {
    escrowCache = null;
    renderList();
    return;
  }
  if (listLoading) return;
  listLoading = true;
  renderList();
  try {
    const count = await readCount("escrowCount()");
    const rows = [];
    const ownerByToken = new Map();
    const now = Math.floor(Date.now() / 1000);
    let gasPrice = 0n;
    try {
      gasPrice = BigInt(await rpc("eth_gasPrice"));
    } catch (e) { /* dust check skipped without a price */ }
    // Bounded scan: this product's lists are per-user and small; the
    // cap keeps a pathological chain state from looping forever.
    const scan = Math.min(count, 300);
    // Reads run at bounded concurrency (Gate 9 transport discipline,
    // about 3 in flight) instead of one-by-one; results stay indexed
    // by escrow id so row order and content are unchanged.
    const escrows = new Array(scan);
    let nextIdx = 0;
    async function readWorker() {
      while (nextIdx < scan) {
        const i = nextIdx++;
        escrows[i] = await readEscrow(i);
      }
    }
    await Promise.all([readWorker(), readWorker(), readWorker()]);
    const me = account.toLowerCase();
    for (const esc of escrows) {
      if (esc.status !== 0 || ownerByToken.has(esc.tokenId)) continue;
      try {
        ownerByToken.set(esc.tokenId, await readOwnerOf(esc.tokenId));
      } catch (e) {
        ownerByToken.set(esc.tokenId, null);
      }
    }
    for (let i = 0; i < scan; i++) {
      const esc = escrows[i];
      const isSender = esc.sender === me;
      const isRecipientSnap = esc.recipient === me;
      const isOwner = esc.status === 0 && ownerByToken.get(esc.tokenId) === me;
      if (!isSender && !isRecipientSnap && !isOwner) continue;
      rows.push(buildEscrowRow(i, esc, { isSender, isOwner, now, gasPrice }));
    }
    escrowCache = { rows };
  } catch (e) {
    escrowCache = { error: true, rows: [] };
  }
  listLoading = false;
  renderList();
}

function buildEscrowRow(id, esc, ctx) {
  const div = document.createElement("div");
  div.className = "escrow-row";
  const top = document.createElement("div");
  top.className = "row-top";
  const name = document.createElement("span");
  name.textContent = esc.handle + ".ai · #" + id;
  const status = document.createElement("span");
  const statusText = esc.status === 0 ? t("stLocked") : esc.status === 1 ? t("stClaimed") : t("stRefunded");
  status.className =
    "status " + (esc.status === 0 ? "status-locked" : esc.status === 1 ? "status-claimed" : "status-refunded");
  status.textContent = statusText;
  top.append(name, status);
  div.append(top);

  const meta = document.createElement("p");
  meta.className = "meta";
  const deadlineText =
    esc.status === 0 && Number(esc.deadline) <= ctx.now
      ? t("deadlinePassed")
      : t("rowDeadline") + ": " + formatDateTime(esc.deadline);
  meta.textContent =
    t("rowAmount") + ": " + formatBnb(esc.amount) + " " + currencyUnit() + " · " + deadlineText;
  div.append(meta);

  const role = document.createElement("p");
  role.className = "meta";
  role.textContent = ctx.isSender
    ? t("roleSender")
    : ctx.isOwner || esc.recipient === account.toLowerCase()
      ? t("roleRecipient") + " · " + t("listFrom") + " " + truncateAddress(esc.sender)
      : t("listFrom") + " " + truncateAddress(esc.sender);
  div.append(role);

  if (esc.status === 0 && (ctx.isOwner || ctx.isSender)) {
    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (ctx.isOwner) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = t("claimBtn");
      const dust = ctx.gasPrice > 0n && esc.amount < ctx.gasPrice * 150000n;
      if (dust) {
        btn.disabled = true;
        const why = document.createElement("p");
        why.className = "why";
        why.textContent = t("dustWhy");
        div.append(why);
      } else {
        btn.addEventListener("click", () => startClaim(id, esc));
      }
      actions.append(btn);
    }
    if (ctx.isSender) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost";
      btn.textContent = t("refundBtn");
      if (Number(esc.deadline) > ctx.now) {
        btn.disabled = true;
        const why = document.createElement("p");
        why.className = "why";
        why.textContent = t("refundWhy");
        div.append(why);
      } else {
        btn.addEventListener("click", () => startRefund(id, esc));
      }
      actions.append(btn);
    }
    if (actions.childElementCount > 0) div.append(actions);
  }
  return div;
}

function startClaim(id, esc) {
  if (!guardWallet($("list-msg"))) return;
  openActionSheet({
    kind: "claim",
    confirmKey: "confirmClaim",
    successKey: "successClaim",
    gasFallback: 150000n,
    rows: [
      [t("rowEscrow"), String(id)],
      [t("rowName"), esc.handle + ".ai"],
      [t("rowYouGet"), formatBnb(esc.amount) + " " + currencyUnit()],
      [t("rowEffect"), t("claimEffect")],
    ],
    tx: {
      to: CONFIG.escrowAddress,
      data: encodeCall("claim(uint256)", ["uint256"], [BigInt(id)]),
      value: 0n,
    },
  });
}

function startRefund(id, esc) {
  if (!guardWallet($("list-msg"))) return;
  openActionSheet({
    kind: "refund",
    confirmKey: "confirmRefund",
    successKey: "successRefund",
    gasFallback: 150000n,
    rows: [
      [t("rowEscrow"), String(id)],
      [t("rowName"), esc.handle + ".ai"],
      [t("rowYouBack"), formatBnb(esc.amount) + " " + currencyUnit()],
      [t("rowEffect"), t("refundEffect")],
    ],
    tx: {
      to: CONFIG.escrowAddress,
      data: encodeCall("refund(uint256)", ["uint256"], [BigInt(id)]),
      value: 0n,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Forms.                                                             */
/* ------------------------------------------------------------------ */

function guardWallet(msgEl) {
  if (!account) {
    msgEl.textContent = t("needWallet");
    msgEl.classList.add("is-error");
    return false;
  }
  if (!chainOk) {
    msgEl.textContent = t("wrongNetwork");
    msgEl.classList.add("is-error");
    return false;
  }
  msgEl.classList.remove("is-error");
  return true;
}

async function onCreateSubmit(ev) {
  ev.preventDefault();
  const msg = $("create-msg");
  msg.classList.remove("is-error");
  const handle = $("f-handle").value.trim().toLowerCase();
  if (!/^[a-z0-9]{3,20}$/.test(handle)) {
    msg.textContent = t("badHandle");
    msg.classList.add("is-error");
    return;
  }
  const item = $("f-item").value.trim();
  const amountRaw = $("f-amount").value.trim();
  let suggested = 0n;
  if (amountRaw) {
    suggested = parseAmountToWei(amountRaw);
    if (suggested === null) {
      // parseAmountToWei returns null for zero too; a suggested amount
      // of exactly zero means "any amount", which is valid here.
      if (!/^0+(\.0+)?$/.test(amountRaw)) {
        msg.textContent = t("badAmount");
        msg.classList.add("is-error");
        return;
      }
      suggested = 0n;
    }
  }
  if (!guardWallet(msg)) return;
  if (adapterArmed()) {
    // Plain-words ownership check before the sheet, so the common
    // mistakes (unregistered name, someone else's name) read clearly.
    try {
      const owner = await readOwnerOfHandle(handle);
      if (owner === "0x0000000000000000000000000000000000000000") {
        msg.textContent = t("errNameNotRegistered");
        msg.classList.add("is-error");
        return;
      }
      if (owner !== account.toLowerCase()) {
        msg.textContent = t("errNotNameOwner");
        msg.classList.add("is-error");
        return;
      }
    } catch (e) {
      // The sheet's simulation remains the hard gate; a failed
      // pre-check read does not block it.
    }
  }
  msg.textContent = "";
  openActionSheet({
    kind: "create",
    confirmKey: "confirmCreate",
    successKey: "successCreate",
    gasFallback: 300000n,
    rows: [
      [t("rowName"), handle + ".ai"],
      [t("rowItem"), item],
      [t("rowAmount"), suggested > 0n ? formatBnb(suggested) + " " + currencyUnit() : t("anyAmount")],
      [t("rowEffect"), t("createEffect")],
    ],
    tx: {
      to: CONFIG.escrowAddress,
      data: encodeCall(
        "createCard(string,string,uint256)",
        ["string", "string", "uint256"],
        [handle, item, suggested]
      ),
      value: 0n,
    },
    onSuccess: (receipt) => {
      const cardId = eventTopicId(receipt, "CardCreated(uint256,uint256,string,address,string,uint256)", 1);
      if (cardId !== null) {
        msg.textContent = t("cardIssued").replace("{n}", String(cardId));
      }
    },
  });
}

async function onSendSubmit(ev) {
  ev.preventDefault();
  const msg = $("send-msg");
  msg.classList.remove("is-error");
  const cardRaw = $("s-card").value.trim();
  if (!/^\d+$/.test(cardRaw)) {
    msg.textContent = t("badCard");
    msg.classList.add("is-error");
    return;
  }
  const wei = parseAmountToWei($("s-amount").value);
  if (!wei) {
    msg.textContent = t("badAmount");
    msg.classList.add("is-error");
    return;
  }
  if (!guardWallet(msg)) return;
  const cardId = BigInt(cardRaw);
  const deadlineSeconds = BigInt($("s-deadline").value);
  let card = null;
  if (adapterArmed()) {
    // Name and item are read from the contract, never from the link
    // or the form, so a link sender cannot fake them.
    msg.textContent = t("readingCard");
    try {
      card = await readCard(cardId);
    } catch (e) {
      msg.textContent = plainError(e, "errCardNotFound");
      msg.classList.add("is-error");
      return;
    }
    if (!card.active) {
      msg.textContent = t("errCardInactive");
      msg.classList.add("is-error");
      return;
    }
  }
  msg.textContent = "";
  const deadlineAt = BigInt(Math.floor(Date.now() / 1000)) + deadlineSeconds;
  const rows = [
    [t("rowTo"), cardRaw],
    [t("rowAmount"), formatBnb(wei) + " " + currencyUnit()],
    [t("rowDeadline"), formatDateTime(deadlineAt)],
    [t("rowEffect"), t("effectText")],
  ];
  if (card) {
    rows.splice(1, 0, [t("rowName"), card.handle + ".ai"], [t("rowItem"), card.item]);
  }
  openActionSheet({
    kind: "deposit",
    confirmKey: "confirmSend",
    successKey: "successSend",
    gasFallback: 300000n,
    rows,
    tx: {
      to: CONFIG.escrowAddress,
      data: encodeCall("deposit(uint256,uint256)", ["uint256", "uint256"], [cardId, deadlineSeconds]),
      value: wei,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Init.                                                              */
/* ------------------------------------------------------------------ */

document.addEventListener("DOMContentLoaded", async () => {
  applyLang("id");

  $("lang-id").addEventListener("click", () => applyLang("id"));
  $("lang-en").addEventListener("click", () => applyLang("en"));

  $("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("titip-theme", next); } catch (e) { /* private mode */ }
  });

  $("connect-btn").addEventListener("click", connect);
  $("disconnect-btn").addEventListener("click", disconnect);
  $("switch-chain-btn").addEventListener("click", switchChain);

  $("create-form").addEventListener("submit", onCreateSubmit);
  $("send-form").addEventListener("submit", onSendSubmit);

  $("sheet-cancel").addEventListener("click", closeSheet);
  $("sheet-backdrop").addEventListener("click", closeSheet);
  $("sheet-confirm").addEventListener("click", confirmPending);
  document.addEventListener("keydown", onSheetKeydown);

  if (CONFIG.isTestnet) {
    $("contract-line").textContent =
      CONFIG.escrowAddress + " (BSC Testnet, registry tiruan " + CONFIG.agentIdRegistry + ")";
    $("deploy-note").textContent = t("testnetNote");
    const badge = $("network-badge");
    if (badge) badge.hidden = false;
  } else if (CONFIG.escrowAddress) {
    $("contract-line").textContent = CONFIG.escrowAddress;
    $("deploy-note").hidden = true;
  }

  // Silent reconnect: eth_accounts never prompts; it only restores a
  // connection the wallet already authorised. No signature is involved.
  const p = await ensureProvider();
  if (p) {
    try {
      const accs = await p.request({ method: "eth_accounts" });
      if (accs && accs[0]) {
        account = accs[0];
        await refreshChain();
        refreshList();
      }
    } catch (e) { /* stay disconnected */ }
    renderWalletBar();
  }

  // Keep deadline-sensitive buttons honest while the page stays open.
  setInterval(() => {
    if (account && chainOk && !listLoading) refreshList();
  }, 30000);
});
