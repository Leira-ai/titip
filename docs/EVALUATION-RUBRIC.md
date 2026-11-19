# Rubrik Evaluasi Titip (pra-rilis)

Disusun 19 Nov 2026, sebelum penilaian dimulai. Rubrik ini adalah alat ukurnya;
produk dinilai dengan rubrik ini, bukan dengan kesan umum. Setiap butir punya
cara uji yang menghasilkan bukti yang bisa diulang (keluaran tes, hash
transaksi, screenshot yang dilihat, atau angka terukur).

## Sumber metode (dibaca 19 Nov 2026)

| Metode | Sumber | Versi/tanggal | Yang dipakai di Titip |
|---|---|---|---|
| Evaluasi heuristik | Nielsen Norman Group, "10 Usability Heuristics for User Interface Design" (nngroup.com) | Heuristik 1994, artikel diperbarui 2024-01-30, tidak berubah sejak 1994 | Sepuluh heuristik sebagai daftar periksa kegunaan per layar |
| Cognitive walkthrough | NN/g, "Evaluate Interface Learnability with Cognitive Walkthroughs"; Wharton dkk. 1994 | Metode 1994 | Empat pertanyaan per langkah pada tiga tugas inti (buat kartu, kirim, klaim) |
| Keamanan web | OWASP Top 10:2025 (owasp.org) | Edisi final Des 2025: A01 Broken Access Control, A02 Security Misconfiguration, A03 Supply Chain Failures, A04 Cryptographic Failures, A05 Injection, A06 Insecure Design, A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Logging and Alerting Failures, A10 Mishandling of Exceptional Conditions | Hanya kategori yang relevan untuk dApp satu halaman tanpa backend: A02, A03, A05, A08, A10; sisanya ditandai tidak berlaku dengan alasan |
| Aksesibilitas | W3C, WCAG 2.2 (W3C Recommendation) | Rekomendasi 5 Okt 2023, versi diperbarui 12 Des 2024; juga ISO/IEC 40500:2025 | Target AA: kontras 1.4.3 (teks 4,5:1, teks besar 3:1), 1.4.11 kontras non-teks 3:1, 2.4.7 fokus terlihat, 2.4.11 fokus tidak tertutup, 2.5.8 target sentuh minimum 24x24 px (patokan produk lebih ketat: 44 px dari Gate 3 web-product-engineering) |
| Performa | Google web.dev, Core Web Vitals; HTTP Archive Web Almanac 2025 | Ambang stabil sejak INP menggantikan FID pada Mar 2024 | LCP <= 2,5 dtk, INP <= 200 ms, CLS <= 0,1; ditambah anggaran berkas Gate 5 web-product-engineering (JS <= 200 KB gzip, CSS <= 30 KB gzip, muatan awal <= 600 KB) |
| Gerbang produk internal | Skill web-product-engineering (Gate 0-17), hackathon-playbook, arsenal-own-product-security, arsenal-web3-audit | Versi workspace 19 Nov 2026 | Gerbang wallet (8), transaksi (9), keamanan (6), keadaan UI (7), dan gerbang keamanan produk sendiri |
| Disiplin bukti temuan | Skill bug-bounty-proof-gate | Versi workspace 19 Nov 2026, termasuk pelonggaran kalibrasi | Temuan tanpa bukti reproduksi bukan temuan; severity harus cocok dengan dampak yang dibuktikan |
| Penilaian juri | Pengumuman resmi Binance, Agent ID Hackathon (dibaca penuh 19 Nov 2026, berkas riset goal) | Periode submisi 18 Nov sampai 9 Des 2026 | Trek Innovation: Kedalaman Aplikasi Agent ID 30%, Kepraktisan dan Kelayakan 25%, Kelengkapan Produk 25%, Inovasi 20%; syarat lantai: produk live dan minimal 30 alamat Agent ID berinteraksi |

Metode yang sengaja dibuang: evaluasi pakar multi-penilai formal (sumber daya
solo), uji pengguna laboratorium (belum ada pengguna; diganti cognitive
walkthrough tertulis), dan checklist dApp generik dari blog (isinya tumpang
tindih dengan Gate 6/8/9 internal yang lebih ketat dan bisa ditelusur).

## Dimensi, bobot, dan cara uji

Skor per dimensi 0 sampai 10. Total adalah rata-rata terbobot. Ambang lulus
pra-rilis: total >= 7,5, tidak ada dimensi di bawah 6, dan tidak ada temuan
Kritis atau Tinggi yang masih terbuka.

### D1. Fungsional dan kebenaran alur uang (bobot 25)

- Suite kontrak yang ada hijau penuh (`npm test`).
- Skenario jahat dan tepi kontrak dibuktikan dengan tes yang jalan: klaim oleh
  bukan pemilik, refund sebelum tenggat, refund tepat pada detik tenggat,
  deposit nilai debu (1 wei), deposit ke kartu nonaktif, klaim pada escrow
  yang penerima sahnya menolak pembayaran, kartu dinonaktifkan tetapi escrow
  lama tetap bisa selesai.
- Codec halaman (Keccak-256 dan ABI tulisan tangan) lolos uji fuzz melawan
  ethers: minimal 1.000 input acak untuk hash dan selector, minimal 500 untuk
  encode/decode termasuk string Unicode dan string di batas 32 byte.
- Alur halaman testnet (buat kartu, deposit, klaim) dibuktikan dari halaman
  sesudah setiap perubahan kode halaman.
- Nama tepi: kosong, sangat panjang, karakter di luar [a-z0-9], nama tidak
  terdaftar; masing-masing berhenti dengan pesan polos, tanpa transaksi.

### D2. Keamanan kontrak (bobot 20)

- Peta peran: tidak ada owner, admin, atau jalur penarikan di luar klaim dan
  refund (diperiksa dari ABI dan tes permukaan).
- Reentrancy empat bentuk (satu fungsi, lintas fungsi, lintas kontrak,
  read-only) diperiksa; pembayaran keluar mengikuti cek-efek-interaksi dan
  kunci reentrancy.
- Aritmetika dan batas: tenggat minimum dan maksimum persis di batas dan satu
  detik di luarnya; jumlah nol dan debu; indeks di luar jangkauan.
- Invariant tertulis BLUEPRINT: dana hanya keluar lewat dua pintu; registry
  immutable; kepemilikan nama diperiksa ulang pada saat klaim, bukan dari
  snapshot deposit.

### D3. Keamanan frontend dan web (bobot 15)

- OWASP A05 Injection: semua data rantai dan input pengguna dirender sebagai
  teks; dibuktikan dengan muatan HTML/skrip pada nama barang dan nama kartu
  lewat provider tiruan, nol eksekusi, nol elemen asing tercipta.
- OWASP A02 Misconfiguration: CSP terpasang dan konsisten dengan asal yang
  benar-benar dipakai; hash skrip inline cocok; tidak ada kebijakan yang
  membuka wildcard.
- OWASP A08 Integrity: tautan penjelajah dibangun hanya dari basis konfigurasi
  dan hash transaksi; tidak ada URL yang disusun dari input pengguna mentah.
- OWASP A10 Exceptional Conditions: penolakan pengguna (kode 4001), chain
  salah, RPC lambat atau mati, receipt tidak kunjung final, ganti akun dan
  ganti chain di tengah lembar konfirmasi, klik ganda pada tombol kirim;
  masing-masing berakhir pada keadaan berlabel, bukan sukses palsu dan bukan
  pengiriman ganda.
- OWASP A03 Supply Chain: halaman produksi nol dependensi runtime; versi
  perangkat uji terpin persis dan lockfile ada.

### D4. Kegunaan (bobot 15)

- Sepuluh heuristik Nielsen dinilai per layar utama (hero, buat kartu, kirim,
  daftar, lembar konfirmasi) dengan catatan lulus atau temuan per heuristik.
- Cognitive walkthrough: tiga tugas inti, empat pertanyaan per langkah
  (mencoba efek yang benar, menyadari aksi tersedia, mengaitkan aksi dengan
  efek, melihat kemajuan). Setiap jawaban "tidak" menjadi temuan.
- Kejelasan biaya: lembar konfirmasi menampilkan nominal, perkiraan biaya
  jaringan, dan total dalam format yang terbaca manusia (maksimal 6 angka
  desimal untuk biaya hasil estimasi), tanpa mengubah nilai transaksi
  sebenarnya.
- Keadaan UI lima macam (memuat, kosong, galat, basi, sebagian) hadir pada
  permukaan daftar.

### D5. Aksesibilitas WCAG 2.2 AA (bobot 10)

- Kontras dihitung dari token CSS dengan skrip untuk kedua tema: teks biasa
  >= 4,5:1, teks besar >= 3:1, batas UI dan indikator fokus >= 3:1.
- Target sentuh terukur dari render: target utama >= 44x44 px (Gate 3),
  tidak ada target di bawah 24x24 px (WCAG 2.5.8 AA).
- Fokus keyboard: urutan tab logis, fokus terlihat (gaya :focus-visible ada
  dan kontras), fokus tidak tertutup elemen lengket (2.4.11).
- Semantik: landmark, satu h1, label formulir terhubung, wilayah aria-live
  pada pesan hasil, dialog lembar berlabel.

### D6. Performa (bobot 10)

- Berat berkas terukur: byte mentah dan gzip untuk index.html, styles.css,
  app.js; dibandingkan dengan anggaran Gate 5.
- Waktu muat lokal terukur (server lokal, Chromium headless): domContentLoaded
  dan load untuk halaman testnet; dicatat sebagai angka lab, bukan klaim
  lapangan.
- Biaya baca daftar: jumlah panggilan RPC untuk memuat daftar titipan pada
  keadaan testnet saat ini, dan apakah polanya sekuensial atau berkonkurensi
  terbatas (Gate 9: konkurensi terbatas sekitar 3).

### D7. Kesiapan juri dan rilis (bobot 5)

- Peta skor Innovation diisi dengan bukti, bukan klaim: kedalaman Agent ID,
  kepraktisan, kelengkapan, inovasi.
- Syarat lantai dicatat apa adanya: jumlah alamat Agent ID yang sudah
  berinteraksi di testnet dan status mainnet.
- Gerbang pra-rilis internal yang belum lulus disebut dengan nomornya.

## Skala severity temuan

- Kritis: dana bisa hilang, terkunci permanen, atau berpindah ke pihak salah
  pada jalur yang realistis.
- Tinggi: alur inti rusak untuk pengguna sah, atau perlindungan yang dijanjikan
  produk tidak bekerja.
- Sedang: kerugian terbatas, kebingungan yang bisa berujung kesalahan
  pengguna, atau pelanggaran gerbang yang tidak menyentuh dana.
- Rendah: kosmetik, utang teknis tercatat, atau penyimpangan dokumen.

Setiap temuan wajib memuat: langkah reproduksi, hasil yang diharapkan, hasil
nyata, dan bukti (keluaran tes, hash, atau screenshot). Temuan yang tidak bisa
direproduksi diturunkan menjadi catatan, bukan temuan.
