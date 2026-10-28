// Appearance = the picker's foundations (look.js). Defaults are the user's picks; an app's Settings can override any of
// them (prefs.look). Pure functions, no React/DOM, so node tests and the no-flash script share them.
import { LOOK } from "../look.js";

export const FOUNDATIONS = LOOK.foundations;
export const DEFAULTS = LOOK.defaults;

const valid = (attr, id) => FOUNDATIONS.some((f) => f.attr === attr && f.options.some((o) => o.id === id));

// prefs → the data-* values for <html>. theme "system" resolves to light/dark (tokens.css only knows those two).
// An override that no longer names a picker option (picker renamed it) falls back to the pick.
export function resolveLook(prefs = {}, osDark = false) {
  const out = {};
  for (const f of FOUNDATIONS) {
    const want = f.attr === "theme" ? prefs.theme : prefs.look?.[f.attr];
    out[f.attr] = valid(f.attr, want) ? want : DEFAULTS[f.attr];
  }
  if (out.theme === "system") out.theme = osDark ? "dark" : "light";
  return out;
}

// The inline <script> the vite plugin puts in <head>: same rules as resolveLook, before first paint.
export function noFlashScript(appId) {
  const opts = Object.fromEntries(FOUNDATIONS.map((f) => [f.attr, f.options.map((o) => o.id)]));
  return `(function(){try{var D=${JSON.stringify(DEFAULTS)},O=${JSON.stringify(opts)},p={};
try{p=JSON.parse(localStorage.getItem(${JSON.stringify(`${appId}:prefs`)})||"{}")||{}}catch(e){}
var r=document.documentElement,l=p.look||{};for(var a in D){var v=a==="theme"?p.theme:l[a];if(O[a].indexOf(v)<0)v=D[a];
if(a==="theme"&&v==="system")v=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";r.setAttribute("data-"+a,v)}}catch(e){}})();`;
}
