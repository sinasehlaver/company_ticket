import { useState } from "react";
import { setCollapsed, usePrefs } from "./prefs.js";
import { useT } from "./i18n.js";

// A list/section whose title is the toggle. Picks: variant "card" (top-level page sections: bold title, count, chevron
// on the right, used inside a .card) or "chevron" (lists inside a panel or card: chevron left + count). onRename adds a ✎ button that swaps the title for an input.
// `actions` stay clickable and don't toggle. Collapsed state persists per id. The body stays mounted so the
// height can animate (grid 1fr -> 0fr); CSS also makes it invisible/unfocusable when closed.
export function Collapsible({ id, title, count, onRename, actions, children, variant = "chevron" }) {
  const t = useT();
  const closed = !!usePrefs().collapsed[`list:${id}`];
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(title);
  const done = (commit) => { setEditing(false); if (commit && v.trim() && v.trim() !== title) onRename(v.trim()); };
  return (
    <section className={`section section-${variant}`} data-collapsed={closed}>
      <header className="section-head">
        {editing ? (
          <input className="input" autoFocus value={v} aria-label={t("edit")} onChange={(e) => setV(e.target.value)} onBlur={() => done(true)} onKeyDown={(e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") { e.stopPropagation(); done(false); } }} />
        ) : (
          <button className="section-title" aria-expanded={!closed} onClick={() => setCollapsed(`list:${id}`, !closed)}>
            {variant === "chevron" && <span className="chev" aria-hidden>▾</span>}
            <span className="ell">{title}</span>
            {count != null && <span className="count">{count}</span>}
            {variant === "card" && <span className="chev chev-end" aria-hidden>▾</span>}
          </button>
        )}
        <span className="spacer" />
        {onRename && !editing && <button className="btn btn-ghost btn-icon" aria-label={t("edit")} data-tip={t("edit")} onClick={() => { setV(title); setEditing(true); }}>✎</button>}
        {actions}
      </header>
      <div className="collapse" aria-hidden={closed}>
        <div className="section-body">{children}</div>
      </div>
    </section>
  );
}
