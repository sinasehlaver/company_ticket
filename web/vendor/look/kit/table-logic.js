// Pure table logic (no React, no strings) so node --test can run it without react installed.

const empty = (v) => v == null || v === "" || (typeof v === "number" && Number.isNaN(v));

// New array, stable. Numbers numeric, strings natural-order localeCompare; empties last whatever the dir.
export function sortRows(rows, key, dir = "asc", getValue, locale) {
  const get = getValue || ((r) => r[key]);
  const sign = dir === "desc" ? -1 : 1;
  return rows
    .map((r, i) => ({ r, i, v: get(r, key) }))
    .sort((a, b) => {
      const ae = empty(a.v), be = empty(b.v);
      if (ae || be) return ae && be ? a.i - b.i : ae ? 1 : -1;
      let c;
      if (typeof a.v === "number" && typeof b.v === "number") c = a.v - b.v;
      else c = String(a.v).localeCompare(String(b.v), locale, { numeric: true, sensitivity: "base" });
      return c ? c * sign : a.i - b.i;
    })
    .map((x) => x.r);
}

// none -> asc -> desc -> none. sort = {key,dir} | null.
export function nextSort(sort, key) {
  if (!sort || sort.key !== key) return { key, dir: "asc" };
  return sort.dir === "asc" ? { key, dir: "desc" } : null;
}

// Click rules: plain = only id; meta/ctrl = toggle; shift = range anchor..id (added to sel when meta too).
export function selectClick(sel, ids, id, { shift = false, meta = false } = {}, anchor = null) {
  if (shift && anchor != null && ids.includes(anchor)) {
    const a = ids.indexOf(anchor), b = ids.indexOf(id);
    const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
    return { sel: new Set(meta ? [...sel, ...range] : range), anchor };
  }
  if (meta || shift) {
    const next = new Set(sel);
    next.has(id) ? next.delete(id) : next.add(id);
    return { sel: next, anchor: id };
  }
  return { sel: new Set([id]), anchor: id };
}

export const allState = (sel, ids) => {
  const n = ids.filter((id) => sel.has(id)).length;
  return n === 0 ? "none" : n === ids.length ? "all" : "some";
};
export const selectAll = (sel, ids) => (allState(sel, ids) === "all" ? new Set() : new Set(ids));

export const pruneSel = (sel, ids) => {
  const keep = new Set(ids);
  const next = new Set([...sel].filter((id) => keep.has(id)));
  return next.size === sel.size ? sel : next;
};

// Move the selected block up/down by one (clamped). Non-contiguous selections move as separate items, keeping relative order.
export function moveRow(ids, sel, delta) {
  const a = ids.slice();
  const step = delta < 0 ? -1 : 1;
  const idx = a.map((id, i) => (sel.has(id) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return a;
  const order = step < 0 ? idx : idx.slice().reverse();
  // blocked if the leading selected item is at the edge; items stack against it
  const taken = new Set();
  for (const i of order) {
    const to = i + step;
    if (to < 0 || to >= a.length || taken.has(to)) { taken.add(i); continue; }
    [a[i], a[to]] = [a[to], a[i]];
    taken.add(to);
  }
  return a;
}
