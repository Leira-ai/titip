# Kontrak Agent ID: ABI Terverifikasi (Sourcify, 19 Nov 2026)

Kontrak: `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`, BNB Chain (chainId 56).
Sumber: Sourcify full match, `https://sourcify.dev/server/v2/contract/56/0x60b9262456de011f7d15a54cdd8c48baaa8b022f?fields=abi,metadata`, diambil 19 Nov 2026.
Kompiler asal kontrak: Solidity 0.8.24+commit.e11b9ed9.
Nama kontrak terverifikasi: SPACE ID Agent ID, simbol `AI`, ERC-721 soulbound (ada error khusus `Soulbound`).

## Fungsi yang dipakai Titip (persis dari ABI)

| Fungsi | Tanda tangan | Mutabilitas | Dipakai untuk |
|---|---|---|---|
| `ownerOfHandle` | `ownerOfHandle(string handle) returns (address)` | view | Resolusi maju nama ke alamat di dalam kontrak escrow: kartu hanya bisa diterbitkan pemilik nama, deposit memverifikasi penerima. |
| `ownerOf` | `ownerOf(uint256 tokenId) returns (address)` | view | Verifikasi klaim: hanya `ownerOf(tokenId) == msg.sender` yang boleh klaim. tokenId = `uint256(keccak256(bytes(label)))`. |
| `handleOf` | `handleOf(address) returns (string)` | view | Resolusi balik alamat ke nama untuk kwitansi dan tampilan frontend. |
| `balanceOf` | `balanceOf(address) returns (uint256)` | view | Cek pemegang Agent ID (gerbang lunak dan statistik interaksi). |
| `isValidHandle` | `isValidHandle(string) returns (bool)` | view | Validasi format nama di frontend sebelum transaksi. |

## Permukaan lengkap kontrak (dari ABI terverifikasi)

Baca: `balanceOf`, `ownerOf`, `ownerOfHandle`, `handleOf`, `getApproved`, `isApprovedForAll`, `name`, `symbol`, `tokenURI`, `baseURI`, `uriSuffix`, `supportsInterface`, `eip712Domain`, `owner`, `pendingOwner`, `signer`, `minLen`, `maxLen`, `LEN_CEILING`, `isValidHandle`.
Tulis: `register(handle, deadline, sig)` (registrasi bergate tanda tangan EIP-712 dari signer resmi, bukan jalur dApp), `adminRegister(handle, to)` (admin), `approve` dan `setApprovalForAll` (keduanya `pure` di ABI, konsisten dengan soulbound: jalur approval dinonaktifkan), `transferFrom` dan `safeTransferFrom` (ada di ABI tetapi kontrak melempar error `Soulbound` untuk transfer), fungsi admin pemilik kontrak: `setSigner`, `setLengthBounds`, `setURIParts`, `transferOwnership`, `acceptOwnership`, `renounceOwnership` (Ownable2Step, pemiliknya SPACE ID).
Event: `Registered(labelhash, owner, handle)`, `AdminRegistered`, `Transfer`, `Approval`, `ApprovalForAll`, `SignerChanged`, `LengthBoundsChanged`, `URIPartsChanged`, `OwnershipTransferred`, `OwnershipTransferStarted`, `EIP712DomainChanged`.
Error penting: `Soulbound`, `HandleTaken`, `AddressHasHandle`, `InvalidHandle`, `BadSignature`, `SignatureExpired`, rangkaian error standar OpenZeppelin ERC-721.

## Koreksi terhadap berkas riset (penting)

Permukaan fungsi di berkas riset disusun dari dekompilasi dan terbukti sebagian keliru. ABI terverifikasi menunjukkan:

1. Kontrak ini BUKAN ERC-721Enumerable: tidak ada `totalSupply`, `tokenByIndex`, atau `tokenOfOwnerByIndex`.
2. Tidak ada fungsi `mint(...)` bertanda tangan tuple dan tidak ada `burn`, `fees`, `getFeeBps`, `contractURI`, atau `tokenURIPrefix`. Registrasi bernama `register(handle, deadline, sig)`; URI diatur lewat `baseURI` dan `uriSuffix`.
3. Resolusi dua arah justru tersedia on-chain dan tidak tercatat di riset: `ownerOfHandle(string)` (nama ke alamat) dan `handleOf(address)` (alamat ke nama). Konsekuensinya, Titip tidak butuh indexer atau backend pihak ketiga untuk resolusi nama; seluruh verifikasi kepemilikan bisa murni panggilan kontrak.
4. Batas panjang nama bisa dibaca dari kontrak: `minLen()`, `maxLen()`, `LEN_CEILING()` (nilai persisnya dibaca saat fase integrasi live; klaim materi resmi 3 sampai 15 karakter belum dicocokkan on-chain di fase ini).

## Batas yang tetap berlaku

- `ownerOf` melempar `ERC721NonexistentToken` untuk tokenId yang belum terdaftar; `ownerOfHandle` untuk nama yang belum terdaftar belum diuji langsung di fase ini (kontrak escrow memperlakukan hasil nol atau revert sebagai "nama tidak ditemukan" dan membatalkan transaksi).
- Kepemilikan tidak bisa berpindah (soulbound), jadi pemilik nama saat deposit dan saat klaim secara praktis adalah alamat yang sama; kontrak Titip tetap memeriksa ulang `ownerOf` pada saat klaim sebagai pertahanan berlapis.
