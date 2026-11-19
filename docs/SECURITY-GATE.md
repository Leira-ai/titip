# Hasil Gerbang Keamanan Produk Sendiri (arsenal-own-product-security)

Produk: Titip, fase fondasi (belum deploy). Tanggal penilaian: 19 Nov 2026.
Format per skill: tiap butir ditandai Lulus, Gagal, atau Tidak Berlaku, beserta buktinya. Butir yang gagal atau tertunda menjadi daftar perbaikan sebelum rilis, bukan catatan kaki.

## Autentikasi dan sesi

Titip tidak memiliki akun, kata sandi, sesi server, atau backend sama sekali. Identitas adalah wallet pengguna sendiri; setiap aksi adalah panggilan kontrak yang dikonfirmasi pengguna di wallet-nya.

| Butir | Status | Bukti |
|---|---|---|
| Hashing kata sandi kuat | Tidak Berlaku | Tidak ada kata sandi di produk |
| Saring kata sandi bocor (k-anonymity) | Tidak Berlaku | Sama seperti di atas |
| Tolak kata sandi kontekstual | Tidak Berlaku | Sama seperti di atas |
| Rate limit login dan pemulihan | Tidak Berlaku | Tidak ada endpoint login; aksi on-chain dibatasi biaya gas oleh rantai |
| Lockout aman | Tidak Berlaku | Tidak ada mekanisme login |
| MFA untuk admin | Tidak Berlaku, dengan catatan | Tidak ada peran admin di kontrak maupun produk; tidak ada yang bisa diberi MFA |
| Sesi berakhir saat logout/pergantian | Tidak Berlaku | Tidak ada sesi server; pemutusan wallet bersifat lokal di frontend |
| Token sesi tidak di URL/log/error | Lulus | Frontend tidak menyimpan token apa pun; tidak ada localStorage selain preferensi tema dan bahasa |
| Error tidak membocorkan keberadaan akun | Lulus | Pesan error frontend generik (nama tidak valid, nominal tidak valid, jaringan salah); tidak ada konsep akun terdaftar |

## Manajemen secret

| Butir | Status | Bukti |
|---|---|---|
| Tidak ada secret di kode, riwayat, artefak, contoh konfigurasi | Lulus | Pemindaian pola (private key, mnemonic, seed phrase, blok PEM, hex 64) pada berkas sumber `contracts/ web/ docs/ test/ package.json` tanggal 19 Nov 2026: bersih. Artefak di `build/` adalah bytecode hasil kompilasi, bukan kredensial |
| Secret di penyimpanan aman | Tidak Berlaku fase ini | Produk tidak memegang secret apa pun. Aturan fase deploy: kunci deployer tidak pernah masuk repo dan tidak pernah dibaca ke chat (rel on_chain_safety_rails) |
| Kredensial per layanan | Tidak Berlaku | Tidak ada layanan |
| Prosedur rotasi dan pencabutan terdokumentasi dan teruji | Lulus sebagian | Kontrak tidak punya kunci admin sehingga tidak ada yang dirotasi; alamat registry immutable didokumentasikan di BLUEPRINT. Pencabutan sesi wallet adalah wewenang pengguna di wallet-nya |
| Log dan error melewati redaksi | Lulus | Frontend tidak menulis log berisi data pengguna; kontrak hanya memancarkan event berisi id, nama publik, dan alamat publik yang memang tercatat on-chain |
| Penilaian eksposur secret sebelum rilis | Lulus untuk fase fondasi | Pemindaian di atas; wajib diulang pada artefak rilis di fase deploy |

## CI dan dependensi

| Butir | Status | Bukti |
|---|---|---|
| CI tidak menjalankan kode tak tepercaya dengan secret rilis | Tertunda | Belum ada pipeline CI di fase fondasi; dicatat sebagai pekerjaan fase rilis |
| Dependensi dipin persis dan lockfile terkomit | Lulus | `package.json` memakai versi persis (solc 0.8.30, ethers 6.15.0, ganache 7.9.2) dan `package-lock.json` ada (163.297 byte). Frontend produksi direncanakan tanpa dependensi runtime sama sekali (vanilla), jadi permukaan rantai pasok rilis adalah nol paket |
| Token CI hak minimum | Tertunda | Sama seperti butir CI pertama |
| Pemindaian kerentanan dependensi di pipeline | Gagal di lingkungan ini, dicatat jujur | `npm audit` tidak bisa berjalan di mesin ini (endpoint audit registry ditolak kebijakan lingkungan, dicoba 19 Nov 2026). Mitigasi fase ini: dependensi hanya perangkat uji lokal, tidak ikut terdistribusi; pemindaian wajib dicari jalurnya di fase rilis |
| Artefak bisa ditelusuri ke sumber | Lulus sebagian | `build/*.json` dihasilkan deterministik dari `contracts/` oleh `test/run-tests.js`; repo git untuk proyek ini belum diinisialisasi, dicatat sebagai pekerjaan tersisa |

## Rate limit dan logging

| Butir | Status | Bukti |
|---|---|---|
| Batas laju endpoint sensitif | Tidak Berlaku | Tidak ada server; batas laju inheren dari biaya transaksi rantai |
| Peristiwa keamanan tercatat | Lulus (padanan on-chain) | Setiap gerakan dana dan penerbitan kartu adalah event kontrak permanen: CardCreated, CardDeactivated, Deposited, Claimed, Refunded |
| Log bebas kata sandi, token, secret, data pribadi berlebih | Lulus | Event hanya memuat data yang memang publik on-chain; frontend tidak mencatat alamat untuk analitik (tertulis di kaki halaman) |
| Cara menindaklanjuti anomali | Lulus sebagian | Event bisa diindeks dari penjelajah blok; dasbor pemantauan belum dibangun (fase pertumbuhan) |
| Batas ukuran dan rotasi log | Tidak Berlaku | Tidak ada log server |

## Pencadangan

| Butir | Status | Bukti |
|---|---|---|
| Cadangan otomatis terjadwal | Lulus sebagian | Satu-satunya keadaan produk adalah keadaan on-chain (tahan lama oleh rantai) dan kode sumber di workspace; tidak ada basis data produk |
| Pemulihan pernah diuji | Tertunda | Tidak ada data untuk dipulihkan di fase ini; uji pemulihan berlaku nanti bila ada backend |
| Cadangan terenkripsi dan akses terbatas | Tidak Berlaku fase ini | Tidak ada cadangan berisi data sensitif |
| Retensi diatur | Tidak Berlaku fase ini | Sama seperti di atas |
| Kredensial cadangan terpisah | Tidak Berlaku fase ini | Sama seperti di atas |

## Uji regresi ketahanan instruksi tersembunyi (produk AI dan agen)

Titip bukan produk AI dan tidak menjalankan agen. Status: Tidak Berlaku untuk kode produk. Satu catatan maju yang dicatat untuk fase distribusi: ekosistem Agent ID membaca berkas instruksi agen (`agent.md`/`llms.txt`); bila Titip menerbitkan berkas semacam itu di fase pertumbuhan, isinya hanya boleh berisi alur produk sendiri, dan produk tidak pernah memperlakukan konten eksternal (nama kartu, deskripsi barang dari pihak lain) sebagai perintah. Deskripsi barang dari pengguna lain dirender sebagai teks yang diescape, tidak pernah sebagai HTML mentah (lihat gerbang frontend di BUILD-REPORT).

## Pemeriksaan khusus kontrak (di luar checklist umum, dari cakupan tugas)

| Butir | Status | Bukti |
|---|---|---|
| Klaim hanya oleh pemilik nama terverifikasi registry | Lulus | Uji otomatis: klaim oleh pengirim dan oleh pihak ketiga revert; klaim oleh pemilik nama membayar persis nominal |
| Refund hanya sesudah tenggat, hanya oleh pengirim asal | Lulus | Uji otomatis: refund sebelum tenggat revert, refund oleh bukan pengirim revert, refund sesudah tenggat mengembalikan persis nominal |
| Klaim ganda dan refund ganda mustahil | Lulus | Uji otomatis: klaim kedua, refund sesudah klaim, refund kedua, dan klaim sesudah refund semuanya revert |
| Tahan reentrancy pada pembayaran keluar | Lulus | Uji otomatis dengan kontrak penyerang: percobaan klaim ulang dari hook pembayaran terdeteksi berjalan, dana tetap terbayar tepat satu kali |
| Tidak ada jalur penarikan dana oleh owner/deployer | Lulus | Kontrak tidak memiliki owner maupun fungsi withdraw/sweep/pause; uji otomatis memeriksa permukaan ABI |
| Registry tidak bisa diganti | Lulus | Alamat registry `immutable`, ditetapkan di konstruktor |

## Kesimpulan gerbang fase fondasi

Tidak ada butir wajib yang gagal di lingkup fase ini. Tiga hal tertunda dan wajib ditutup sebelum rilis: pipeline CI, jalur pemindaian kerentanan dependensi, dan inisialisasi repo git proyek. Ketiganya tercatat di BUILD-REPORT sebagai pekerjaan tersisa, bukan dilupakan.
