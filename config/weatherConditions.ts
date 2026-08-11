// config/weatherConditions.ts
//
// Sky condition (Kondisi Cuaca) and rainfall wording for the reports.
//
// TWO DIFFERENT KINDS OF NUMBER LIVE HERE, and they should not be confused:
//
//   * The RAIN classes are BMKG's published daily-rainfall bands. They are a
//     national standard, not our invention, and should not be tuned.
//
//   * The CLEARNESS bands (kt -> Cerah / Berawan / …) are literature defaults,
//     exactly like config/fogConstants.ts. Nobody has calibrated them against
//     an observer at this site. Expect them to move once someone compares a
//     week of output against what the crew actually saw.
//
// Everything is in one object so a recalibration is an edit here and nowhere
// else.

export type ReportLocale = 'en' | 'id';

export type SkyCode =
  | 'CERAH'
  | 'CERAH_BERAWAN'
  | 'BERAWAN'
  | 'BERAWAN_TEBAL'
  | 'HUJAN_RINGAN'
  | 'HUJAN_SEDANG'
  | 'HUJAN_LEBAT'
  | 'HUJAN_SANGAT_LEBAT'
  | 'TIDAK_DIKETAHUI';

export interface WeatherConstants {
  readonly version: string;

  /**
   * Solar elevation above which the clearness index is worth reading, degrees.
   *
   * Below this the clear-sky denominator collapses and kt turns to noise, so a
   * dawn sample would otherwise drag a bright day towards "Berawan Tebal".
   * Higher than the fog index's 8° gate: Index B only needs kt to be
   * *meaningful*, whereas a daily average needs it to be *representative*.
   */
  readonly ktElevationMinDeg: number;

  /** Minimum daytime samples before a sky condition is claimed at all. */
  readonly minDaytimeSamples: number;

  /**
   * Mean daytime kt -> sky cover. Evaluated in order; first match wins.
   * UNCALIBRATED — see the header.
   */
  readonly skyTiers: readonly { readonly minKt: number; readonly code: SkyCode }[];

  /**
   * Mean DAILY rainfall (mm) -> rain class. BMKG bands.
   * Evaluated in order; first match wins. A period below the lightest
   * threshold is not raining, and the sky tiers decide instead.
   */
  readonly rainTiers: readonly { readonly minMmPerDay: number; readonly code: SkyCode }[];

  /**
   * Range length at or below which rainfall is summarised per HOUR rather than
   * per DAY, in hours.
   *
   * A one-day report says "rata-rata 5 mm/jam, maksimum 10 mm pada pukul
   * 17:00"; a seven-day report says "rata-rata 6 mm/hari, maksimum 10 mm pada
   * tanggal 10 Agustus 2026". 48 hours rather than 24 so a report whose window
   * runs slightly over a day does not flip basis unexpectedly.
   */
  readonly hourlyBasisMaxHours: number;

  /** Below this an hour or a day counts as dry, mm. Matches the fog rain gate. */
  readonly wetThresholdMm: number;
}

export const WEATHER_CONSTANTS: WeatherConstants = {
  version: '1',

  ktElevationMinDeg: 15,
  minDaytimeSamples: 6,

  skyTiers: [
    { minKt: 0.65, code: 'CERAH' },
    { minKt: 0.5, code: 'CERAH_BERAWAN' },
    { minKt: 0.35, code: 'BERAWAN' },
    { minKt: 0, code: 'BERAWAN_TEBAL' },
  ],

  // BMKG: 0,5–20 ringan · 20–50 sedang · 50–100 lebat · >100 sangat lebat
  rainTiers: [
    { minMmPerDay: 100, code: 'HUJAN_SANGAT_LEBAT' },
    { minMmPerDay: 50, code: 'HUJAN_LEBAT' },
    { minMmPerDay: 20, code: 'HUJAN_SEDANG' },
    { minMmPerDay: 0.5, code: 'HUJAN_RINGAN' },
  ],

  hourlyBasisMaxHours: 48,
  wetThresholdMm: 0.2,
};

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

export const SKY_LABEL: Record<ReportLocale, Record<SkyCode, string>> = {
  id: {
    CERAH: 'Cerah',
    CERAH_BERAWAN: 'Cerah Berawan',
    BERAWAN: 'Berawan',
    BERAWAN_TEBAL: 'Berawan Tebal',
    HUJAN_RINGAN: 'Hujan Ringan',
    HUJAN_SEDANG: 'Hujan Sedang',
    HUJAN_LEBAT: 'Hujan Lebat',
    HUJAN_SANGAT_LEBAT: 'Hujan Sangat Lebat',
    TIDAK_DIKETAHUI: 'Tidak diketahui',
  },
  en: {
    CERAH: 'Clear',
    CERAH_BERAWAN: 'Partly cloudy',
    BERAWAN: 'Cloudy',
    BERAWAN_TEBAL: 'Overcast',
    HUJAN_RINGAN: 'Light rain',
    HUJAN_SEDANG: 'Moderate rain',
    HUJAN_LEBAT: 'Heavy rain',
    HUJAN_SANGAT_LEBAT: 'Very heavy rain',
    TIDAK_DIKETAHUI: 'Unknown',
  },
};

/**
 * Every phrase the summary can emit.
 *
 * Kept as templates rather than assembled inline so the report's two languages
 * cannot drift apart, and so the exact wording a client reads is editable
 * without touching the maths.
 */
export interface SummaryStrings {
  average: string;
  maximum: string;
  atHour: (hhmm: string) => string;
  onDate: (date: string) => string;
  mmPerHour: string;
  mmPerDay: string;
  noRain: string;
  noData: string;
  insufficient: string;
  /** e.g. "2 dari 7 hari" */
  ofDays: (n: number, total: number) => string;
  fog: {
    none: string;
    confirmed: string;
    likely: string;
    ambiguous: string;
    ambiguousDew: string;
    notFog: string;
    insufficient: string;
  };
}

export const SUMMARY_STRINGS: Record<ReportLocale, SummaryStrings> = {
  id: {
    average: 'rata-rata',
    maximum: 'maksimum',
    atHour: (hhmm) => `pada pukul ${hhmm}`,
    onDate: (date) => `pada tanggal ${date}`,
    mmPerHour: 'mm/jam',
    mmPerDay: 'mm/hari',
    noRain: 'Tidak ada hujan tercatat',
    noData: 'Data stasiun tidak tersedia',
    insufficient: 'Riwayat belum cukup untuk menilai',
    ofDays: (n, total) => `${n} dari ${total} hari`,
    fog: {
      none: 'Tidak ada kabut',
      confirmed: 'Kabut terkonfirmasi',
      likely: 'Kabut sangat mungkin',
      ambiguous: 'Ambigu',
      ambiguousDew: 'Ambigu — kemungkinan embun',
      notFog: 'Bukan kabut (stratus rendah atau mendung)',
      insufficient: 'Riwayat belum cukup untuk menilai',
    },
  },
  en: {
    average: 'average',
    maximum: 'maximum',
    atHour: (hhmm) => `at ${hhmm}`,
    onDate: (date) => `on ${date}`,
    mmPerHour: 'mm/h',
    mmPerDay: 'mm/d',
    noRain: 'No rainfall recorded',
    noData: 'No station data available',
    insufficient: 'Not enough history to assess',
    ofDays: (n, total) => `${n} of ${total} days`,
    fog: {
      none: 'No fog',
      confirmed: 'Fog confirmed',
      likely: 'Fog likely',
      ambiguous: 'Ambiguous',
      ambiguousDew: 'Ambiguous — likely dew',
      notFog: 'Not fog (low stratus or overcast)',
      insufficient: 'Not enough history to assess',
    },
  },
};
