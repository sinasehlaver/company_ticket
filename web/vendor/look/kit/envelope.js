// Versioned envelope shared by localStorage autosave and file save/open. Untrusted input: size-capped,
// shape-checked, app-id-checked, never eval'd.
export const MAX_BYTES = 5 * 1024 * 1024;

export function wrap(app, version, data) {
  return { app, version, savedAt: new Date().toISOString(), data };
}

export function parseEnvelope(text, { app, version, migrate }) {
  if (typeof text !== "string" || text.length > MAX_BYTES) throw new Error("file too large");
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    throw new Error("not valid JSON");
  }
  if (!env || typeof env !== "object" || Array.isArray(env)) throw new Error("not an app file");
  if (env.app !== app) throw new Error("file belongs to a different app");
  if (!Number.isInteger(env.version) || env.version < 1) throw new Error("bad version");
  if (env.version > version) throw new Error("file is from a newer app version");
  if (env.data === null || typeof env.data !== "object") throw new Error("missing data");
  return migrate ? migrate(env.data, env.version) : env.data;
}

export function fileName(app) {
  return `${app}-${new Date().toISOString().slice(0, 10)}.json`;
}
