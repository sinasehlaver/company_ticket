import { useSyncExternalStore } from "react";
import { app } from "./app.js";
import { DEFAULTS, resolveLook } from "./appearance.js";

// UI preferences (theme, appearance overrides, language, collapsed panels/lists, pane sizes). Not undoable, not part of
// the data file. Stored per app under `<appId>:prefs`; read on initPrefs() (setupLook calls it) so appId is known.
const key = () => `${app.appId}:prefs`;
const defaults = () => ({ theme: DEFAULTS.theme, look: {}, lang: app.languages[0] || "en", collapsed: {}, sizes: {} });
const subs = new Set();
const osDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

function read() {
  try {
    return { ...defaults(), ...JSON.parse(localStorage.getItem(key()) || "{}") };
  } catch {
    return { ...defaults() };
  }
}
let state = defaults();
let watching = false;

export function initPrefs() {
  state = read();
  // theme "system" follows the OS live
  if (!watching && typeof matchMedia === "function") {
    watching = true;
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => state.theme === "system" && applyPrefs());
  }
}

export function applyPrefs(p = state) {
  const root = document.documentElement;
  for (const [attr, v] of Object.entries(resolveLook(p, osDark()))) root.setAttribute(`data-${attr}`, v);
  root.lang = p.lang;
}

export function setPrefs(patch) {
  // a theme/appearance switch cross-fades colours instead of snapping (class is removed again after 300ms)
  if (("theme" in patch || "look" in patch) && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const root = document.documentElement;
    root.classList.add("theme-anim");
    setTimeout(() => root.classList.remove("theme-anim"), 300);
  }
  state = { ...state, ...patch };
  try {
    localStorage.setItem(key(), JSON.stringify(state));
  } catch {}
  applyPrefs();
  subs.forEach((f) => f());
}

// one Appearance override; value undefined = back to the user's pick
export function setLook(attr, value) {
  const look = { ...state.look, [attr]: value };
  if (value === undefined) delete look[attr];
  setPrefs({ look });
}

export function setCollapsed(id, value) {
  setPrefs({ collapsed: { ...state.collapsed, [id]: value } });
}

export function usePrefs() {
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state);
}
