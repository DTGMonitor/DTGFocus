// ─────────────────────────────────────────────────────────────
// Radar Types
// ─────────────────────────────────────────────────────────────

export const RADAR_TYPES = ["PS", "XT", "FX", "SARx", "Omni", "MSR"] as const;
export type RadarType = (typeof RADAR_TYPES)[number];

// Sentinel value — term appears for ALL radar types (including Omni)
const ALL = "ALL" as const;

/**
 * Extracts the RadarType from a model name string.
 *
 * Rules:
 *  - PS  → prefix before numbers:  "PS2000"       → "PS"
 *  - XT  → suffix after numbers:   "SSR461XT"     → "XT"
 *  - FX  → suffix after numbers:   "SSR500FX"     → "FX"
 *  - SARx→ suffix after numbers:   "SSR300SARx"   → "SARx"  (x is always lowercase)
 *  - Omni→ fallback if no match — returns "Omni" (show all terms)
 *
 * Matching is case-insensitive except for the 'x' in SARx, which is always lowercase.
 *
 * @example
 * parseRadarType("PS2000")      // "PS"
 * parseRadarType("SSR461XT")    // "XT"
 * parseRadarType("SSR500FX")    // "FX"
 * parseRadarType("SSR300SARx")  // "SARx"
 * parseRadarType("unknown")     // "Omni"
 */
export function parseRadarType(modelName: string): RadarType {
  const name = modelName.trim();

  // PS — prefix style: starts with "PS" followed by digits
  if (/^ps\d/i.test(name)) return "PS";

  // PS — prefix style: starts with "PS" followed by digits
  if (/^msr\d/i.test(name)) return "MSR";

  // SARx — suffix style: ends with "SARx" (x must be lowercase per spec)
  if (/sarx$/i.test(name)) return "SARx";

  // XT — suffix style: ends with "XT"
  if (/xt$/i.test(name)) return "XT";

  // FX — suffix style: ends with "FX"
  if (/fx$/i.test(name)) return "FX";

  // No match → universal fallback
  return "Omni";
}

// ─────────────────────────────────────────────────────────────
// Glossary Entry Shape
// ─────────────────────────────────────────────────────────────

export interface GlossaryEntry {
  term: string;
  definition: string;
  /**
   * List of radar types this term applies to.
   * Use "ALL" to show for every radar type.
   */
  radars: RadarType[] | typeof ALL;
}

// ─────────────────────────────────────────────────────────────
// Glossary Config
// ─────────────────────────────────────────────────────────────

export const GLOSSARY: Record<string, GlossaryEntry> = {
  THREE_D_DTM: {
    term: "3D DTM",
    definition:
      "A 3D representation of the mine's surface used in radar systems to display radar data over realistic terrain within the software. It provides accurate spatial context, helping users visualize slope movement and radar measurements in relation to the actual ground surface.",
    radars: ["PS", "FX", "MSR"],
  },

  AMPLITUDE: {
    term: "Amplitude",
    definition:
      "A measure of the strength of the radar signal returned from the surface. High amplitude indicates a strong, clear signal, which is essential for accurate surface displacement measurements. Low amplitude may suggest issues such as poor signal reflection or potential mechanical problems with the radar system.",
    radars: ["PS", "XT", "FX", "SARx", "MSR"],
  },

  COHERENCE: {
    term: "Coherence",
    definition:
      "Coherence is a measure of data reliability between consecutive scans. Low coherence may indicate a system issue or disturbance on the slope surface, leading to unreliable or noisy data that complicates accurate deformation measurement. Consistently high coherence is required for measuring confidence in data.",
    radars: ["XT", "FX", "SARx"],
  },

  CONFIDENCE: {
    term: "Confidence",
    definition:
      "Confidence is a measure of data reliability between consecutive scans. Low confidence may indicate a system issue or disturbance on the slope surface, leading to unreliable or noisy data that complicates accurate deformation measurement. Consistently high confidence is required for measuring confidence in data.",
    radars: ["MSR"],
  },

  DSRA: {
    term: "DSRA (Dynamic Stable Reference Area)",
    definition:
      "An enhanced version of the Stable Reference Area (SRA) used in Monitor IQ to correct deformation measurements affected by atmospheric changes. DSRA improves accuracy by automatically filtering out low-quality (low coherence) data from the Stable Reference Zone (SRZ) in each scan, ensuring more reliable deformation correction.",
    radars: ["XT", "FX"],
  },

  EDM: {
    term: "EDM (Enhanced Deformation Mask)",
    definition:
      "A tool used to protect non-Area of Interest (non-AOI) regions during scans when ambiguities are detected. Instead of replacing the entire scan, EDM preserves stable data outside the AOI. This feature is available only when Enhanced Deformation Algorithms (EDA) is selected as the primary algorithm for the wall folder.",
    radars: ["XT", "FX"],
  },

  GEO_POSITIONING: {
    term: "Geo-Positioning",
    definition:
      "A technique developed by GroundProbe to overlay and align two spatially referenced images—such as a plan view of radar data and a plan view photograph from the SSR camera or other sources. This allows for accurate visual correlation between radar measurements and real-world terrain features.",
    radars: ["PS", "FX"],
  },

  REFRACTIVITY: {
    term: "Refractivity",
    definition:
      "Atmospheric refractivity is a comparison chart between SRA calculations and Weather Station (WS) calculations, used to measure the difference between the two in order to ensure that atmospheric corrections applied in the radar system align with actual weather conditions, maintaining accuracy in radar targeting and wall displacement measurements.",
    radars: ["XT", "FX"],
  },

  REFRACTIVITY2: {
    term: "Refractivity",
    definition:
      "Refractivity is atmospheric calculation derived from Known Stable Region (KSR) and/or Weather Station (WS), used to enable corrections to atmospheric variations, maintaining accuracy in radar targeting and wall displacement measurements.",
    radars: ["MSR"],
  },

  VECTOR_LOSS: {
    term: "Vector Loss",
    definition:
      "All line-of-sight measurement tools can potentially measure less movement than the actual occurrence due to the targets and the instrument's geometry. The greater the difference between the measurement tool's vector impact angle and the wall's movement, the less the movement will be detected.",
    radars: ["PS", "XT", "FX", "SARx", "MSR"],
  },

  WALL_PERCENTAGE: {
    term: "Wall Percentage",
    definition:
      "The proportion of radar-detected pixels that represent the wall face, as opposed to background noise or atmospheric interference. Typically, no more than 40% of the total pixels measured by the radar correspond to the actual wall. This makes wall percentage a key parameter for data quality. It is controlled using the Sky Mask setting, which is applicable only to SSR-FX and SSR-SARx systems.",
    radars: ["FX", "SARx"],
  },
};

// ─────────────────────────────────────────────────────────────
// Utility: Filter glossary by radar type
// ─────────────────────────────────────────────────────────────

/**
 * Returns glossary entries relevant to a given radar type or model name.
 * Accepts either a RadarType directly or a raw model name string (e.g. "SSR461XT").
 * "Omni" (or any unrecognised model name) returns all entries.
 *
 * @example
 * getGlossaryForRadar("PS")        // 3D DTM, Amplitude, Geo-Positioning, Vector Loss
 * getGlossaryForRadar("PS2000")    // same as above — model name parsed automatically
 * getGlossaryForRadar("XT")        // Amplitude, Coherence, DSRA, EDM, Refractivity, Vector Loss
 * getGlossaryForRadar("SSR461XT")  // same as above — model name parsed automatically
 * getGlossaryForRadar("Omni")      // All entries
 */
export function getGlossaryForRadar(radarTypeOrModel: RadarType | string): GlossaryEntry[] {
  // If it's already a known RadarType, use it directly; otherwise parse the model name
  const radarType: RadarType = (RADAR_TYPES as readonly string[]).includes(radarTypeOrModel)
    ? (radarTypeOrModel as RadarType)
    : parseRadarType(radarTypeOrModel);

  if (radarType === "Omni") {
    return Object.values(GLOSSARY);
  }

  return Object.values(GLOSSARY).filter(
    (entry) => entry.radars === ALL || entry.radars.includes(radarType)
  );
}