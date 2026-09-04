'use client';

// components/admin/Fog/FogGuidance.tsx
//
// "Indikator Kabut — Dasar Teknis", rendered in-app.
//
// SOURCE: docs-konsep-kabut.md at the repository root. The Indonesian prose is
// reproduced verbatim — it is the author's text, and paraphrasing a document
// whose whole purpose is to state the method precisely would defeat it. If the
// markdown changes, change this too; they are the same document in two places.
//
// Two deliberate departures from the source file:
//
//   1. The diagram's colours are the LIVE CHART's tokens (--fog-temp,
//      --fog-dew, --fog-sat-band) rather than the markdown's fixed hexes. An
//      explanatory figure that colours temperature differently from the chart
//      beside it teaches the wrong association.
//   2. Everything else uses theme tokens, so the document is legible in dark
//      mode. The markdown's `currentColor` usages already were.

import { BookOpen, TriangleAlert, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Section({
  n,
  title,
  children,
}: {
  n?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border pt-5">
      <h3 className="mb-2 text-sm font-semibold">
        {n && <span className="mr-2 text-muted-foreground">{n}</span>}
        {title}
      </h3>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
      {children}
    </pre>
  );
}

function Table({
  head,
  rows,
  align,
}: {
  head: string[];
  rows: React.ReactNode[][];
  align?: ('left' | 'right')[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left">
            {head.map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2 font-medium text-foreground ${
                  align?.[i] === 'right' ? 'text-right' : ''
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-3 py-2 align-top ${
                    align?.[j] === 'right' ? 'text-right tabular-nums' : ''
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Night cooling meeting the dew point, then flattening through the fog period.
 *
 * Re-tokenised from the source markdown so temperature and dew point wear the
 * same colours here as on the 24-hour chart.
 */
function CoolingCurve() {
  return (
    <svg
      viewBox="0 0 660 200"
      width="100%"
      role="img"
      aria-label="Suhu turun menemui titik embun lalu mendatar selama periode kabut"
      className="text-foreground"
    >
      <rect
        x="320"
        y="26"
        width="200"
        height="128"
        fill="var(--fog-sat-band)"
        opacity="0.16"
        rx="3"
      />
      <line
        x1="55"
        y1="154"
        x2="625"
        y2="154"
        stroke="currentColor"
        strokeWidth="0.5"
        opacity="0.35"
      />
      <polyline
        fill="none"
        stroke="var(--fog-temp)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points="65,44 135,66 205,92 275,118 320,134 390,140 460,142 520,138 560,96 620,42"
      />
      <polyline
        fill="none"
        stroke="var(--fog-dew)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points="65,146 195,143 320,140 440,142 520,139 620,130"
      />
      <text x="70" y="38" fontSize="11.5" fill="var(--fog-temp)">T</text>
      <text x="70" y="164" fontSize="11.5" fill="var(--fog-dew)">Td</text>
      <text
        x="420"
        y="20"
        fontSize="11.5"
        fontWeight="600"
        fill="currentColor"
        textAnchor="middle"
      >
        kabut
      </text>
      <text x="65" y="180" fontSize="10.5" fill="currentColor" opacity="0.6">18:00</text>
      <text x="340" y="180" fontSize="10.5" fill="currentColor" opacity="0.6" textAnchor="middle">
        00:00
      </text>
      <text x="620" y="180" fontSize="10.5" fill="currentColor" opacity="0.6" textAnchor="end">
        09:00
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export function FogGuidance({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fog-guidance-title"
        className="relative z-50 flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-card shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 id="fog-guidance-title" className="text-base font-semibold">
              Indikator Kabut — Dasar Teknis
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ringkasan metode di balik indikator kabut pada platform.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-6 py-5">
          {/* The scope caveat leads, because everything else is conditional on
              it: this is an inference, not a measurement. */}
          <div className="flex items-start gap-2 rounded-lg border border-[var(--status-warning)]/35 bg-[var(--status-warning)]/10 p-3 text-sm">
            <TriangleAlert
              className="mt-0.5 size-4 shrink-0 text-[var(--status-warning)]"
              aria-hidden
            />
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Ruang lingkup.</span>{' '}
              Kabut didefinisikan secara optik: jarak pandang &lt; 1 km. Stasiun
              tidak punya sensor jarak pandang, jadi sistem ini{' '}
              <strong className="font-medium text-foreground">menyimpulkan</strong>{' '}
              kabut dari kondisi atmosfer penyerta, bukan mengukurnya. Keluarannya
              adalah inferensi dengan ketidakpastian, bukan pengamatan.
            </p>
          </div>

          <Section n="1." title="Variabel utama: Dew Point Depression">
            <Formula>DPD = T − Td        [°C]</Formula>
            <p>
              Jarak pendinginan yang tersisa sebelum udara mengembun. Seluruh
              penilaian bertumpu di sini; DPD &gt; 1,0 °C langsung membatalkan
              skor.
            </p>
            <p>
              <strong className="font-medium text-foreground">
                RH tidak dipakai sebagai variabel terpisah.
              </strong>{' '}
              <code className="rounded bg-muted px-1 text-xs">dewPoint</code>{' '}
              diturunkan dari <code className="rounded bg-muted px-1 text-xs">T</code>{' '}
              dan <code className="rounded bg-muted px-1 text-xs">RH</code> lewat
              Magnus, jadi DPD dan RH membawa informasi yang sama. Ambang DPD juga
              lebih stabil lintas suhu:
            </p>
            <Formula>DPD ≈ 0,17 × (100 − RH)     pada T ≈ 24 °C</Formula>
            <Table
              head={['RH', '95%', '97%', '99%']}
              align={['left', 'right', 'right', 'right']}
              rows={[['DPD @ 24 °C', '0,85', '0,51', '0,17 °C']]}
            />
          </Section>

          <Section n="2." title="Prasyarat fisik kabut radiasi">
            <p>
              Pendinginan radiatif (langit cerah) + pasokan uap (tanah lembap,
              hujan sebelumnya) +{' '}
              <strong className="font-medium text-foreground">
                pengadukan mekanik lemah
              </strong>
              .
            </p>
            <Table
              head={['Angin', 'Akibat', 'Poin']}
              align={['left', 'left', 'right']}
              rows={[
                [
                  '< 2 km/jam',
                  <>
                    pendinginan terkurung di lapisan permukaan →{' '}
                    <strong className="font-medium text-foreground">embun</strong>
                    , bukan kabut
                  </>,
                  '5',
                ],
                [
                  '2–7 km/jam',
                  'pengadukan mendistribusikan pendinginan ke lapisan puluhan meter',
                  '20',
                ],
                ['7–11 km/jam', 'lapisan campur terlalu tebal, kabut menipis', '10'],
                ['> 12 km/jam', 'terangkat menjadi stratus rendah → veto', '0'],
              ]}
            />
            <p className="text-foreground">
              Angin nol memberi skor rendah{' '}
              <strong className="font-medium">secara sengaja</strong>. Ini bukan
              bug.
            </p>
            <p>
              Catatan alat: anemometer mangkuk mulai berputar pada ~2–3 km/jam,
              sehingga pembacaan 0,0 bersifat ambigu.
            </p>
          </Section>

          <Section n="3." title="Tanda waktu">
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <CoolingCurve />
            </div>
            <p>
              <strong className="font-medium text-foreground">Plateau termal.</strong>{' '}
              Laju pendinginan malam 0,8–1,5 °C/jam berhenti hampir seketika saat
              kabut terbentuk — pelepasan panas laten kondensasi ditambah efek
              selimut radiatif lapisan kabut. Kondisi{' '}
              <code className="rounded bg-muted px-1 text-xs">
                |dT/dt| &lt; 0,2 °C/jam
              </code>{' '}
              saat jenuh adalah penanda onset paling andal di malam hari.
            </p>
            <p>
              <strong className="font-medium text-foreground">
                Arah konvergensi menentukan tipe.
              </strong>{' '}
              T turun menuju Td → kabut radiasi. Td naik menuju T → kabut evaporasi
              pasca-hujan. Prasyarat keduanya berbeda.
            </p>
          </Section>

          <Section n="4." title="Konfirmasi optik (Indeks B)">
            <p>
              Proxy jarak pandang terdekat yang tersedia. Posisi matahari dihitung
              dari koordinat stasiun (algoritma NOAA), radiasi langit-cerah dari
              model Haurwitz:
            </p>
            <Formula>
              {'GHI_cerah = 1098 · cos Z · exp(−0,059 / cos Z)      [W/m²]\nkt        = solarradiation / GHI_cerah'}
            </Formula>
            <p>
              Aktif hanya saat elevasi matahari &gt; 8°. Daya pisahnya terletak
              pada pasangan <code className="rounded bg-muted px-1 text-xs">kt</code>{' '}
              × DPD:
            </p>
            <Table
              head={['kt', 'DPD', 'Kesimpulan']}
              rows={[
                [
                  '< 0,25',
                  '< 0,5 °C',
                  <>
                    <strong className="font-medium text-foreground">kabut</strong> —
                    penghalang di permukaan
                  </>,
                ],
                ['< 0,30', '> 2 °C', 'stratus atau mendung — penghalang di ketinggian'],
                ['0,3–0,6', '> 3 °C', 'haze atau asap — partikel kering'],
                ['> 0,4', 'saat jenuh', 'kabut sedang buyar'],
              ]}
            />
            <p>
              Nilai <code className="rounded bg-muted px-1 text-xs">kt</code> &gt;
              1,0 mungkin terjadi karena cloud-edge enhancement; hanya nilai rendah
              yang bermakna di sini.
            </p>
            <p>
              Artefak yang perlu diwaspadai: embun pada kubah pyranometer juga
              menekan <code className="rounded bg-muted px-1 text-xs">kt</code>{' '}
              pasca-fajar, tapi menguap dalam 10–20 menit sementara kabut bertahan.
            </p>
          </Section>

          <Section n="5." title="Indeks A — skor 0–100">
            <p>
              <strong className="font-medium text-foreground">Veto</strong> (skor
              dipaksa 0): sedang hujan · DPD &gt; 1,0 °C · angin &gt; 12 km/jam
            </p>
            <Table
              head={['Komponen', 'Kriteria', 'Bobot', 'Riwayat minimum']}
              align={['left', 'left', 'right', 'left']}
              rows={[
                ['Kejenuhan', 'DPD ≤ 0,3 / 0,8 / 1,5 °C', '30 / 20 / 10', '1 titik'],
                ['Angin', 'band 2–7 km/jam', '20 / 10 / 5', '1 titik'],
                ['Plateau termal', '|dT/dt| < 0,2 / 0,4 °C/jam', '20 / 10', '35 menit'],
                ['Persistensi', 'jenuh ≥ 90 / 60 / 30 menit', '15 / 10 / 5', '90 menit'],
                [
                  'Prasyarat radiatif',
                  <>
                    kt puncak &gt; 0,6{' '}
                    <strong className="font-medium text-foreground">dan</strong>{' '}
                    |Δp/3jam| &lt; 0,5 hPa
                  </>,
                  '10 / 5',
                  '1 siang',
                ],
                ['Reservoir', 'hujan 6–24 jam lalu', '5', '24 jam'],
              ]}
            />
            <p>
              Empat komponen teratas berjumlah 85 poin, sudah di atas ambang vonis.
              Riwayat ~90 menit cukup untuk penilaian penuh; sisanya menaikkan
              keyakinan dari ~85 ke ~95. Di bawah 8 pembacaan sistem menolak
              menilai.
            </p>
          </Section>

          <Section n="6." title="Resolusi vonis">
            <p>Urut prioritas:</p>
            <Table
              head={['#', 'Kondisi', 'Vonis']}
              rows={[
                ['1', 'veto aktif', 'TIDAK ADA KABUT'],
                [
                  '2',
                  'Indeks B: kt < 0,25 dan DPD < 0,5',
                  <>
                    <strong className="font-medium text-foreground">KABUT</strong>{' '}
                    (override)
                  </>,
                ],
                ['3', 'Indeks B: kt < 0,30 dan DPD > 2,0', 'BUKAN KABUT'],
                ['4', 'Indeks A ≥ 70', 'KABUT SANGAT MUNGKIN'],
                [
                  '5',
                  'Indeks A 45–69',
                  'AMBIGU (angin < 2 km/jam → kemungkinan embun)',
                ],
                ['6', 'sisanya', 'TIDAK ADA KABUT'],
              ]}
            />
            <p>
              Transisi status memakai histeresis: dua pembacaan berturut-turut
              harus sepakat sebelum vonis berubah.
            </p>
          </Section>

          <Section n="7." title="Diskriminasi">
            <Table
              head={['Fenomena', 'DPD', 'Angin', 'kt', 'Penanda']}
              rows={[
                ['Kabut radiasi', '≈ 0', '2–7 km/j', '< 0,25', 'plateau termal'],
                ['Embun', '≈ 0', '< 2 km/j', 'normal', 'angin terlalu tenang'],
                ['Haze / asap', '> 3 °C', 'bervariasi', '0,3–0,6', 'udara kering'],
                ['Stratus rendah', '1–3 °C', '> 10 km/j', '< 0,3', 'permukaan belum jenuh'],
                ['Hujan', '≈ 0', 'bervariasi', '< 0,3', 'laju hujan > 0'],
              ]}
            />
            <p>
              Kolom DPD sendirian memisahkan kabut dari asap pembakaran, yang
              secara visual identik.
            </p>
          </Section>

          <Section n="8." title="Keterbatasan">
            <Table
              head={['Sumber', 'Dampak']}
              rows={[
                ['Tidak ada sensor jarak pandang', 'seluruh keluaran bersifat inferensi'],
                [
                  'Ambang dari literatur, belum dikalibrasi lokal',
                  'perlu 2–3 bulan pembanding METAR untuk menyetel ulang',
                ],
                [
                  'Sensor RH ±3–5% justru di ujung atas, terkunci ~99% saat basah',
                  'durasi kabut cenderung dilaporkan berlebih',
                ],
                [
                  'Stasiun publik, metadata pemasangan tidak diketahui',
                  'tinggi sensor, kondisi radiation shield, dan obstruksi anemometer tidak terverifikasi',
                ],
                [
                  'Kabut sangat lokal',
                  'korelasi meluruh cepat terhadap jarak; kabut lembah bisa nihil 200 m di atasnya',
                ],
                [
                  'Riwayat dari polling, bukan arsip stasiun',
                  'jeda polling menghasilkan lubang riwayat; komponen plateau paling terdampak',
                ],
              ]}
            />
            <p className="text-foreground">
              Untuk keputusan operasional yang sensitif terhadap jarak pandang,
              perlakukan keluaran sebagai indikasi awal, bukan pengganti pengamatan
              lapangan.
            </p>
          </Section>

          <Section title="Catatan pemakaian geoteknik">
            <p>
              Data hujan pada platform berasal dari stasiun yang sama dan dapat
              dipakai sebagai{' '}
              <strong className="font-medium text-foreground">
                antecedent rainfall
              </strong>{' '}
              untuk pemantauan stabilitas lereng.
            </p>
            <p>
              Satu hal yang perlu diperhatikan:{' '}
              <code className="rounded bg-muted px-1 text-xs">hourlyrainin</code>{' '}
              dari Ambient adalah{' '}
              <strong className="font-medium text-foreground">laju</strong>{' '}
              (in/jam), bukan akumulasi. Menjumlahkannya sepanjang periode
              menghasilkan angka yang salah besar. Akumulasi per jam diturunkan
              dari selisih{' '}
              <code className="rounded bg-muted px-1 text-xs">dailyrainin</code>,
              dengan penanganan reset tengah malam pada zona waktu stasiun. Nilai
              yang ditampilkan platform sudah memakai metode delta dan dikonversi
              ke mm.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

/** The trigger, so the page never has to know what the modal looks like. */
export function FogGuidanceButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
    >
      <BookOpen className="size-4" aria-hidden />
      Panduan
    </button>
  );
}
