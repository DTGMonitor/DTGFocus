// Every local adaptation of the vendored SensiMap build: the platform palette,
// and the handful of defaults that differ from what upstream ships.
//
// public/sensitivity-tools is a verbatim mirror of the upstream clone, so any
// hand-edit there is wiped by the next `npm run sync:sensitivity`. The changes
// therefore live here as substitutions the sync re-applies after every copy —
// upstream stays pristine, the platform build never drifts.
//
// Upstream ships one hardcoded dark skin. Rather than swap its hexes for
// platform hexes, every chrome colour is rewritten to a `var(--sm-*)` token,
// and the tokens are emitted twice — `:root` for light, `html.dark` for dark —
// mirroring how app/globals.css drives the rest of the admin UI. The iframe
// learns which one to use from js/platform-theme.js.
//
// Only UI chrome is themed. Two things are deliberately left theme-independent:
//   * the named scientific colour scales (Viridis, Turbo, Inferno, Jet, …),
//     which are published standards whose names would stop meaning anything if
//     recoloured — they are fenced off by `protect` below;
//   * colours painted onto the terrain itself (sensor markers, movement-mode
//     swatches, the no-data / shadowed / out-of-scan masks). Those belong to
//     the data layer, not the chrome, and flipping them per theme would make
//     two PNG exports of the same map disagree.

import { readFile, writeFile, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ tokens */

/**
 * Tool token -> [light, dark].
 *
 * Light values come from the `--dtg-*` ramp in app/globals.css; dark values
 * from the hardcoded palette the monitoring screens use. Where the tool needs
 * a step the platform does not name, the derivation is noted.
 */
const TOKENS = {
  // Drives the native widgets (select popups, scrollbars, date pickers).
  "--sm-scheme": ["light", "dark"],

  // ---- surfaces, lightest-sitting-on-darkest first ----
  "--sm-bg": ["#f9fafb", "#1a1a1a"], //        app background
  "--sm-bg2": ["#ffffff", "#212121"], //       sidebar
  "--sm-panel": ["#f3f4f6", "#262626"], //     section headers, modal, chips
  "--sm-panel2": ["#e5e7eb", "#343434"], //    hover / raised panel
  "--sm-line": ["#e5e7eb", "#3a3a3a"], //      hairline
  "--sm-line2": ["#d1d5db", "#595959"], //     stronger border
  "--sm-raised": ["#d1d5db", "#404040"], //    button hover, scrollbar thumb
  "--sm-raised2": ["#9ca3af", "#525252"], //   scrollbar thumb hover
  "--sm-field": ["#ffffff", "#171717"], //     inputs and readouts
  // The 3D viewport sits one step outside the shell in both themes so the
  // terrain reads as a canvas rather than another panel.
  "--sm-viewport": ["#eef1f5", "#141414"],

  // ---- text ----
  "--sm-fg": ["#1a1a1a", "#f5f5f5"],
  "--sm-dim": ["#525252", "#a6a6a6"], //       labels, secondary text
  // Tertiary (10.5px hints, mode descriptions). Neither ramp names a usable
  // step here: dark jumps #a6a6a6 -> #595959, where #595959 reads at ~2.3:1,
  // and light's --dtg-text-muted #6b7280 only reaches 3.9:1 once it lands on a
  // hovered #e5e7eb row. Both values are the closest tone to the named one
  // that still clears 4.5:1 on every surface the hints actually sit on.
  "--sm-dim2": ["#5d6470", "#8c8c8c"],
  "--sm-light": ["#525252", "#d9d9d9"], //     colourbar tick labels

  // ---- brand accent ----
  // The platform pairs a bright teal with a deep one. Dark mode leads with the
  // bright #05CAC8; on a light surface that only reaches ~1.9:1, so light mode
  // leads with the deep #024E4C and the pair inverts.
  "--sm-acc": ["#024E4C", "#05CAC8"],
  "--sm-acc2": ["#20625C", "#19E1C9"],
  "--sm-acc-soft": ["#024E4C1a", "#05CAC822"], //   badge / tag fill
  "--sm-acc-softer": ["#024E4C24", "#05CAC833"], // selected table row
  "--sm-acc-border": ["#024E4C40", "#05CAC844"],
  "--sm-acc-glow": ["#024E4C55", "#05CAC877"], //   logo drop shadow

  // ---- primary action ----
  // Deep teal with white text clears AA on both themes, so it does not flip.
  "--sm-primary": ["#024E4C", "#024E4C"],
  "--sm-primary-border": ["#036E6B", "#05CAC8"],
  "--sm-primary-hover": ["#20625C", "#20625C"],
  "--sm-primary-fg": ["#ffffff", "#ffffff"],

  // ---- status ----
  // #FFC000 and #E63946 are the monitoring screens' amber and red; both fall
  // under 3:1 on white, so light mode takes the platform's darker report
  // variants for the same roles. --dtg-accent-orange-dark #d35400 is still
  // only 4.2:1 as body text, so warn goes one shade past it — the soft fill
  // and border keep the named hue, where contrast does not apply.
  "--sm-warn": ["#bd4b00", "#FFC000"],
  "--sm-warn-soft": ["#d354001a", "#FFC00022"],
  "--sm-warn-border": ["#d3540040", "#FFC00066"],
  "--sm-bad": ["#C00000", "#E63946"],
  "--sm-ok": ["#008000", "#00B050"],

  // Destructive button — a tinted surface in light, a muted one in dark, both
  // derived from --sm-bad since the platform names no destructive surface.
  "--sm-danger-bg": ["#FDEAEA", "#4A1C22"],
  "--sm-danger-border": ["#E9AFAF", "#7A2F36"],
  "--sm-danger-hover": ["#F8D8D8", "#63262C"],

  // ---- overlays over the viewport ----
  "--sm-hud-bg": ["#ffffffe6", "#141414cc"],
  "--sm-hud-bg2": ["#ffffffee", "#141414dd"], // PNG export title block
  "--sm-topbar-from": ["#ffffff", "#34343444"],
  "--sm-topbar-to": ["#f3f4f6", "#1a1a1a"],

  // ---- shadows and scrims ----
  // A 67%-black drop shadow is right over a dark surface and far too heavy on
  // a light one, so these lighten rather than staying fixed.
  "--sm-ring": ["#00000026", "#00000066"], //     swatch outlines
  "--sm-scrim": ["#00000059", "#000000aa"], //    modal backdrop
  "--sm-shadow-modal": ["#00000026", "#000000aa"],
  "--sm-shadow-banner": ["#00000033", "#00000088"],
};

/* Colours that stay put across themes: they are painted onto the terrain or
   identify a series, so they answer to the data, not the surface behind it. */
const DATA_COLOURS = {
  sensor1: "#FFC000",
  sensor2: "#05CAC8",
  sensor3: "#E63946",
  sensor4: "#00B050",
  sensor5: "#8B5CF6",
  sensor6: "#E97132",
  axisE: "#E63946",
  axisN: "#00B050",
  axisRL: "#38BDF8",
};

/* ------------------------------------------------------------------- rules */

const v = (t) => `var(${t})`;

/**
 * Chrome hexes in the stylesheet: upstream literal -> token ref.
 *
 * The plain accent, status and surface hexes upstream declares (#2f9bff,
 * #ff5252, #12161c, …) appear only inside its `:root`, which ROOT_BLOCK below
 * rewrites wholesale — so they are absent here on purpose. What remains is the
 * set of literals sprinkled through the rules themselves.
 */
const CHROME = {
  "#1c222b": v("--sm-panel"), //  select popup
  "#e6ebf2": v("--sm-fg"), //     select option text
  "#6d7887": v("--sm-dim2"), //   select option disabled

  // accent family
  "#2f9bff22": v("--sm-acc-soft"),
  "#2f9bff44": v("--sm-acc-border"),
  "#12c2a0": v("--sm-acc2"), //   progress bar gradient end
  "#12c2a022": v("--sm-acc-soft"),
  "#12c2a066": v("--sm-acc-border"),
  "#12c2a077": v("--sm-acc-glow"),

  // primary / selected
  "#1f6fd0": v("--sm-primary"),
  "#1f6fd033": v("--sm-acc-softer"),
  "#2b81e8": v("--sm-primary-hover"),

  // status
  "#ffb30022": v("--sm-warn-soft"),
  "#ffb30066": v("--sm-warn-border"),
  "#5a2630": v("--sm-danger-bg"),
  "#7d3340": v("--sm-danger-border"),
  "#70303c": v("--sm-danger-hover"),

  // one-off surfaces
  "#0d1014": v("--sm-viewport"),
  "#0d1014cc": v("--sm-hud-bg"),
  "#101418": v("--sm-bg"),
  "#14181e": v("--sm-topbar-to"),
  "#20283244": v("--sm-topbar-from"),
  "#0f1318": v("--sm-field"),
  "#161b22": v("--sm-panel"),
  "#141922": v("--sm-panel"),
  "#16202c": v("--sm-acc-soft"),
  "#16283c": v("--sm-acc-soft"),
  "#182030": v("--sm-panel2"),
  "#131820": v("--sm-panel"),
  "#151a21": v("--sm-panel"),
  "#1e242d": v("--sm-panel2"),
  "#2a323d": v("--sm-panel2"),
  "#28313c": v("--sm-panel2"),
  "#33404e": v("--sm-raised"),
  "#4c5b6d": v("--sm-line2"),
  "#333e4b": v("--sm-raised"),
  "#43505f": v("--sm-raised2"),

  // shadows and scrims
  "#0006": v("--sm-ring"),
  "#0008": v("--sm-shadow-banner"),
  "#000a": v("--sm-shadow-modal"),
  "#000000aa": v("--sm-scrim"),
};

/* `#fff` carries four different jobs in the stylesheet, so each is matched
   with enough surrounding text to tell them apart. #progText is not in the
   list on purpose: white text with a black shadow is legible over both the
   teal progress fill and either theme's trough, which is why upstream did it. */
const WHITE_IN_CONTEXT = {
  "background-color:#1f6fd0;color:#fff}":
    "background-color:var(--sm-primary);color:var(--sm-primary-fg)}",
  "border-color:#2f8ae0;color:#fff;font-weight:600":
    "border-color:var(--sm-primary-border);color:var(--sm-primary-fg);font-weight:600",
  ".hudTitle{font-size:12.5px;color:#fff": ".hudTitle{font-size:12.5px;color:var(--sm-fg)",
};

/* Two teal fills inherit their text colour rather than setting it. That was
   safe when the only theme was dark; in light mode --fg turns near-black and
   would sit on deep teal at ~1.6:1, so both are pinned to the on-primary
   colour explicitly. */
const ON_PRIMARY_TEXT = {
  "button.primary{background:#1f6fd0;border-color:#2f8ae0}":
    "button.primary{background:var(--sm-primary);border-color:var(--sm-primary-border);color:var(--sm-primary-fg)}",
  "background:#1f6fd0ee;border:1px solid #4da3ff;border-radius:20px;":
    "background:var(--sm-primary);border:1px solid var(--sm-primary-border);border-radius:20px;color:var(--sm-primary-fg);",
};

/* Upstream's :root only has to alias the generated tokens — every other rule
   in the file already reads through --bg / --fg / --acc and keeps working. */
const ROOT_BLOCK_FROM = `  --bg:#12161c; --bg2:#181d25; --panel:#1c222b; --panel2:#222a34;
  --line:#2c3542; --line2:#3a4553;
  --fg:#e6ebf2; --dim:#8f9bab; --dim2:#6d7887;
  --acc:#2f9bff; --acc2:#12c2a0; --warn:#ffb300; --bad:#ff5252;
  --ok:#4caf50;`;

const ROOT_BLOCK_TO = `  --bg:var(--sm-bg); --bg2:var(--sm-bg2); --panel:var(--sm-panel); --panel2:var(--sm-panel2);
  --line:var(--sm-line); --line2:var(--sm-line2);
  --fg:var(--sm-fg); --dim:var(--sm-dim); --dim2:var(--sm-dim2);
  --acc:var(--sm-acc); --acc2:var(--sm-acc2); --warn:var(--sm-warn); --bad:var(--sm-bad);
  --ok:var(--sm-ok);`;

/** Canvas cannot use var(), so JS resolves tokens at draw time. */
const c = (t) => `SMTheme.col('${t}')`;

export const RULES = [
  {
    file: "css/style.css",
    map: {
      [ROOT_BLOCK_FROM]: ROOT_BLOCK_TO,
      ...WHITE_IN_CONTEXT,
      ...ON_PRIMARY_TEXT,
      ...CHROME,
      // native widget rendering follows the active theme
      "/* makes native widgets (select popups, scrollbars, pickers) render dark */":
        "/* makes native widgets (select popups, scrollbars, pickers) match the theme */",
      "color-scheme:dark": "color-scheme:var(--sm-scheme)",
    },
  },

  {
    file: "index.html",
    map: {
      // load the bridge before anything paints, and the tokens before the
      // stylesheet that consumes them
      '<link rel="stylesheet" href="css/style.css">':
        '<link rel="stylesheet" href="css/platform-theme.css">\n' +
        '<link rel="stylesheet" href="css/style.css">\n' +
        '<script src="js/platform-theme.js"></script>',

      // default sensor marker, and the movement-mode swatches
      "#ffd400": DATA_COLOURS.sensor1,
      "#ff5252": DATA_COLOURS.sensor3, //  steepest
      "#4caf50": DATA_COLOURS.sensor4, //  horizontal
      "#2196f3": DATA_COLOURS.sensor2, //  vertical
      "#e040fb": DATA_COLOURS.sensor5, //  custom vector

      // Terrain masks — four rungs of the platform grey ramp, ordered as
      // upstream had them: by how much of the cell is still real. Mid-greys
      // rather than the near-black surface tokens, because these are painted
      // on the terrain and have to stay legible over either theme's viewport.
      "#2b3038": "#404040", //  out of scan
      "#3a4048": "#525252", //  no-data
      "#5b5f66": "#6b7280", //  shadowed
      "#6e7681": "#9ca3af", //  below threshold
    },
  },

  /* The application layer is a folder of small modules, so each rule below is
     scoped to the one file that actually owns those literals. An unmatched
     entry is then a real signal that upstream moved something, rather than
     noise from a colour that simply lives somewhere else now. */
  {
    file: "js/ui/sensors.js",
    map: {
      // default sensor palette — categorical, so the slots must stay distinct
      "#ffd400": DATA_COLOURS.sensor1,
      "#2f9bff": DATA_COLOURS.sensor2,
      "#ff5252": DATA_COLOURS.sensor3,
      "#12c2a0": DATA_COLOURS.sensor4,
      "#e040fb": DATA_COLOURS.sensor5,
      "#ff9800": DATA_COLOURS.sensor6,
    },
  },

  {
    file: "js/ui/data.js",
    map: {
      // the two sensors the demo pit drops in
      "#ffd400": DATA_COLOURS.sensor1,
      "#2f9bff": DATA_COLOURS.sensor2,
    },
  },

  {
    file: "js/ui/clip.js",
    map: {
      // clip-plane axis swatches (Easting / Northing / Elevation)
      "#ff5959": DATA_COLOURS.axisE,
      "#59ff73": DATA_COLOURS.axisN,
      "#66aeff": DATA_COLOURS.axisRL,
    },
  },

  {
    file: "js/ui/probe.js",
    map: {
      // inline markup in the line-of-sight readout — plain CSS, so var() works
      'style="color:#ffb300"': 'style="color:var(--sm-warn)"',
      "border-top:1px solid #2c3542": "border-top:1px solid var(--sm-line)",
    },
  },

  {
    file: "js/ui/stats.js",
    map: {
      // The histogram's threshold marker. Every other colour in this file
      // already resolves a token through SM.cssVar at draw time; this one is
      // hardcoded white upstream, which vanishes on a light surface.
      "g.strokeStyle = '#fff'": `g.strokeStyle = ${c("--sm-fg")}`,
    },
  },

  {
    file: "js/ui/io.js",
    map: {
      // canvas: PNG export title block
      "g.fillStyle = '#0d1014dd'": `g.fillStyle = ${c("--sm-hud-bg2")}`,
      "g.strokeStyle = '#2c3542'": `g.strokeStyle = ${c("--sm-line")}`,
      "g.fillStyle = '#ffffff'": `g.fillStyle = ${c("--sm-fg")}`,
      "g.fillStyle = '#9fb0c4'": `g.fillStyle = ${c("--sm-dim")}`,
    },
  },

  {
    file: "js/colormap.js",
    // Everything from the preset table up to the discrete sensor scale is a
    // published colour standard — leave it exactly as upstream ships it.
    protect: /var PRESETS = \{[\s\S]*?(?='sensors': \{)/,
    map: {
      // discrete "Sensor index" scale — mirrors the ui.js sensor palette
      "#ffd400": DATA_COLOURS.sensor1,
      "#2f9bff": DATA_COLOURS.sensor2,
      "#ff5252": DATA_COLOURS.sensor3,
      "#12c2a0": DATA_COLOURS.sensor4,
      "#e040fb": DATA_COLOURS.sensor5,

      // colourbar chrome. The threshold marker's white-over-black pair is left
      // alone: it is drawn on the colour scale itself, not on a themed surface.
      "g.strokeStyle = '#5a6472'": `g.strokeStyle = ${c("--sm-line2")}`,
      "g.fillStyle = '#c9d3df'": `g.fillStyle = ${c("--sm-light")}`,
      "g.strokeStyle = '#8f9bab'": `g.strokeStyle = ${c("--sm-dim")}`,
      "g.strokeStyle = '#cfd8e3'": `g.strokeStyle = ${c("--sm-light")}`,
      "g.fillStyle = '#f0f4f8'": `g.fillStyle = ${c("--sm-fg")}`,
    },
  },
];

/* ---------------------------------------------------------------- defaults */

/**
 * Platform defaults that differ from what upstream ships.
 *
 * Same survive-the-sync problem as the palette, so they live here rather than
 * being edited into public/. Keep this list short: every entry is a place the
 * vendored build disagrees with the clone, and something to re-check whenever
 * the tool is pulled.
 */
export const DEFAULT_RULES = [
  {
    file: "js/ui/overlays.js",
    map: {
      // Pitch the scan footprint by the boresight elevation.
      //
      // Upstream drapes the wedge on the terrain, which reads well but leaves
      // Boresight el invisible until a compute flips cells to "out of scan".
      // These three edits keep that wedge exactly as it is — same outline, same
      // plan footprint, same draped relief — and lift it about the sensor, so
      // at el = 0 nothing changes at all and any tilt swings it up or down.
      //
      // The rise is R*tan(el), i.e. the real height the boresight reaches at
      // the wedge's range. Clamped at 80 deg only to keep tan() finite; the UI
      // already limits the field to +/-90.
      "        var f = [], N2 = 64, R = Math.min(r.rmax, ext * 1.6);":
        "        var f = [], N2 = 64, R = Math.min(r.rmax, ext * 1.6);\n" +
        "        var lift = R * Math.tan(Math.max(-80, Math.min(80, r.el || 0)) * DEG);",

      "          if (pz !== pz) pz = g.zmin;":
        "          if (pz !== pz) pz = g.zmin;\n" +
        "          pz += lift;",

      ["        V.seg(f, r.x, r.y, r.z, e0x, e0y, z0 === z0 ? z0 : g.zmin);\n" +
       "        V.seg(f, r.x, r.y, r.z, e1x, e1y, z1b === z1b ? z1b : g.zmin);"]:
        "        V.seg(f, r.x, r.y, r.z, e0x, e0y, (z0 === z0 ? z0 : g.zmin) + lift);\n" +
        "        V.seg(f, r.x, r.y, r.z, e1x, e1y, (z1b === z1b ? z1b : g.zmin) + lift);",
    },
  },
  {
    file: "index.html",
    map: {
      // Gridding resolution when Cell size is left blank. Upstream defaults to
      // 320, which is quick but averages benches into a smooth ramp on the pit
      // models used here; 1000 is upstream's own "detailed" figure and well
      // under the ~2.2 M node ceiling.
      'id="inpTarget" value="320"': 'id="inpTarget" value="1000"',
    },
  },
  {
    file: "js/ui/data.js",
    map: {
      // The fallback for an empty or unparseable field — same figure, so
      // clearing the box behaves like never having touched it.
      "parseInt($('inpTarget').value, 10) || 320":
        "parseInt($('inpTarget').value, 10) || 1000",
    },
  },
];

/* --------------------------------------------------------------- generation */

function tokenBlock(selector, index, note) {
  const lines = Object.entries(TOKENS).map(
    ([name, values]) => `  ${name}: ${values[index]};`
  );
  return `${note}\n${selector} {\n${lines.join("\n")}\n}\n`;
}

function themeStylesheet() {
  return (
    "/* GENERATED by scripts/sensitivity-patches.mjs — do not edit.\n" +
    "   Platform palette for the embedded sensitivity tool, in both themes.\n" +
    "   js/platform-theme.js decides which block applies. */\n\n" +
    tokenBlock(":root", 0, "/* light */") +
    "\n" +
    tokenBlock("html.dark", 1, "/* dark */")
  );
}

/* ------------------------------------------------------------ substitution */

const PLACEHOLDER = "/*__SM_PROTECTED__*/";

/** Replace every key of `map` in `text`, longest key first so #aabbcc22 wins
 *  over #aabbcc and a context match wins over a bare hex. */
function substitute(text, map) {
  const hits = {};
  for (const from of Object.keys(map).sort((a, b) => b.length - a.length)) {
    const parts = text.split(from);
    hits[from] = parts.length - 1;
    if (hits[from]) text = parts.join(map[from]);
  }
  return { text, hits };
}

/** Run one rule set over the synced files, accumulating into `tally`. */
async function applyRules(dest, rules, tally) {
  for (const rule of rules) {
    const path = join(dest, rule.file);
    const raw = await readFile(path, "utf8");

    // Upstream ships CRLF; normalise so multi-line keys can be written plainly.
    const crlf = raw.includes("\r\n");
    let text = crlf ? raw.replace(/\r\n/g, "\n") : raw;

    let fenced = null;
    if (rule.protect) {
      const m = text.match(rule.protect);
      if (!m) tally.missing.push(`${rule.file}: protected region not found`);
      else {
        fenced = m[0];
        text = text.replace(fenced, PLACEHOLDER);
      }
    }

    const { text: patched, hits } = substitute(text, rule.map);
    text = fenced ? patched.replace(PLACEHOLDER, fenced) : patched;

    for (const [from, n] of Object.entries(hits)) {
      if (n) tally.changed += n;
      else tally.missing.push(`${rule.file}: ${from.split("\n")[0].slice(0, 70)}`);
    }

    await writeFile(path, crlf ? text.replace(/\n/g, "\r\n") : text);
  }
}

/**
 * Apply every local adaptation to a freshly synced copy of the tool.
 * @param {string} dest directory holding index.html, css/ and js/
 * @returns {Promise<{changed: number, missing: string[]}>}
 */
export async function applyPatches(dest) {
  const tally = { changed: 0, missing: [] };

  await writeFile(join(dest, "css/platform-theme.css"), themeStylesheet());
  await copyFile(
    join(HERE, "sensitivity-platform-theme.js"),
    join(dest, "js/platform-theme.js")
  );

  await applyRules(dest, RULES, tally);
  await applyRules(dest, DEFAULT_RULES, tally);

  return tally;
}
