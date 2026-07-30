// Refresh public/sensitivity-tools from the upstream SensiMap clone.
//
// The tool ships as a dependency-free static app, so it is served straight out of
// public/ rather than ported to React. That means the runtime copy can drift from
// the clone — run this after `git pull` in the clone to re-sync:
//
//   npm run sync:sensitivity
//
// Point it elsewhere with SENSITIVITY_TOOLS_SRC=/path/to/clone.

import { cp, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";

const SRC = resolve(
  process.env.SENSITIVITY_TOOLS_SRC ?? "../sensitivity-tools/repo"
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

await rm(DEST, { recursive: true, force: true });
for (const asset of ASSETS) {
  await cp(join(SRC, asset), join(DEST, asset), { recursive: true });
}

console.log(`Synced ${ASSETS.join(", ")}\n  from ${SRC}\n  to   ${DEST}`);
