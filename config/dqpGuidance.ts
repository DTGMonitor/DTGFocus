/**
 * The Data Quality Parameter documents, transcribed so the DQP tab can show a
 * new operator what each status on a row actually means.
 *
 * Three source documents are covered, across four variants:
 *   FX  - "Data Quality Parameters for SSR-FX and Omni"
 *   XT  - "Data Quality Parameters for SSR-XT"
 *   MSR - "Data Quality Parameters for Reutech Radars"
 *   PS  - the FX sheet, except where a PS scores a parameter the way a Reutech
 *         does (the 3D DTM, which a PS reads its data against)
 *
 * Entries are keyed by `parameters.id` rather than by name: the names have been
 * edited several times (see config/parameterConfig.js) while the ids have not.
 *
 * Where two sheets score the same measurement on different ladders the row is
 * transcribed onto the one its checkboxes use - the Reutech sheet calls
 * intermittent data Sub-Optimal, this app scores it Critical as the SSR sheets
 * do. A sheet band the row cannot take at all (Correction Source and DSRA both
 * have a Critical the checkboxes do not offer) is kept here for fidelity and
 * dropped by `getDqpGuidance`, so the modal never describes an untickable box.
 */

import { getAllowedStatuses, canBeNotApplicable } from './parameterConfig';
import { classifyRadar } from './radarParameterSets';

export type DqpStatus = 'Optimal' | 'Acceptable' | 'Sub-Optimal' | 'Critical' | 'N/A';

export interface GuidanceEntry {
  status: DqpStatus;
  /** The document's wording for this band. */
  description: string;
  /** The document's "Response" column, where it has one. */
  response?: string;
}

export interface ParameterGuidance {
  /** The parameter's heading in the source document, which is not always the DB name. */
  title: string;
  /** The Reutech sheet's "Evidence:" line - what to look at before scoring. */
  evidence?: string;
  /** Conditional lines such as "Applicable when Stable Reference Areas are used." */
  applicability?: string;
  entries: GuidanceEntry[];
}

export type DocVariant = 'FX' | 'XT' | 'MSR' | 'PS';

export const DOC_LABEL: Record<DocVariant, string> = {
  FX: 'Data Quality Parameters for SSR-FX and Omni',
  XT: 'Data Quality Parameters for SSR-XT',
  MSR: 'Data Quality Parameters for Reutech Radars',
  PS: 'Data Quality Parameters for SSR-FX and Omni, as applied to PS',
};

/**
 * PS has no document of its own and reads the SSR-FX sheet, but it is not
 * simply an alias for it: the DTM is load-bearing on a PS and carries a
 * Critical band the SSR products do not have.
 */
export function docVariantFor(radarNumber?: string | null): DocVariant {
  const family = classifyRadar(radarNumber || '');
  if (family === 'MSR') return 'MSR';
  if (family === 'XT') return 'XT';
  if (family === 'PS') return 'PS';
  return 'FX';
}

const g = (status: DqpStatus, description: string, response?: string): GuidanceEntry =>
  response ? { status, description, response } : { status, description };

// ─────────────────────────────────────────────────────────────
// Shared SSR blocks (identical wording in the FX and XT sheets)
// ─────────────────────────────────────────────────────────────

const SSR_DATA_AVAILABILITY: ParameterGuidance = {
  title: 'Data Availability',
  entries: [
    g('Optimal', 'Live data is available.'),
    g(
      'Critical',
      'Intermittent data is available at the PMP due to either data link issues or spikes in the "time per scan" plot.',
      'Follow lost connection TARP response and email support desk.'
    ),
    g('Critical', 'Live data is only available at the radar, not the PMP.', 'Follow lost connection TARP response.'),
    g('Critical', 'No live SSR data is available at the SSR or at the PMP.', 'Follow lost connection TARP response.'),
  ],
};

const SSR_SIGNAL_STRENGTH: ParameterGuidance = {
  title: 'Signal Strength (Amplitude)',
  entries: [
    g('Optimal', 'The amplitude image is consistent across the whole wall folder.'),
    g(
      'Critical',
      'The amplitude image shows gradual reduction in strength over time, or eventual dips in strength (both shown as darker colours) that do not follow the trend of daily temperature change.',
      'Email site geotech and call GP support desk.'
    ),
    g(
      'Critical',
      "The amplitude image shows similar strength between the sky and the rock face areas. The deformation image doesn't make any sense. The amplitude image becomes blue and the sky mask is applied over large areas of the deformation image.",
      'Email site geotech and call GP support desk.'
    ),
  ],
};

const SSR_SCAN_AREA: ParameterGuidance = {
  title: 'Scan Area',
  entries: [
    g('Optimal', 'The critical area or area of interest is fully present in the scan area.'),
    // The sheet jumps straight from Optimal to Critical; this band covers the
    // scan that is too wide rather than too narrow, which costs data quality
    // without ever putting the area of interest at risk.
    g(
      'Acceptable',
      'Several areas of the scan are considered unnecessary. Trimming them can reduce scan time and minimise atmospheric effects, improving overall data quality.'
    ),
    g(
      'Critical',
      'The critical area or area of interest is partially missing or completely missing from the scan area.',
      'Email site geotech.'
    ),
  ],
};

const SSR_VECTOR_LOSS: ParameterGuidance = {
  title: 'Vector Loss',
  entries: [
    g(
      'Optimal',
      'Most of the scan area is at an incidence angle that allows measuring at least 75% of the real magnitude of deformations.'
    ),
    g(
      'Acceptable',
      'Part of the scan area is at an angle that only 50% of the real magnitude of deformations is seen by the SSR and there are no adjustments in the alarms.',
      'Email site geotech.'
    ),
    g(
      'Sub-Optimal',
      'Part of the scan area is at an angle that only 30% of the real magnitude of deformation is seen by the SSR and there are no adjustments in the alarms.',
      'Email site geotech.'
    ),
  ],
};

const SSR_COHERENCE: ParameterGuidance = {
  title: 'Coherence',
  entries: [
    g(
      'Optimal',
      'The Coherence image for the rock face is generally clear (white), except for rainy periods or blasts or vegetation & mining activity.'
    ),
    g(
      'Acceptable',
      'The Coherence image shows large areas of dark colours, but the noise can easily be filtered out using time sliders to isolate the periods when the SSR recovered from experienced issues.'
    ),
    g(
      'Sub-Optimal',
      'Most of the area of concern (more than 50%) shows consistent low coherence and could not be filtered (e.g. due to surface vegetation).'
    ),
    g(
      'Critical',
      '100% of the area of concern shows consistent low coherence - analysis is impossible due to critical data quality and alarms are ineffective or triggering continuously.',
      'This will trigger an overall Critical rating.'
    ),
  ],
};

const SSR_IMAGE_ALIGNMENT: ParameterGuidance = {
  title: 'Image Alignment',
  entries: [
    g(
      'Optimal',
      'The plan view image is displaying data within 60° in elevation. All the targets within that range on the front view image show pixel returns in the plan view image. The geopositioning reveals that all areas that are supposed to be seen are measured.'
    ),
    g(
      'Sub-Optimal',
      "The geopositioning reveals that there are areas of the wall that are supposed to be scanned (from the front view image), but on the plan view image they do not show pixel returns. Image alignment is adversely affecting the operator's ability to monitor the area of concern and can be improved."
    ),
    g(
      'Critical',
      "The geopositioning shows that there are many areas of the wall that are not included in the scan area, inferring a large misalignment of the camera. The operator's ability to effectively monitor the data is critically impacted by significant misalignment of the data/image.",
      'Email site geotech and GP support desk.'
    ),
  ],
};

const SSR_PHOTO_QUALITY: ParameterGuidance = {
  title: 'Photo Quality',
  entries: [
    g(
      'Optimal',
      'Most of the photos per day are clear and usable (do not consider natural fog and dust in the assessment).'
    ),
    g(
      'Sub-Optimal',
      'Many photographs are hard to interpret due to an issue with the camera performance (i.e. dirty lens).',
      'Email site geotech and GP support desk.'
    ),
    g('Critical', 'No photographs are available or usable.', 'Email site geotech and GP support desk.'),
  ],
};

const SSR_SKY_SHORT_RANGE: ParameterGuidance = {
  title: 'Sky and Short Range Masks',
  entries: [
    g(
      'Optimal',
      'Only the sky and range filtered targets (0 m, 200 m, 400 m) are automatically masked out, OR there is no sky to be masked out. Less than 30% %wall is reported in SSR-Viewer.'
    ),
    g(
      'Sub-Optimal',
      'There are range wrapped targets appearing within the range filtered area. These false pixels are triggering enhanced scan events or unwanted alarms.'
    ),
    g(
      'Sub-Optimal',
      'The sky mask amplitude level is too low, showing a significantly large number of pixels at ranges where a rock slope does not exist.'
    ),
    g('Critical', 'The sky mask amplitude level is too high, thus masking out (part of) the area of interest.'),
  ],
};

const SSR_EDM: ParameterGuidance = {
  title: 'Enhanced Deformation Mask',
  entries: [
    g(
      'Optimal',
      'The Enhanced Deformation Mask is applied correctly over areas prone to trigger ambiguities out of the area of interest, OR the Enhanced Deformation Mask is not required.'
    ),
    g(
      'Acceptable',
      'The Enhanced Deformation Mask is only partially applied but ambiguous events are not being triggered.'
    ),
    g(
      'Sub-Optimal',
      'There is no mask applied, while several enhanced scan events are occurring. Range wrapped pixels cause unnecessary scan replacements.',
      'Email site geotech.'
    ),
    g(
      'Critical',
      'The whole scan area is masked out with the Enhanced Deformation Mask, OR an excessive number of scans are being replaced. The deformation chart shows deviating trends between the standard and enhanced deformation plots.',
      'Email site geotech.'
    ),
  ],
};

/**
 * Every radar is scored on the Reutech alarm ladder - it is the only one of the
 * three that separates "functional but improvable" from "needs calibration",
 * and alarm review does not differ by product the way an amplitude image does.
 */
const ALARM_SETTINGS: ParameterGuidance = {
  title: 'Alarm Settings',
  evidence: 'Monitored regions, movement variable, threshold, time window, area requirement.',
  entries: [
    g(
      'N/A',
      'DTG is not responsible for alarm review, or the site has formally determined that alarms are not required (no alarms are set and the client is aware). Leave every box on this row unticked to record N/A.'
    ),
    g('Optimal', 'All required alarms are enabled and appropriately configured for the approved monitoring regions and TARP.'),
    g('Acceptable', 'Alarm settings are functional, although minor optimisation could improve performance.'),
    g(
      'Sub-Optimal',
      'Alarm settings require calibration, create recurring unwanted alarms or provide reduced coverage or sensitivity.',
      'Email site geotech.'
    ),
    g(
      'Critical',
      'A required alarm is missing, disabled or ineffective for a critical monitoring area.',
      'Email site geotech.'
    ),
  ],
};

const SSR_GLOBAL_ALARM_MASKS: ParameterGuidance = {
  title: 'Global and Alarm Masks',
  entries: [
    g('Optimal', 'Alarm masks are applied properly with no unwanted alarms.'),
    g(
      'N/A',
      'Masking is not applied and no significant noisy areas are occurring on the scan area. Leave every box on this row unticked to record N/A.'
    ),
    g('Acceptable', 'Masking could be improved. Unwanted alarms may trigger occasionally but not every day.'),
    g('Sub-Optimal', 'Alarm masks are applied poorly with frequent unwanted alarms being triggered.'),
    g(
      'Critical',
      'Unwanted alarms are triggering continuously, or the Global mask is obscuring areas suggesting a risk of missing a collapse.'
    ),
  ],
};

const SSR_CORRECTION_SOURCE: ParameterGuidance = {
  title: 'Atmospheric Correction Source',
  entries: [
    g(
      'Optimal',
      'The Stable Reference Area (SRA) or Dynamic Stable Reference Area (DSRA) is selected as the method for atmospheric correction.'
    ),
    g(
      'Acceptable',
      'The Weather Station (WS) is selected as the method for atmospheric correction and the SSR is deployed at less than 600 m from the wall.'
    ),
    g(
      'Sub-Optimal',
      'The Weather Station is selected as the method for atmospheric correction and the SSR is deployed at more than 600 m from the wall.'
    ),
    g('Critical', 'There is no atmospheric correction applied.'),
  ],
};

const SSR_DSRA: ParameterGuidance = {
  title: 'Dynamic Stable Reference Areas',
  applicability: 'Applicable when Stable Reference Areas are used.',
  entries: [
    g('Optimal', 'Appropriate DSRA locations have been selected.'),
    g(
      'Acceptable',
      'Two or more SRAs were created on the same geotechnical domain, at similar range, OR the SRAs have only <2 pixels each. The quality of these SRAs is as described above.'
    ),
    g('Sub-Optimal', 'Only one SRA was created, with the quality described above.'),
    g('Critical', 'No SRAs were created, or the quality is not as described above.'),
  ],
};

const SSR_SRA_SPREAD: ParameterGuidance = {
  title: 'Stable Reference Area Spread graph',
  applicability: 'Applicable when Stable Reference Areas are used.',
  entries: [
    g('Optimal', 'There are no steps, the plot follows a horizontal trend with only few occasional spikes.'),
    g('Acceptable', 'The plot shows a horizontal trend with steps.'),
    g(
      'Sub-Optimal',
      'The plot shows an increasing trend.',
      'Change the SRA (email site geotech for the approval of the proposed SRA location).'
    ),
  ],
};

const SSR_REFRACTIVITY: ParameterGuidance = {
  title: 'Atmospheric Correction graph (at least one day of data)',
  applicability:
    'Applicable only if SRAs are selected as the method for atmospheric correction and the radar has a weather station.',
  entries: [
    g('Optimal', 'The Gradient and Weather Station plots follow the same trend closely.'),
    g(
      'Acceptable',
      'The plots have a similar trend, a few steps might have caused them to separate but the general trend is more or less parallel. Check in Excel that there is no diverging trend.'
    ),
    g('Sub-Optimal', 'The plots are diverging or converging on a continuous basis.'),
  ],
};

const SSR_ATMOSPHERIC_GRAPH: ParameterGuidance = {
  title: 'Atmospheric Correction graph (at least two days of data)',
  applicability:
    'Applicable only if the radar does not have a WS, OR the method for atmospheric correction is based on WS data.',
  entries: [
    g('Optimal', 'The graph has a sinusoidal plot and its trend is horizontal.'),
    g(
      'Acceptable',
      'The graph has a sinusoidal plot with an upward or downward trend. A daily drop or increase in the atmosphere temperature has been experienced on site.'
    ),
    g(
      'Sub-Optimal',
      'The graph has a sinusoidal plot with an upward or downward trend. The weather (i.e. temperature) has remained stable during the period of analysis.'
    ),
  ],
};

const SSR_GEO_POSITIONING: ParameterGuidance = {
  title: 'Geo-Positioning',
  entries: [
    g(
      'Optimal',
      'Geo-positioning has been applied accurately, and coordinates match expected ground control or map references.'
    ),
    g(
      'Acceptable',
      'Geo-positioning is applied but shows errors in alignment or referencing; accuracy may vary across areas.',
      'Email site geotech.'
    ),
    g(
      'Sub-Optimal',
      'Geo-positioning is missing or fails to function due to system or data input errors.',
      'Email site geotech.'
    ),
  ],
};

/**
 * On an SSR the DTM is supporting data - it never blocks interpretation, so the
 * sheet stops at Sub-Optimal and the row carries no Critical band.
 */
const SSR_3D_DTM: ParameterGuidance = {
  title: '3D DTM',
  entries: [
    g('Optimal', '3D DTM has been successfully applied and integrated.'),
    g('Acceptable', '3D DTM is applied but shows partial misalignment, distortion, or limited coverage in the system.'),
    g(
      'Sub-Optimal',
      '3D DTM is not present in the system, either due to processing issues or missing input data.',
      'Email site geotech.'
    ),
  ],
};

/** On a PS the data is read against the DTM, so the SSR ladder gains the Reutech Critical band. */
const PS_3D_DTM: ParameterGuidance = {
  ...SSR_3D_DTM,
  entries: [
    ...SSR_3D_DTM.entries,
    g(
      'Critical',
      'No usable DTM is applied, or major misalignment prevents reliable spatial identification of the monitoring areas.'
    ),
  ],
};

// ─────────────────────────────────────────────────────────────
// The guidance map - parameters.id -> document -> block
// ─────────────────────────────────────────────────────────────

const GUIDANCE: Record<number, Partial<Record<DocVariant, ParameterGuidance>>> = {
  // ── System Health ────────────────────────────────────────
  9: {
    FX: SSR_DATA_AVAILABILITY,
    XT: SSR_DATA_AVAILABILITY,
    PS: SSR_DATA_AVAILABILITY,
    MSR: {
      title: 'Data Availability',
      evidence: 'Latest map time, latest end time, MSR connection status, expected scan interval.',
      entries: [
        g('Optimal', 'Latest data is updating within the expected scan interval, with no material gaps or delays.'),
        // The Reutech sheet files intermittent data as Sub-Optimal, a band this
        // row does not offer. The SSR sheets call the same condition Critical, so
        // that is where it sits here.
        g(
          'Critical',
          'Data is intermittent, repeatedly delayed, stale or back-updating, reducing continuity or timely assessment.',
          'Follow lost connection TARP response and email support desk.'
        ),
        g(
          'Critical',
          'No current valid radar data is available, or data is stale beyond the approved monitoring limit.',
          'Follow lost connection TARP response.'
        ),
      ],
    },
  },

  10: {
    FX: {
      title: 'SSR Type & Scan Mode',
      entries: [
        g('Optimal', 'The SSR is being used to monitor targets at ranges < 2.8 km.'),
        g('Sub-Optimal', 'The SSR is being used to monitor targets at ranges > 2.8 km.', 'Email site geotech.'),
      ],
    },
    XT: {
      title: 'SSR Type & Scan Mode',
      entries: [
        g(
          'Optimal',
          'The SSR has a small or large dish, it is scanning a wall at Range < 1400 m and short range mode is chosen.'
        ),
        g('Optimal', 'The SSR has a large dish, it is scanning a wall at Range < 2800 m and long range (RPN) mode is chosen.'),
        g('Optimal', 'The SSR is a T-series, has a large dish, 2800 < Range < 3500, and extended range mode is chosen.'),
        g(
          'Sub-Optimal',
          'The combination of SSR scanning range and scan mode do not fit any of the above criteria.',
          'Email site geotech.'
        ),
      ],
    },
  },

  11: {
    FX: SSR_SIGNAL_STRENGTH,
    XT: SSR_SIGNAL_STRENGTH,
    PS: SSR_SIGNAL_STRENGTH,
    MSR: {
      title: 'Signal Quality',
      evidence: 'Amplitude map, Amplitude Dispersion Index (ADI) map.',
      entries: [
        g('Optimal', 'Amplitude and ADI patterns are stable and suitable across the required monitoring areas.'),
        g('Critical', 'Signal quality is inadequate across a required area and cannot support reliable interpretation.'),
        // The SSR sheets describe the symptom the Reutech one only names; the
        // band is the same on both, so it reads as a second Critical example.
        g(
          'Critical',
          'The amplitude map shows a gradual reduction in strength over time, or eventual dips in strength, that do not follow the trend of daily temperature change.',
          'Email site geotech and call GP support desk.'
        ),
      ],
    },
  },

  31: {
    MSR: {
      title: 'MSR System Status',
      evidence:
        'System Data Processor, Radar Transceiver, Digital Signal Processor, antenna positioner unit, power supply unit, radar doors.',
      entries: [
        g('Optimal', 'The radar is in the appropriate operating mode and all required System Status components show green/OK.'),
        g(
          'Sub-Optimal',
          'One or more components show a degraded or warning condition, but the radar continues to provide usable data.'
        ),
        g(
          'Critical',
          'A fault or failed component prevents valid data acquisition or prevents the radar from performing its monitoring function.'
        ),
      ],
    },
  },

  // ── Scan Area ────────────────────────────────────────────
  12: {
    FX: SSR_SCAN_AREA,
    XT: SSR_SCAN_AREA,
    PS: SSR_SCAN_AREA,
    MSR: {
      title: 'Scan Area Coverage',
      evidence: 'Active scan regions.',
      entries: [
        g('Optimal', 'All required areas and identified hazards are fully covered by appropriate active scan regions.'),
        // Re-banded from the sheet's Sub-Optimal: this row offers Acceptable
        // instead, and partial coverage is the condition that band exists for.
        g('Acceptable', 'Part of an area of interest is inadequately covered, or a region boundary requires adjustment.'),
        g(
          'Critical',
          'A required critical hazard is outside the active scan region, or its monitoring region is missing or materially incorrect.'
        ),
      ],
    },
  },

  13: {
    FX: SSR_VECTOR_LOSS,
    XT: SSR_VECTOR_LOSS,
    PS: SSR_VECTOR_LOSS,
    MSR: {
      title: 'Vector Loss',
      entries: [
        g(
          'Optimal',
          'Most of the scan area is at an incidence angle that allows measuring at least 75% of the real magnitude of deformations.'
        ),
        // The Reutech sheet bands these one step harsher than the SSR sheets
        // (50% Sub-Optimal, 30% Critical) but the row is scored on the SSR scale,
        // so the same two conditions sit at Acceptable and Sub-Optimal.
        g('Acceptable', 'Part of the scan area is at an angle that only 50% of the real magnitude of deformations is seen by the radar.'),
        g('Sub-Optimal', 'Part of the scan area is at an angle that only 30% of the real magnitude of deformation is seen by the radar.'),
      ],
    },
  },

  14: { FX: SSR_COHERENCE, XT: SSR_COHERENCE },

  15: { FX: SSR_IMAGE_ALIGNMENT, PS: SSR_IMAGE_ALIGNMENT },

  32: {
    MSR: {
      title: 'Confidence and Coverage',
      evidence: 'Confidence map, region Cnf percentage, region Cvg percentage.',
      entries: [
        g('Optimal', 'Confidence and Coverage are satisfactory throughout the required monitoring areas.'),
        g('Acceptable', 'Isolated lower-quality areas occur outside the critical interpretation or alarm regions.'),
        g(
          'Critical',
          'Confidence or Coverage is inadequate within a critical region and cannot reliably support interpretation or alarming.'
        ),
      ],
    },
  },

  33: {
    MSR: {
      title: 'Data Flags',
      evidence: 'Instantaneous flags, cumulative flags.',
      entries: [
        g('Optimal', 'No significant instantaneous or persistent flags affect required monitoring areas.'),
        g('Sub-Optimal', 'Recurrent or cumulative flags affect part of an area of interest and reduce data usability.'),
        g('Critical', 'Flags significantly invalidate the required monitoring area or prevent reliable interpretation.'),
      ],
    },
  },

  // ── Photographs ──────────────────────────────────────────
  16: {
    FX: {
      title: 'Alignment of front and Plan View Images and photos',
      entries: [
        g(
          'Optimal',
          'The front view image and the plan view radar image show good alignment (use strong targets to check, i.e. towers).'
        ),
        g(
          'Optimal',
          'The radar image and geopositioned image in plan view show proper alignment (i.e. towers) - check every plan view image.'
        ),
        g(
          'Sub-Optimal',
          'The photos do not keep a constant position, instead they shift in different directions during the wall folder life.',
          'Email site geotech and GP support desk.'
        ),
        g(
          'Sub-Optimal',
          'Poor alignment: > 4 pixels misalignment within area of interest in AZ, or > 8 pixels misalignment in Range.',
          'Email site geotech and GP support desk.'
        ),
      ],
    },
    XT: {
      title: 'Camera Alignment',
      entries: [
        g('Optimal', 'The camera and SSR are closely aligned: ≤ 2 pixels misalignment within area of interest.'),
        g('Optimal', 'Medium alignment: 3 - 4 pixels misalignment within area of interest.'),
        g(
          'Sub-Optimal',
          'The photos do not keep a constant position, instead they shift in different directions during the wall folder life.',
          'Email site geotech and GP support desk.'
        ),
        g(
          'Sub-Optimal',
          'Poor alignment: > 4 pixels misalignment within area of interest.',
          'Email site geotech and GP support desk.'
        ),
      ],
    },
  },

  17: { FX: SSR_PHOTO_QUALITY, XT: SSR_PHOTO_QUALITY },

  34: {
    MSR: {
      title: 'CCTV Availability and Alignment',
      evidence: 'iVMS live CCTV, visibility of the monitored slope.',
      entries: [
        g('Optimal', 'Live CCTV is available, clear and appropriately aligned with the radar monitoring area.'),
        g('Sub-Optimal', 'CCTV is unavailable, significantly delayed or unclear, reducing remote visual verification.'),
      ],
    },
  },

  // ── Masks ────────────────────────────────────────────────
  18: { FX: SSR_SKY_SHORT_RANGE, XT: SSR_SKY_SHORT_RANGE },

  19: { FX: SSR_EDM, XT: SSR_EDM },

  36: {
    MSR: {
      title: 'Masks',
      evidence: 'Excluded area masks in flags map.',
      entries: [
        g('N/A', 'Masking is not applied and no significant noisy areas are occurring on the scan area.'),
        g(
          'Optimal',
          'Irrelevant or noisy areas are appropriately managed while all required monitoring and alarm areas remain available.'
        ),
        g(
          'Critical',
          'A required critical area is excluded from measurement, masked from required alarming or otherwise prevented from effective monitoring.'
        ),
      ],
    },
  },

  // ── Alarms ───────────────────────────────────────────────
  20: { FX: ALARM_SETTINGS, XT: ALARM_SETTINGS, PS: ALARM_SETTINGS, MSR: ALARM_SETTINGS },

  21: { FX: SSR_GLOBAL_ALARM_MASKS, XT: SSR_GLOBAL_ALARM_MASKS, PS: SSR_GLOBAL_ALARM_MASKS },

  // ── Atmospheric Correction ───────────────────────────────
  22: { FX: SSR_CORRECTION_SOURCE, XT: SSR_CORRECTION_SOURCE },
  23: { FX: SSR_DSRA, XT: SSR_DSRA },
  24: { FX: SSR_SRA_SPREAD, XT: SSR_SRA_SPREAD },
  25: { FX: SSR_REFRACTIVITY, XT: SSR_REFRACTIVITY },
  26: { FX: SSR_ATMOSPHERIC_GRAPH, XT: SSR_ATMOSPHERIC_GRAPH },

  35: {
    MSR: {
      title: 'Atmospheric Correction',
      evidence: 'Proven atmospheric correction, refractivity rate.',
      entries: [
        g('Optimal', 'Proven Atmospheric Corr. reports normal operation and no material residual atmospheric influence is observed.'),
        g('Acceptable', 'Temporary atmospheric variability exists, but corrected movement data remains suitable for interpretation.'),
        g(
          'Critical',
          'Atmospheric correction is unavailable or ineffective, and atmospheric influence cannot be reliably distinguished from genuine deformation.'
        ),
      ],
    },
  },

  // ── Visual Data ──────────────────────────────────────────
  27: { FX: SSR_GEO_POSITIONING, PS: SSR_GEO_POSITIONING },

  28: {
    FX: SSR_3D_DTM,
    PS: PS_3D_DTM,
    MSR: {
      title: '3D DTM',
      evidence: 'DTM layer, synthetic-map alignment.',
      entries: [
        g('Optimal', 'A suitable current 3D DTM is applied and correctly aligned with the radar data and regions.'),
        g('Sub-Optimal', 'The DTM is outdated or partially misaligned and affects some interpretation or region positioning.'),
        g('Critical', 'No usable DTM is applied, or major misalignment prevents reliable spatial identification of the monitoring areas.'),
      ],
    },
  },
};

export interface GuidanceLookup {
  id: number;
  name?: string;
  parent_id?: number | null;
}

/**
 * The guidance for one row of the DQP table, trimmed to the statuses that row
 * can actually be set to. Returns null when the document covering this radar
 * has nothing to say about the parameter.
 */
export function getDqpGuidance(parameter: GuidanceLookup, radarNumber?: string | null): ParameterGuidance | null {
  const block = GUIDANCE[parameter.id]?.[docVariantFor(radarNumber)];
  if (!block) return null;

  const allowed = new Set<string>(getAllowedStatuses(parameter.name, radarNumber) ?? []);
  if (allowed.size === 0) return block; // no rule for this row: show the document as written
  if (canBeNotApplicable(parameter)) allowed.add('N/A');

  const entries = block.entries.filter((entry) => allowed.has(entry.status));
  return entries.length ? { ...block, entries } : null;
}
