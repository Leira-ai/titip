# Blueprint Produk: Titip

Fase: fondasi (belum deploy). Tanggal: 19 Nov 2026.
Acuan: riset Agent ID Hackathon, gerbang web-product-engineering (Gate 0 lebih dulu), gerbang arsenal-own-product-security, rel on_chain_safety_rails.

## Gate 0: Design plan (satu paragraf)

Titip adalah halaman pembayaran ke nama `.ai` untuk pemegang Agent ID dan siapa pun yang membayar mereka: penjual kecil, freelancer, dan kreator mempublikasikan satu kartu berisi nama `.ai` mereka, lalu pembeli mengirim BNB ke nama itu lewat escrow yang hanya bisa dicairkan oleh pemilik nama yang terverifikasi kontrak Agent ID, dengan refund otomatis ke pengirim bila tenggat lewat tanpa klaim. Satu tugas utama produk: membuat pengiriman uang ke sebuah nama seaman pengiriman ke alamat yang sudah dicek dua kali, tanpa pengguna pernah menyalin alamat 0x. Elemen yang diingat: kartu pembayaran bernama, satu kartu per nama, yang isinya bukan alamat melainkan kalimat "bayar ke nama ini, yang bisa mengambil hanya pemilik nama ini". Semua elemen lain dibuat tenang: satu halaman, satu kolom aksi, tanpa dasbor dan tanpa grafik.

Pemeriksaan katalog default AI (Gate 0): desain tidak memakai krem hangat plus aksen tanah liat, tidak memakai kartu SaaS seragam, tidak memakai eyebrow huruf kapital di semua judul, dan tidak memakai angka raksasa plus label kecil sebagai hero. Hero Titip adalah formulir kartu itu sendiri, karena nilai produk ada di aksi pertamanya.

## Pekerjaan inti pengguna (Gate 13, ditulis sebelum bangun)

| # | Pekerjaan (kata pengguna) | Anggaran | Uji lulus |
|---|---|---|---|
| 1 | "Saya mau dibayar ke nama .ai saya" (buat kartu) | Maks 3 ketuk dari layar awal, 1 keputusan (nama + barang) | Kartu terbit dan tautannya bisa disalin dalam satu sesi tanpa halaman lain |
| 2 | "Saya mau bayar ke nama ini" (kirim/deposit) | Maks 3 ketuk, nominal dan tenggat terlihat sebelum tanda tangan | Lembar konfirmasi menyebut nama penerima, nominal, tenggat, dan akibat refund dalam kata biasa sebelum wallet diminta |
| 3 | "Uang untuk saya sudah masuk, saya ambil" (klaim) | Maks 2 ketuk dari daftar status | Tombol klaim hanya aktif untuk wallet yang terbukti pemilik nama; status berubah di tempat |
| 4 | "Yang saya kirim tidak diambil, saya tarik kembali" (refund) | Maks 2 ketuk dari daftar status | Tombol refund hanya aktif sesudah tenggat dan hanya untuk pengirim; alasan tampil bila belum waktunya |

## Arsitektur

### Kontrak: `TitipEscrow` (BNB Chain, chainId 56, Solidity 0.8.24+)

Satu kontrak, tanpa token sendiri, tanpa owner, tanpa fungsi admin. Alamat registry Agent ID (`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`) disimpan sebagai `immutable` sejak konstruktor dan tidak bisa diganti. Dana user hanya bisa bergerak oleh dua fungsi: `claim` (ke pemilik nama) dan `refund` (ke pengirim asal), keduanya menjaga status escrow lebih dulu sebelum transfer (checks-effects-interactions) dan dilindungi guard anti-reentrancy yang ditulis tangan dan diaudit baris demi baris.

Entitas:

- `Card`: id, `tokenId` (labelhash nama), `handle` (string nama tanpa `.ai`), `creator` (alamat penerbit, harus sama dengan `ownerOfHandle(handle)` saat terbit), `item` (deskripsi barang/jasa, string pendek), `suggestedAmount` (wei, 0 berarti bebas), `active` (bool; penerbit bisa menonaktifkan kartunya sendiri).
- `Escrow`: id, `cardId`, `tokenId`, `handle`, `sender`, `recipient` (snapshot `ownerOf` saat deposit, hanya untuk tampilan), `amount` (wei), `deadline` (unix time), `status` (Locked, Claimed, Refunded).

Fungsi tulis:

- `createCard(handle, item, suggestedAmount)`: memanggil `ownerOfHandle(handle)` ke registry; revert bila nama tidak terdaftar atau penelepon bukan pemiliknya. Ini gerbang opt-in: tidak ada kartu untuk nama orang lain, tidak ada buku alamat publik.
- `deposit(cardId, deadlineSeconds) payable`: kartu harus aktif; `msg.value > 0`; tenggat antara 1 jam dan 90 hari dari sekarang. Penerima dihitung ulang dari registry pada saat deposit. Mengunci dana dan memancarkan event.
- `claim(escrowId)`: status harus Locked; memanggil `ownerOf(tokenId)` saat itu juga dan mewajibkan sama dengan `msg.sender`. Status diubah ke Claimed sebelum transfer ke `msg.sender`.
- `refund(escrowId)`: status harus Locked; `msg.sender` harus pengirim asal; `block.timestamp` harus melewati `deadline`. Status diubah ke Refunded sebelum transfer kembali ke pengirim.
- `deactivateCard(cardId)`: hanya penerbit kartu; menghentikan deposit baru, tidak menyentuh escrow yang sudah terkunci.

Event (untuk pengindeksan dan kwitansi): `CardCreated`, `CardDeactivated`, `Deposited`, `Claimed`, `Refunded`, semuanya membawa id dan tokenId terindeks, plus handle dan alamat pihak terkait.

### Frontend: satu halaman statis

Satu berkas HTML + CSS + JS vanilla tanpa langkah build di fase fondasi (keputusan dan utang gerbangnya dicatat di BUILD-REPORT: Gate 8 menuntut tumpukan wagmi untuk rilis, kerangka fase ini memakai penyedia injeksi EIP-1193 standar sebagai placeholder yang jujur dan dilabeli sebagai fondasi, bukan rilis). Isi halaman, dari atas ke bawah:

1. Kepala: nama produk "Titip", pengalih bahasa ID/EN, pengalih tema, tombol hubungkan wallet (empat keadaan: belum terhubung, menghubungkan, terhubung dengan alamat dan chain, jaringan salah dengan tombol pindah ke BNB Chain).
2. Kartu "Buat kartu pembayaran": kolom nama `.ai`, barang/jasa, nominal saran; tombol terbit.
3. Kartu "Kirim ke nama": pemilih kartu atau tempel tautan kartu, nominal, pilihan tenggat (1, 3, 7, 30 hari); lembar konfirmasi dalam kata biasa sebelum tanda tangan (Gate 16).
4. Daftar status "Titipan saya": baris per escrow dengan status berlabel ikon plus teks (Terkunci, Terklaim, Kembali), tombol Klaim dan Refund yang aktif hanya bila syaratnya terpenuhi, dan alasan tertulis bila belum bisa.
5. Kaki: alamat kontrak (sesudah deploy), tautan penjelajah, pengungkapan izin owner (lihat bawah), dan satu baris bahwa analitik tidak mencatat alamat wallet.

Bahasa antarmuka ganda Indonesia/Inggris sejak hari pertama; semua kalimat lewat kamus locale, angka dan tanggal lewat `Intl`. Nama produk tetap "Titip" di kedua bahasa dan tidak pernah diterjemahkan. Tema gelap adalah default; tema terang dirancang terpisah, bukan invers. Semua nilai visual dari satu set token CSS (warna semantik, skala spasi 8pt, skala radius, skala huruf rasio 1.25).

### Aliran empat interaksi (ujung ke ujung)

1. Buat kartu: penerima menghubungkan wallet, menulis nama `.ai` miliknya, barang, dan nominal saran, lalu menandatangani `createCard`. Kontrak membuktikan kepemilikan nama lewat registry. Tautan kartu (`?card=<id>`) dibagikan penerima ke mana pun.
2. Kirim: pembeli membuka tautan, melihat nama penerima dan barang (dibaca dari kontrak, bukan dari parameter URL yang bisa dipalsukan), mengisi nominal dan tenggat, membaca lembar konfirmasi, lalu menandatangani `deposit` dengan nilai BNB. Dana terkunci di kontrak.
3. Klaim: penerima membuka daftar status dengan wallet pemilik nama; tombol klaim aktif hanya untuk dia. Menandatangani `claim` adalah sekaligus konfirmasi penerimaan: kontrak memeriksa ulang `ownerOf` dan mengirim dana ke pemilik nama. Tidak ada jalur lain bagi dana itu keluar ke penerima.
4. Konfirmasi/refund: bila tenggat lewat dan dana belum diklaim, pengirim menandatangani `refund` dan dana kembali utuh ke alamat pengirim asal. Status akhir setiap escrow selalu satu dari Terkunci, Terklaim, atau Kembali, dan tercatat sebagai event permanen yang menjadi kwitansi kedua pihak.

### Pengungkapan izin owner (red line hackathon: wajib telanjang)

- Kontrak TitipEscrow: TIDAK ada owner, tidak ada peran admin, tidak ada fungsi pause, mint, pajak, atau penarikan dana user. Tidak ada alamat mana pun, termasuk deployer, yang bisa memindahkan dana escrow selain lewat `claim` oleh pemilik nama penerima atau `refund` oleh pengirim asal sesudah tenggat. Alamat registry Agent ID bersifat immutable.
- Dependensi: registry Agent ID milik SPACE ID adalah kontrak Ownable2Step dengan signer registrasi; Titip hanya memanggil fungsi bacanya (`ownerOf`, `ownerOfHandle`, `handleOf`, `balanceOf`, `isValidHandle`) dan tidak pernah menulis ke registry.

## Batas desain dari riset (dipatuhi)

- Tidak ada login tanda tangan polos (personal_sign tidak didukung Agentic Wallet); semua aksi adalah panggilan kontrak dengan konfirmasi user di wallet-nya sendiri. Tidak ada login QR web Agentic Wallet, tidak ada sesi login yang disimpan server (produk ini tanpa backend dan tanpa server sama sekali di v1).
- Penerima opt-in: kartu hanya bisa diterbitkan pemilik nama; produk tidak menyediakan pencarian nama orang, daftar alamat, atau cara mengintip wallet dari nama.
- Tidak ada janji return, tidak ada bahasa penghasilan pasif, bukan produk trading sehingga tidak wajib peringatan risiko trading (tetap ada satu baris jujur bahwa BNB bernilai fluktuatif di lembar konfirmasi).
- Nama produk "Titip" tidak memakai kata Binance/BNB dan tidak memakai nama Leira.
