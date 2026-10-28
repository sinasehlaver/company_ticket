// Vite config for the React client (root = web/client, output = client/dist, served by server/app.js).
// `look` (the shared look package) resolves to the live workspace copy ../../../_look when it exists, else to the
// vendored copy ../vendor/look (Render has no _look; refresh it with scripts/vendor-look.sh).
// LOOK_DIR=vendor | live | <absolute path> forces one.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "./src/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const LIVE = resolve(here, "../../../_look");
const VENDOR = resolve(here, "../vendor/look");

function lookDir() {
  const want = process.env.LOOK_DIR;
  if (want === "vendor") return VENDOR;
  if (want === "live") return LIVE;
  if (want) return isAbsolute(want) ? want : resolve(process.cwd(), want);
  return existsSync(resolve(LIVE, "vite.js")) ? LIVE : VENDOR;
}

const LOOK = lookDir();
const { lookPlugin } = await import(pathToFileURL(resolve(LOOK, "vite.js")).href);
console.log(`look: ${LOOK === VENDOR ? "vendor" : LOOK === LIVE ? "live" : "custom"} (${LOOK})`);

export default defineConfig({
  root: here,
  base: "/",
  plugins: [react(), lookPlugin({ appId: config.appId })],
  resolve: { alias: [{ find: /^look\//, replacement: `${LOOK}/` }], dedupe: ["react", "react-dom"] },
  build: { outDir: resolve(here, "dist"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5141,
    strictPort: true,
    fs: { allow: [here, LOOK] },
    // Object form, not the string shorthand: the shorthand implies changeOrigin:true, which rewrites Host to :5140
    // while the browser's Origin stays :5141, so originCheck 403s every POST (login included) as "İstek kaynağı geçersiz".
    proxy: {
      "/api": { target: "http://127.0.0.1:5140", changeOrigin: false },
      "/healthz": { target: "http://127.0.0.1:5140", changeOrigin: false },
    },
  },
});
