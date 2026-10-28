// web/vendor/look is the committed copy of the workspace _look package (Render has no _look). When the live copy exists,
// compare them: a stale vendor copy only warns (refresh with scripts/vendor-look.sh), a missing file fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const VENDOR = fileURLToPath(new URL("../../vendor/look", import.meta.url));
const LIVE = fileURLToPath(new URL("../../../../_look", import.meta.url));

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p); else yield p;
  }
}

test("vendor/look has what the client imports", () => {
  for (const f of ["tokens.css", "kit.css", "look.js", "vite.js", "kit/setup.js", "kit/Dialog.jsx"]) assert.ok(existsSync(join(VENDOR, f)), f);
});

test("vendor/look matches the live _look (warns when stale)", { skip: !existsSync(join(LIVE, "vite.js")) && "no live _look here" }, () => {
  const stale = [];
  for (const p of walk(VENDOR)) {
    const rel = relative(VENDOR, p);
    const live = join(LIVE, rel);
    if (!existsSync(live)) stale.push(`${rel} (gone from _look)`);
    else if (!readFileSync(live).equals(readFileSync(p))) stale.push(rel);
  }
  for (const p of walk(join(LIVE, "kit"))) {
    const rel = relative(LIVE, p);
    if (!rel.endsWith(".test.js") && !existsSync(join(VENDOR, rel))) stale.push(`${rel} (not vendored)`);
  }
  if (stale.length) console.warn(`vendor/look is stale, run scripts/vendor-look.sh:\n  ${stale.join("\n  ")}`);
});
