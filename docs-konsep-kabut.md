# Indikator Kabut — Dasar Teknis

Ringkasan metode di balik indikator kabut pada platform.

> Dokumen ini juga tampil di dalam aplikasi, lewat tombol **Panduan** pada tab
> FOG MONITOR (`components/admin/Fog/FogGuidance.tsx`). Keduanya adalah dokumen
> yang sama di dua tempat — bila salah satu diubah, ubah yang lain. Pernyataan
> yang menopang metode dijaga oleh `__tests__/fog-ui.test.tsx`, yang menuntut
> setiap kalimat kunci hadir di kedua berkas.

---

## Ruang lingkup

Kabut didefinisikan secara optik: jarak pandang < 1 km. Stasiun tidak punya sensor jarak pandang, jadi sistem ini **menyimpulkan** kabut dari kondisi atmosfer penyerta, bukan mengukurnya. Keluarannya adalah inferensi dengan ketidakpastian, bukan pengamatan.

---

## 1. Variabel utama: Dew Point Depression

```
DPD = T − Td        [°C]
```

Jarak pendinginan yang tersisa sebelum udara mengembun. Seluruh penilaian bertumpu di sini; DPD > 1,0 °C langsung membatalkan skor.

**RH tidak dipakai sebagai variabel terpisah.** `dewPoint` diturunkan dari `T` dan `RH` lewat Magnus, jadi DPD dan RH membawa informasi yang sama. Ambang DPD juga lebih stabil lintas suhu:

```
DPD ≈ 0,17 × (100 − RH)     pada T ≈ 24 °C
```

| RH | 95% | 97% | 99% |
|---|---|---|---|
| DPD @ 24 °C | 0,85 | 0,51 | 0,17 °C |

---

## 2. Prasyarat fisik kabut radiasi

Pendinginan radiatif (langit cerah) + pasokan uap (tanah lembap, hujan sebelumnya) + **pengadukan mekanik lemah**.

| Angin | Akibat | Poin |
|---|---|---|
| < 2 km/jam | pendinginan terkurung di lapisan permukaan → **embun**, bukan kabut | 5 |
| 2–7 km/jam | pengadukan mendistribusikan pendinginan ke lapisan puluhan meter | 20 |
| 7–11 km/jam | lapisan campur terlalu tebal, kabut menipis | 10 |
| > 12 km/jam | terangkat menjadi stratus rendah → veto | 0 |

Angin nol memberi skor rendah **secara sengaja**. Ini bukan bug.

Catatan alat: anemometer mangkuk mulai berputar pada ~2–3 km/jam, sehingga pembacaan 0,0 bersifat ambigu.

---

## 3. Tanda waktu

<svg viewBox="0 0 660 200" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Suhu turun menemui titik embun lalu mendatar selama periode kabut">
  <rect x="320" y="26" width="200" height="128" fill="#5BC8B0" opacity="0.12" rx="3"/>
  <line x1="55" y1="154" x2="625" y2="154" stroke="currentColor" stroke-width="0.5" opacity="0.35"/>
  <polyline fill="none" stroke="#E8895F" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
    points="65,44 135,66 205,92 275,118 320,134 390,140 460,142 520,138 560,96 620,42"/>
  <polyline fill="none" stroke="#5B9BD5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
    points="65,146 195,143 320,140 440,142 520,139 620,130"/>
  <text x="70" y="38" font-size="11.5" fill="#E8895F">T</text>
  <text x="70" y="164" font-size="11.5" fill="#5B9BD5">Td</text>
  <text x="420" y="20" font-size="11.5" font-weight="600" fill="currentColor" text-anchor="middle">kabut</text>
  <text x="65" y="180" font-size="10.5" fill="currentColor" opacity="0.6">18:00</text>
  <text x="340" y="180" font-size="10.5" fill="currentColor" opacity="0.6" text-anchor="middle">00:00</text>
  <text x="620" y="180" font-size="10.5" fill="currentColor" opacity="0.6" text-anchor="end">09:00</text>
</svg>

**Plateau termal.** Laju pendinginan malam 0,8–1,5 °C/jam berhenti hampir seketika saat kabut terbentuk — pelepasan panas laten kondensasi ditambah efek selimut radiatif lapisan kabut. Kondisi `|dT/dt| < 0,2 °C/jam` saat jenuh adalah penanda onset paling andal di malam hari.

**Arah konvergensi menentukan tipe.** T turun menuju Td → kabut radiasi. Td naik menuju T → kabut evaporasi pasca-hujan. Prasyarat keduanya berbeda.

---

## 4. Konfirmasi optik (Indeks B)

Proxy jarak pandang terdekat yang tersedia. Posisi matahari dihitung dari koordinat stasiun (algoritma NOAA), radiasi langit-cerah dari model Haurwitz:

```
GHI_cerah = 1098 · cos Z · exp(−0,059 / cos Z)      [W/m²]
kt        = solarradiation / GHI_cerah
```

Aktif hanya saat elevasi matahari > 8°. Daya pisahnya terletak pada pasangan `kt` × DPD:

| kt | DPD | Kesimpulan |
|---|---|---|
| < 0,25 | < 0,5 °C | **kabut** — penghalang di permukaan |
| < 0,30 | > 2 °C | stratus atau mendung — penghalang di ketinggian |
| 0,3–0,6 | > 3 °C | haze atau asap — partikel kering |
| > 0,4 | saat jenuh | kabut sedang buyar |

Nilai `kt` > 1,0 mungkin terjadi karena cloud-edge enhancement; hanya nilai rendah yang bermakna di sini.

Artefak yang perlu diwaspadai: embun pada kubah pyranometer juga menekan `kt` pasca-fajar, tapi menguap dalam 10–20 menit sementara kabut bertahan.

---

## 5. Indeks A — skor 0–100

**Veto** (skor dipaksa 0): sedang hujan · DPD > 1,0 °C · angin > 12 km/jam

| Komponen | Kriteria | Bobot | Riwayat minimum |
|---|---|---|---|
| Kejenuhan | DPD ≤ 0,3 / 0,8 / 1,5 °C | 30 / 20 / 10 | 1 titik |
| Angin | band 2–7 km/jam | 20 / 10 / 5 | 1 titik |
| Plateau termal | \|dT/dt\| < 0,2 / 0,4 °C/jam | 20 / 10 | 35 menit |
| Persistensi | jenuh ≥ 90 / 60 / 30 menit | 15 / 10 / 5 | 90 menit |
| Prasyarat radiatif | kt puncak > 0,6 **dan** \|Δp/3jam\| < 0,5 hPa | 10 / 5 | 1 siang |
| Reservoir | hujan 6–24 jam lalu | 5 | 24 jam |

Empat komponen teratas berjumlah 85 poin, sudah di atas ambang vonis. Riwayat ~90 menit cukup untuk penilaian penuh; sisanya menaikkan keyakinan dari ~85 ke ~95. Di bawah 8 pembacaan sistem menolak menilai.

---

## 6. Resolusi vonis

Urut prioritas:

| # | Kondisi | Vonis |
|---|---|---|
| 1 | veto aktif | TIDAK ADA KABUT |
| 2 | Indeks B: kt < 0,25 dan DPD < 0,5 | **KABUT** (override) |
| 3 | Indeks B: kt < 0,30 dan DPD > 2,0 | BUKAN KABUT |
| 4 | Indeks A ≥ 70 | KABUT SANGAT MUNGKIN |
| 5 | Indeks A 45–69 | AMBIGU (angin < 2 km/jam → kemungkinan embun) |
| 6 | sisanya | TIDAK ADA KABUT |

Transisi status memakai histeresis: dua pembacaan berturut-turut harus sepakat sebelum vonis berubah.

---

## 7. Diskriminasi

| Fenomena | DPD | Angin | kt | Penanda |
|---|---|---|---|---|
| Kabut radiasi | ≈ 0 | 2–7 km/j | < 0,25 | plateau termal |
| Embun | ≈ 0 | < 2 km/j | normal | angin terlalu tenang |
| Haze / asap | > 3 °C | bervariasi | 0,3–0,6 | udara kering |
| Stratus rendah | 1–3 °C | > 10 km/j | < 0,3 | permukaan belum jenuh |
| Hujan | ≈ 0 | bervariasi | < 0,3 | laju hujan > 0 |

Kolom DPD sendirian memisahkan kabut dari asap pembakaran, yang secara visual identik.

---

## 8. Keterbatasan

| Sumber | Dampak |
|---|---|
| Tidak ada sensor jarak pandang | seluruh keluaran bersifat inferensi |
| Ambang dari literatur, belum dikalibrasi lokal | perlu 2–3 bulan pembanding METAR untuk menyetel ulang |
| Sensor RH ±3–5% justru di ujung atas, terkunci ~99% saat basah | durasi kabut cenderung dilaporkan berlebih |
| Stasiun publik, metadata pemasangan tidak diketahui | tinggi sensor, kondisi radiation shield, dan obstruksi anemometer tidak terverifikasi |
| Kabut sangat lokal | korelasi meluruh cepat terhadap jarak; kabut lembah bisa nihil 200 m di atasnya |
| Riwayat dari polling, bukan arsip stasiun | jeda polling menghasilkan lubang riwayat; komponen plateau paling terdampak |

Untuk keputusan operasional yang sensitif terhadap jarak pandang, perlakukan keluaran sebagai indikasi awal, bukan pengganti pengamatan lapangan.

---

## Catatan pemakaian geoteknik

Data hujan pada platform berasal dari stasiun yang sama dan dapat dipakai sebagai **antecedent rainfall** untuk pemantauan stabilitas lereng.

Satu hal yang perlu diperhatikan: `hourlyrainin` dari Ambient adalah **laju** (in/jam), bukan akumulasi. Menjumlahkannya sepanjang periode menghasilkan angka yang salah besar. Akumulasi per jam diturunkan dari selisih `dailyrainin`, dengan penanganan reset tengah malam pada zona waktu stasiun. Nilai yang ditampilkan platform sudah memakai metode delta dan dikonversi ke mm.
