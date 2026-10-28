// Pure helpers behind the picker-style controls (Select, DatePicker, selection, "Mixed" inspector). Unit-tested.

// Calendar grid for one month, Monday first: leading nulls, then 1..n.
export function monthDays(year, month) {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const n = new Date(year, month + 1, 0).getDate();
  return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
}

export const shiftMonth = (year, month, by) => {
  const d = new Date(year, month + by, 1);
  return [d.getFullYear(), d.getMonth()];
};

// ISO date (YYYY-MM-DD) without timezone drift.
export const isoDate = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export function parseIso(s) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s || "");
  return m ? [+m[1], +m[2] - 1, m[3] ? +m[3] : 1] : null;
}

// Options are { value, label, desc? }. Every word of the query must appear in label or desc.
export function filterOptions(options, query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  return options.filter((o) => {
    const hay = `${o.label} ${o.desc || ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
// The Select shows a search field once a list is long enough to need it.
export const SEARCH_FROM = 8;

export const isHex = (s) => /^#[0-9a-f]{6}$/i.test(String(s || ""));

// Selection over an ordered id list. Plain click = only this; ⌘/Ctrl or a checkbox = toggle; ⇧ = range from anchor.
export function select(sel, ids, id, { toggle = false, range = false, anchor = null } = {}) {
  if (range && anchor != null && ids.includes(anchor)) {
    const [a, b] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
    return new Set(ids.slice(a, b + 1));
  }
  if (toggle) {
    const next = new Set(sel);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }
  return new Set([id]);
}

// Inspector over several items: the shared value, or MIXED when they differ (shown as a "Mixed" placeholder).
export const MIXED = Symbol("mixed");
export function shared(items, key) {
  if (!items.length) return undefined;
  const first = items[0][key];
  return items.every((it) => Object.is(it[key], first)) ? first : MIXED;
}

// The one-icon theme button: flips whatever is showing now (system resolves to the OS), Settings keeps the 3-way choice.
export const nextTheme = (pref, osDark) => ((pref === "system" ? (osDark ? "dark" : "light") : pref) === "dark" ? "light" : "dark");
