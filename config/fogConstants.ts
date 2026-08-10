// config/fogConstants.ts
//
// Every tunable number in the fog index, in one object.
//
// These are LITERATURE DEFAULTS, not values calibrated against East Luwu. The
// bound station sits at roughly 950 m in a South Sulawesi valley, so the
// regime is highland radiation and valley fog — not the coastal advection most
// published thresholds were derived from. Expect all of them to move.
//
// The scoring function reads this object and holds no numbers of its own, so
// recalibration is an edit to this file and nothing else. Each assessment
// stores the constants it was scored under (fog_assessments.constants), which
// is what makes a re-score under new values comparable to the original.
//
// Bump `version` on any change that alters scoring. Two assessments carrying
// different versions are not comparable, and the calibration record depends on
// being able to tell them apart.

export interface FogConstants {
  readonly version: string;

  /** Dew point depression at or below which the air counts as saturated, °C. */
  readonly dpdSatC: number;
  /** Lower edge of the optimal wind band, km/h. */
  readonly windLoKmh: number;
  /** Upper edge of the optimal wind band, km/h. */
  readonly windHiKmh: number;
  /** Above this, radiation fog cannot form. Hard veto. km/h. */
  readonly windVetoKmh: number;
  /** Rain rate above which "it is raining" vetoes the score, mm/h. */
  readonly rainGateMmh: number;

  readonly minReadings: number;
  readonly windowHours: number;

  readonly saturation: {
    readonly max: number;
    /** Evaluated in order; first match wins. */
    readonly tiers: readonly { readonly maxDpdC: number; readonly points: number }[];
  };

  readonly persistence: {
    readonly max: number;
    readonly tiers: readonly { readonly minMinutes: number; readonly points: number }[];
  };

  readonly wind: {
    readonly max: number;
    /** Inside [windLoKmh, windHiKmh]. */
    readonly optimalPoints: number;
    /** Above windHiKmh, up to briskMaxKmh. */
    readonly briskMaxKmh: number;
    readonly briskPoints: number;
    /** Above briskMaxKmh, up to marginalMaxKmh. */
    readonly marginalMaxKmh: number;
    readonly marginalPoints: number;
    /**
     * Below windLoKmh. Deliberately low and deliberately counterintuitive:
     * dead calm produces DEW, not fog. Without mechanical mixing the radiative
     * cooling stays pinned to the surface instead of being distributed through
     * a layer deep enough to become fog. Raising this is the single easiest
     * way to make the index wrong.
     */
    readonly calmPoints: number;
  };

  readonly plateau: {
    readonly max: number;
    /** Newest reading used as the dT/dt reference must be at least this old. */
    readonly minGapMinutes: number;
    readonly tightRateCPerH: number;
    readonly tightPoints: number;
    readonly looseRateCPerH: number;
    readonly loosePoints: number;
  };

  readonly radiative: {
    readonly max: number;
    /** Peak daytime kt must exceed this — a clear day preceded the night. */
    readonly ktPeakMin: number;
    /** Only readings above this solar elevation count towards peak kt, deg. */
    readonly ktElevationMinDeg: number;
    readonly pressureWindowHours: number;
    /** Synoptically quiet: |Δp| over the window below this, hPa. */
    readonly pressureDeltaMaxHpa: number;
    readonly bothPoints: number;
    readonly eitherPoints: number;
  };

  readonly reservoir: {
    readonly max: number;
    readonly windowStartHoursAgo: number;
    readonly windowEndHoursAgo: number;
    /** Recent hours that must be rain-free for the reservoir to count. */
    readonly quietHours: number;
    readonly points: number;
  };

  readonly indexB: {
    /** Below this solar elevation, kt is noise and Index B does not run, deg. */
    readonly minElevationDeg: number;
    readonly confirmKtMax: number;
    readonly confirmDpdMaxC: number;
    readonly notFogKtMax: number;
    readonly notFogDpdMinC: number;
    readonly dissipatingKtMin: number;
  };

  readonly verdict: {
    readonly likelyMin: number;
    readonly ambiguousMin: number;
  };
}

export const FOG_CONSTANTS: FogConstants = {
  version: '1',

  dpdSatC: 1.0,
  windLoKmh: 2.0,
  windHiKmh: 7.0,
  windVetoKmh: 12.0,
  rainGateMmh: 0.2,

  minReadings: 8,
  windowHours: 24,

  saturation: {
    max: 30,
    tiers: [
      { maxDpdC: 0.3, points: 30 },
      { maxDpdC: 0.8, points: 20 },
      { maxDpdC: 1.5, points: 10 },
    ],
  },

  persistence: {
    max: 15,
    tiers: [
      { minMinutes: 90, points: 15 },
      { minMinutes: 60, points: 10 },
      { minMinutes: 30, points: 5 },
    ],
  },

  wind: {
    max: 20,
    optimalPoints: 20,
    briskMaxKmh: 11,
    briskPoints: 10,
    marginalMaxKmh: 15,
    marginalPoints: 5,
    calmPoints: 5,
  },

  plateau: {
    max: 20,
    minGapMinutes: 35,
    tightRateCPerH: 0.2,
    tightPoints: 20,
    looseRateCPerH: 0.4,
    loosePoints: 10,
  },

  radiative: {
    max: 10,
    ktPeakMin: 0.6,
    ktElevationMinDeg: 20,
    pressureWindowHours: 3,
    pressureDeltaMaxHpa: 0.5,
    bothPoints: 10,
    eitherPoints: 5,
  },

  reservoir: {
    max: 5,
    windowStartHoursAgo: 6,
    windowEndHoursAgo: 24,
    quietHours: 1,
    points: 5,
  },

  indexB: {
    minElevationDeg: 8,
    confirmKtMax: 0.25,
    confirmDpdMaxC: 0.5,
    notFogKtMax: 0.30,
    notFogDpdMinC: 2.0,
    dissipatingKtMin: 0.4,
  },

  verdict: {
    likelyMin: 70,
    ambiguousMin: 45,
  },
};
