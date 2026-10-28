import { useRef, useState } from "react";
import { useT } from "./i18n.js";
import { Checkbox } from "./Controls.jsx";
import { useContextMenu } from "./Popover.jsx";
import { useTable } from "./table.js";
import { moveIndex } from "./Sortable.jsx";

// Classic table: select (click, ⌘, ⇧, checkbox), sort (view-only), drag / Alt+↑↓ reorder, bulk bar, right-click menu.
// columns: [{ key, label, width?, sortable?, render?(row) }]. onMove(newIdOrder). rowMenu(row) -> Menu items.
export function Table({ columns, rows, getId, onMove, onDelete, onCopy, onCut, onPaste, onDuplicate, rowMenu, locale, sortValue }) {
  const t = useT();
  const tb = useTable({ rows, getId, sortValue, locale, onDelete, onCopy, onCut, onPaste, onDuplicate, onMove });
  const ctx = useContextMenu();
  const from = useRef(null);
  const [over, setOver] = useState(null);
  const [drag, setDrag] = useState(null);
  const reorder = !!onMove;
  const drop = (toId) => {
    const f = from.current;
    from.current = null; setDrag(null); setOver(null);
    if (f == null || f === toId) return;
    // dragging a selected row carries the whole selection
    const moving = tb.sel.has(f) ? tb.ids.filter((id) => tb.sel.has(id)) : [f];
    if (moving.length === 1) return onMove(moveIndex(tb.ids, tb.ids.indexOf(f), tb.ids.indexOf(toId)));
    if (moving.includes(toId)) return;
    const rest = tb.ids.filter((id) => !moving.includes(id));
    const at = rest.indexOf(toId);
    const after = tb.ids.indexOf(toId) > tb.ids.indexOf(moving[0]);
    rest.splice(at + (after ? 1 : 0), 0, ...moving);
    onMove(rest);
  };
  const n = tb.sel.size;
  const sortTip = t("tableSortedNoReorder");

  return (
    <div className="ktable-wrap" onKeyDown={tb.onKeyDown}>
      {tb.sorted && (
        <button type="button" className="ktable-chip" onClick={tb.clearSort}>↺ {t("tableClearSort")}</button>
      )}
      <table className="ktable" role="grid" aria-multiselectable="true">
        <thead>
          <tr>
            <th className="ktable-cb"><Checkbox checked={tb.headerCheckbox.checked} indeterminate={tb.headerCheckbox.indeterminate} onChange={tb.headerCheckbox.onChange} label={t("selectAll")} /></th>
            {reorder && <th className="ktable-grip" aria-hidden />}
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined}
                aria-sort={tb.sort?.key === c.key ? (tb.sort.dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined}>
                {c.sortable ? (
                  <button type="button" className="ktable-sort" onClick={() => tb.toggleSort(c.key)}>
                    <span className="ell">{c.label}</span>
                    <span className="ktable-arrow" aria-hidden>{tb.sort?.key === c.key ? (tb.sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                ) : <span className="ell">{c.label}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tb.view.map((row) => {
            const id = getId(row);
            const items = rowMenu?.(row);
            return (
              <tr key={id} tabIndex={0} aria-selected={tb.isSel(id)} data-selected={tb.isSel(id)} data-id={id}
                data-over={over === id && from.current !== id} data-dragging={drag === id}
                onClick={(e) => tb.click(e, id)}
                onContextMenu={items ? (e) => { if (!tb.isSel(id)) tb.click({}, id); ctx.open(items)(e); } : undefined}
                onKeyDown={items ? ctx.key(items) : undefined}
                onDragOver={reorder ? (e) => { if (from.current != null) { e.preventDefault(); setOver(id); } } : undefined}
                onDrop={reorder ? (e) => { e.preventDefault(); drop(id); } : undefined}>
                <td className="ktable-cb"><Checkbox checked={tb.isSel(id)} onChange={(_, e) => tb.checkbox(e, id)} label={t("selectAll")} /></td>
                {reorder && (
                  <td className="ktable-grip" data-tip={tb.canReorder ? undefined : sortTip}>
                    <button type="button" className="grip" draggable={tb.canReorder} disabled={!tb.canReorder} tabIndex={-1}
                      aria-label={t("reorder")} data-tip={tb.canReorder ? t("reorder") : undefined}
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => { from.current = id; setDrag(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(id)); }}
                      onDragEnd={() => { from.current = null; setDrag(null); setOver(null); }}>⋮⋮</button>
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key}><span className="ell" data-tip={c.render ? undefined : String(row[c.key] ?? "")}>{c.render ? c.render(row) : row[c.key]}</span></td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {n > 0 && (
        <div className="bulkbar" role="toolbar">
          <span>{t("selected", { n })}</span>
          {onDuplicate && <button type="button" className="btn btn-ghost" onClick={() => onDuplicate([...tb.sel])}>{t("duplicate")}</button>}
          {onDelete && <button type="button" className="btn btn-ghost" onClick={() => onDelete([...tb.sel])}>{t("delete")}</button>}
          <button type="button" className="btn btn-ghost" onClick={tb.clear}>{t("clearSel")}</button>
        </div>
      )}
      {ctx.menu}
    </div>
  );
}
