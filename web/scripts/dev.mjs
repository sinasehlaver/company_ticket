// npm run dev: API (node --watch server/index.js on :5140) + vite (:5141, proxies /api and /healthz to :5140).
// One Ctrl+C stops both; if either exits, the other is stopped too. Ports: .claude/ports.md (strictPort, 127.0.0.1).
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kids = [];
const run = (name, cmd, args, env = {}) => {
  const p = spawn(cmd, args, { cwd: web, stdio: "inherit", env: { ...process.env, ...env } });
  p.on("exit", (code, sig) => { console.log(`[dev] ${name} exited (${sig ?? code})`); stop(code ?? 1); });
  kids.push(p);
};
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of kids) if (p.exitCode === null) p.kill("SIGTERM");
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

run("server", process.execPath, ["--watch", "server/index.js"], { PORT: process.env.PORT || "5140" });
run("vite", process.execPath, [resolve(web, "node_modules/vite/bin/vite.js"), "--config", "client/vite.config.js"]);
