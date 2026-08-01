// Refresh public/sensitivity-tools from the upstream SensiMap clone, then
// re-apply the platform's local adaptations.
//
// The tool ships as a dependency-free static app, so it is served straight out of
// public/ rather than ported to React. That means the runtime copy can drift from
// the clone — run this after `git pull` in the clone to re-sync:
//
//   npm run sync:sensitivity
//
// The copy is verbatim, so the platform palette and defaults are re-applied
// afterwards from scripts/sensitivity-patches.mjs, which also drops in
// css/platform-theme.css and js/platform-theme.js (neither exists upstream).
// Never hand-edit public/sensitivity-tools — add to the patch map instead, or
// the next sync throws the edit away.
//
// Point it elsewhere with SENSITIVITY_TOOLS_SRC=/path/to/clone.

import { cp, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { applyPatches } from "./sensitivity-patches.mjs";

const SRC = resolve(
  process.env.SENSITIVITY_TOOLS_SRC ?? "../sensitivity-tools/Sensitivity_tools"
);
const DEST = resolve("public/sensitivity-tools");

// Only the runtime assets — README and tests stay in the clone.
const ASSETS = ["index.html", "css", "js"];

for (const asset of ASSETS) {
  try {
    await access(join(SRC, asset));
  } catch {
    console.error(
      `Missing ${asset} in ${SRC}\n` +
        `Set SENSITIVITY_TOOLS_SRC to the SensiMap clone directory.`
    );
    process.exit(1);
  }
}

// Clear the assets rather than DEST itself — on Windows a dev server watching
// public/ holds a handle on the directory and rmdir on the root fails EBUSY.
for (const asset of ASSETS) {
  await rm(join(DEST, asset), { recursive: true, force: true });
  await cp(join(SRC, asset), join(DEST, asset), { recursive: true });
}

console.log(`Synced ${ASSETS.join(", ")}\n  from ${SRC}\n  to   ${DEST}`);

const { changed, missing } = await applyPatches(DEST);
console.log(`Patched ${changed} references to the platform palette and defaults`);

// Something the patch set expects but cannot find means upstream renamed or
// dropped it — that part of the build is now unpatched, so say so rather than
// fail quietly.
if (missing.length) {
  console.warn(
    `\n${missing.length} patch entr${missing.length === 1 ? "y" : "ies"} matched nothing — ` +
      `upstream may have changed these:\n  ${missing.join("\n  ")}\n` +
      `Update scripts/sensitivity-patches.mjs.`
  );
}
