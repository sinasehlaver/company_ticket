// Hash routes (#/events/3). parentOf() gives the ← / Esc target of every non-root view.
import { useSyncExternalStore } from "react";

export const ROOTS = ["events", "halls", "logs", "report", "accounts"];
const read = () => location.hash.replace(/^#\/?/, "") || "events";
export function useRoute() {
  return useSyncExternalStore((f) => (addEventListener("hashchange", f), () => removeEventListener("hashchange", f)), read);
}
export const go = (route) => { location.hash = `/${route}`; };

/** "day/5" -> ["day", "5"] etc. */
export const split = (route) => route.split("/").filter(Boolean);

/** Parent route for back/Esc. `hint` lets a view name its real parent (a day knows its event). */
export function parentOf(route, hint) {
  if (hint) return hint;
  const [a, b, c] = split(route);
  if (!b) return null; // a root tab
  if (a === "events" && c) return `events/${b}`;
  if (a === "halls" && c) return `halls/${b}`;
  if (a === "day") return "events";
  return a;
}
