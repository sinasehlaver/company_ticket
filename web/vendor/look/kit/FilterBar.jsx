import { useRef, useState } from "react";
import { Popover, Menu } from "./Popover.jsx";
import { Checkbox } from "./Controls.jsx";
import { useT } from "./i18n.js";

// Picks: search + sort menu + a filter button whose badge counts active filters, plus an "N of M" count.
// For lists over ~50 items, put a facet sidebar (Checkbox groups) beside the list instead of the filter popover.
// filters: [{ id, label }], active: Set of ids. sorts: [{ id, label }].
export function FilterBar({ query, onQuery, sort, sorts, onSort, filters = [], active = new Set(), onToggle, shown, total }) {
  const t = useT();
  const sortBtn = useRef(null);
  const filterBtn = useRef(null);
  const [menu, setMenu] = useState(null);
  const close = () => setMenu(null);
  return (
    <div className="filterbar">
      <input className="input" type="search" value={query} placeholder={t("search")} aria-label={t("search")} onChange={(e) => onQuery(e.target.value)} />
      {sorts && (
        <button ref={sortBtn} type="button" className="btn" aria-expanded={menu === "sort"} onClick={() => setMenu(menu === "sort" ? null : "sort")}>
          {t("sort")}: {sorts.find((s) => s.id === sort)?.label} ▾
        </button>
      )}
      {filters.length > 0 && (
        <button ref={filterBtn} type="button" className="btn" aria-expanded={menu === "filter"} aria-label={t("filter")} data-tip={t("filter")} onClick={() => setMenu(menu === "filter" ? null : "filter")}>
          <span aria-hidden>⏷</span>{active.size > 0 && <span className="badge">{active.size}</span>}
        </button>
      )}
      {shown != null && <span className="muted nofm">{t("nOfM", { n: shown, m: total })}</span>}
      <Popover open={menu === "sort"} anchor={sortBtn.current} onClose={close}>
        <Menu items={sorts?.map((s) => ({ id: s.id, label: s.label, icon: s.id === sort ? "✓" : " ", run: () => onSort(s.id) })) ?? []} onClose={close} />
      </Popover>
      <Popover open={menu === "filter"} anchor={filterBtn.current} onClose={close}>
        <div className="menu">
          {filters.map((f) => (
            <label key={f.id} className="menu-item check-item">
              <Checkbox checked={active.has(f.id)} onChange={() => onToggle(f.id)} label={f.label} /><span>{f.label}</span>
            </label>
          ))}
        </div>
      </Popover>
    </div>
  );
}
