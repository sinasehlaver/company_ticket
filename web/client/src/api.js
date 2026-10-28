// The one fetch wrapper. JSON in/out, same-origin cookie session, X-CSRF-Token on every non-GET, 204 -> null.
// A 401 anywhere (except the login call itself) fires onUnauthorized listeners -> App drops back to Login.
// Errors throw ApiError {status, message (server's Turkish text), body (e.g. 409 {error, state})}.
import { translate } from "look/kit/strings.js";

let csrf = "";
export const setCsrf = (token) => { csrf = token || ""; };

const unauth = new Set();
export const onUnauthorized = (fn) => (unauth.add(fn), () => unauth.delete(fn));

export class ApiError extends Error {
  constructor(message, status, body) { super(message); this.name = "ApiError"; this.status = status; this.body = body; }
}
const lang = () => (typeof document !== "undefined" && document.documentElement.lang) || "tr";

export async function api(method, path, body) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = csrf;
  let res;
  try {
    res = await fetch(path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(translate(lang(), "offline"), 0, null);
  }
  if (res.status === 204) return null;
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON (proxy error page) */ }
  if (res.status === 401 && path !== "/api/login") unauth.forEach((f) => f());
  if (!res.ok) throw new ApiError(data?.error || translate(lang(), "error"), res.status, data);
  return data;
}

export const get = (path) => api("GET", path);
export const post = (path, body = {}) => api("POST", path, body);
export const put = (path, body = {}) => api("PUT", path, body);
export const del = (path, body = {}) => api("DELETE", path, body);

const fail = async (res) => {
  let data = null;
  try { data = await res.json(); } catch { /* binary or empty */ }
  if (res.status === 401) unauth.forEach((f) => f());
  return new ApiError(data?.error || translate(lang(), "error"), res.status, data);
};

/** Raw file upload (the backup import): body is the File itself, JSON answer. */
export async function upload(path, file) {
  let res;
  try {
    res = await fetch(path, { method: "POST", credentials: "same-origin", body: file,
      headers: { Accept: "application/json", "Content-Type": "application/octet-stream", "X-CSRF-Token": csrf } });
  } catch { throw new ApiError(translate(lang(), "offline"), 0, null); }
  if (!res.ok) throw await fail(res);
  return res.json();
}

/** GET a file and hand it to the browser as a download (name from Content-Disposition). Resolves {name, size}. */
export async function download(path) {
  let res;
  try { res = await fetch(path, { credentials: "same-origin" }); } catch { throw new ApiError(translate(lang(), "offline"), 0, null); }
  if (!res.ok) throw await fail(res);
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "company-ticket.db";
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { name, size: blob.size };
}
