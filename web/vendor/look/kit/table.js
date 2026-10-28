import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sortRows, nextSort, selectClick, allState, selectAll, pruneSel, moveRow } from "./table-logic.js";

// Text-free table behaviour: sort (view-only), selection, keyboard. Pure functions live in table-logic.js (re-exported).
export * from "./table-logic.js";

const editable = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);

export function useTable({ rows, getId, sortValue, locale, onDelete, onCopy, onCut, onPaste, onDuplicate, onMove, initialSort = null }) {
  const [sort, setSort] = useState(initialSort);
  const [sel, setSel] = useState(() => new Set());
  const anchor = useRef(null);
  const focus = useRef(null);

  const view = useMemo(() => (sort ? sortRows(rows, sort.key, sort.dir, sortValue, locale) : rows), [rows, sort, sortValue, locale]);
  const ids = useMemo(() => view.map(getId), [view, getId]);
  const sorted = !!sort;
  const canReorder = !sorted;

  useEffect(() => { setSel((s) => pruneSel(s, ids)); }, [ids]);

  const toggleSort = useCallback((key) => setSort((s) => nextSort(s, key)), []);
  const clearSort = useCallback(() => setSort(null), []);
  const clear = useCallback(() => { setSel(new Set()); anchor.current = null; }, []);

  const apply = (r) => { setSel(r.sel); anchor.current = r.anchor; focus.current = r.focus ?? focus.current; };
  const click = (e, id) => { focus.current = id; apply(selectClick(sel, ids, id, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey }, anchor.current)); };
  // Checkbox clicks toggle (like meta) unless shift.
  const checkbox = (e, id) => { focus.current = id; apply(selectClick(sel, ids, id, { shift: !!e?.shiftKey, meta: true }, anchor.current)); };

  const state = allState(sel, ids);
  const headerCheckbox = {
    checked: state === "all",
    indeterminate: state === "some",
    onChange: () => { setSel(selectAll(sel, ids)); anchor.current = null; },
  };

  const selected = () => ids.filter((id) => sel.has(id));

  const onKeyDown = (e) => {
    if (editable(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    const done = () => e.preventDefault();
    if (mod && k.toLowerCase() === "a") { done(); setSel(new Set(ids)); return; }
    if (k === "Escape") {
      if (sel.size) clear(); else if (sorted) clearSort();
      return;
    }
    if ((k === "Backspace" || k === "Delete") && sel.size && onDelete) { done(); onDelete(selected()); return; }
    if (mod && !e.altKey && sel.size) {
      const cb = { c: onCopy, x: onCut, d: onDuplicate }[k.toLowerCase()];
      if (cb) { done(); cb(selected()); return; }
    }
    if (mod && k.toLowerCase() === "v" && onPaste) { done(); onPaste(selected()); return; }
    if (e.altKey && (k === "ArrowUp" || k === "ArrowDown")) {
      done();
      if (canReorder && onMove && sel.size) onMove(moveRow(ids, sel, k === "ArrowUp" ? -1 : 1));
      return;
    }
    if ((k === "ArrowUp" || k === "ArrowDown") && !mod && ids.length) {
      done();
      const cur = focus.current != null ? ids.indexOf(focus.current) : -1;
      const to = cur < 0 ? (k === "ArrowUp" ? ids.length - 1 : 0) : Math.max(0, Math.min(ids.length - 1, cur + (k === "ArrowUp" ? -1 : 1)));
      const id = ids[to];
      focus.current = id;
      if (e.shiftKey) { if (anchor.current == null) anchor.current = ids[cur < 0 ? to : cur]; apply({ ...selectClick(sel, ids, id, { shift: true }, anchor.current), focus: id }); }
      else apply({ sel: new Set([id]), anchor: id, focus: id });
    }
  };

  return { view, ids, sort, setSort, toggleSort, clearSort, sorted, canReorder, sel, setSel, isSel: (id) => sel.has(id), click, checkbox, headerCheckbox, clear, onKeyDown, focusId: focus };
}
