import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dict } from "./strings.js";

const here = fileURLToPath(new URL(".", import.meta.url));

test("TR and EN have the same keys, none empty", () => {
  assert.deepEqual(Object.keys(dict.en).sort(), Object.keys(dict.tr).sort());
  for (const lang of ["tr", "en"]) for (const [k, v] of Object.entries(dict[lang])) assert.ok(String(v).trim(), `${lang}.${k} empty`);
});

test("placeholders match between languages", () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const k of Object.keys(dict.tr)) assert.equal(vars(dict.en[k]), vars(dict.tr[k]), k);
});

function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(jsx?|css)$/.test(f) && !f.endsWith(".test.js")) yield p;
  }
}
const KIT = ["cancel", "delete", "search", "rename", "save", "settings", "back", "theme", "system", "light", "dark", "language", "palette", "shortcuts"];

test("every literal t(\"key\") used by the client exists (app dict or kit)", () => {
  const known = new Set([...Object.keys(dict.tr), ...KIT]);
  const missing = [];
  for (const f of files(here)) {
    for (const m of readFileSync(f, "utf8").matchAll(/\bt\("([A-Za-z_]+)"/g)) if (!known.has(m[1])) missing.push(`${m[1]} (${f})`);
  }
  assert.deepEqual(missing, []);
});

test("no browser primitives, no CSS uppercase (Turkish i/İ)", () => {
  for (const f of files(here)) {
    const s = readFileSync(f, "utf8");
    assert.ok(!/(window\.|\b)(alert|prompt)\(|window\.confirm\(|(^|[^.\w])confirm\(/m.test(s), `primitive in ${f}`);
    assert.ok(!/text-transform\s*:\s*(uppercase|capitalize)/.test(s), `uppercase in ${f}`);
  }
});
