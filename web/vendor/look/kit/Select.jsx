import { useRef, useState } from "react";
import { Popover } from "./Popover.jsx";
import { filterOptions, SEARCH_FROM } from "./pick-logic.js";
import { useT } from "./i18n.js";

// The one dropdown (never a native <select> popup). Picks: listbox with a tick + descriptions under options when given
// + a search field once the list is long (>= SEARCH_FROM, or search={true}). options: [{ value, label, desc? }].
export function Select({ value, options, onChange, label, search, width = 260 }) {
  const t = useT();
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const cur = options.find((o) => o.value === value);
  const showSearch = search ?? options.length >= SEARCH_FROM;
  const list = filterOptions(options, q);
  const close = () => { setOpen(false); setQ(""); };
  const choose = (o) => { onChange(o.value); close(); btn.current?.focus(); };
  const openIt = () => { setHi(Math.max(0, options.indexOf(cur))); setOpen(true); };
  const key = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter" && list[hi]) { e.preventDefault(); choose(list[hi]); }
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="input select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close() : openIt())}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); openIt(); } }}
      >
        <span className="ell">{cur?.label ?? "—"}</span><span className="select-caret" aria-hidden>▾</span>
      </button>
      <Popover open={open} anchor={btn.current} onClose={close} width={width}>
        <div onKeyDown={key}>
          {showSearch && <input className="input pop-search" autoFocus placeholder={t("search")} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} aria-label={t("search")} />}
          <ul className="listbox" role="listbox" aria-label={label} tabIndex={showSearch ? -1 : 0} ref={(el) => { if (el && !showSearch) el.focus(); }}>
            {list.map((o, i) => (
              <li key={o.value} role="option" aria-selected={o.value === value} data-hi={i === hi} className="option" onMouseEnter={() => setHi(i)} onClick={() => choose(o)}>
                <span className="option-text"><span>{o.label}</span>{o.desc && <span className="option-desc">{o.desc}</span>}</span>
                <span className="tick" aria-hidden>{o.value === value ? "✓" : ""}</span>
              </li>
            ))}
            {!list.length && <li className="option-empty">{t("noMatch")}</li>}
          </ul>
        </div>
      </Popover>
    </>
  );
}
