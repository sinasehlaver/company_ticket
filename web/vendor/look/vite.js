// lookPlugin({ appId }) for an app's vite.config.js:
// - injects the no-flash script into index.html <head> (picks + stored overrides + resolved system theme, before first
//   paint), so the appId lives only in src/config.js and here
// - dedupes react/react-dom: _look is a symlinked package outside the app, and without this its imports would find no
//   React (or a second one)
// - lets the dev server read files from _look
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { noFlashScript } from "./kit/appearance.js";

const lookDir = dirname(fileURLToPath(import.meta.url));

export function lookPlugin({ appId }) {
  if (!appId) throw new Error("lookPlugin: appId is required (same as src/config.js)");
  return {
    name: "look",
    config: () => ({
      resolve: { dedupe: ["react", "react-dom"] },
      server: { fs: { allow: [lookDir, "."] } },
    }),
    transformIndexHtml: () => [{ tag: "script", children: noFlashScript(appId), injectTo: "head-prepend" }],
  };
}
