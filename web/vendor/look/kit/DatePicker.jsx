import { useRef, useState } from "react";
import { Popover } from "./Popover.jsx";
import { isoDate, monthDays, parseIso, shiftMonth } from "./pick-logic.js";
import { usePrefs } from "./prefs.js";
import { useT } from "./i18n.js";

const fmt = (lang, opts, y, m, d = 1) => new Date(y, m, d).toLocaleDateString(lang, opts);

// Picks: a calendar popover for picking a day (value "YYYY-MM-DD") ...
export function DatePicker({ value, onChange, label }) {
  const { lang } = usePrefs();
  const t = useT();
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const now = new Date();
  const sel = parseIso(value);
  const [[y, m], setYm] = useState(sel ? [sel[0], sel[1]] : [now.getFullYear(), now.getMonth()]);
  const days = monthDays(y, m);
  const heads = Array.from({ length: 7 }, (_, i) => fmt(lang, { weekday: "narrow" }, 2024, 0, i + 1)); // 1 Jan 2024 = Monday
  const choose = (d) => { onChange(isoDate(y, m, d)); setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} type="button" className="input select-btn" aria-label={label} aria-expanded={open} onClick={() => { if (sel) setYm([sel[0], sel[1]]); setOpen((o) => !o); }}>
        <span>{sel ? fmt(lang, { day: "numeric", month: "short", year: "numeric" }, ...sel) : "—"}</span><span className="select-caret" aria-hidden>▾</span>
      </button>
      <Popover open={open} anchor={btn.current} onClose={() => setOpen(false)} width={256}>
        <div className="cal-head">
          <button type="button" className="btn btn-ghost btn-icon" aria-label={t("prev")} onClick={() => setYm(shiftMonth(y, m, -1))}>‹</button>
          <b>{fmt(lang, { month: "long", year: "numeric" }, y, m)}</b>
          <button type="button" className="btn btn-ghost btn-icon" aria-label={t("next")} onClick={() => setYm(shiftMonth(y, m, 1))}>›</button>
        </div>
        <div className="cal" role="grid">
          {heads.map((h, i) => <span key={`h${i}`} className="cal-h">{h}</span>)}
          {days.map((d, i) => d == null ? <span key={i} /> : (
            <button key={i} type="button" className="cal-d"
              aria-pressed={!!sel && sel[0] === y && sel[1] === m && sel[2] === d}
              data-today={now.getFullYear() === y && now.getMonth() === m && now.getDate() === d}
              onClick={() => choose(d)}>{d}</button>
          ))}
        </div>
        <div className="cal-foot"><button type="button" className="btn btn-ghost" onClick={() => { setYm([now.getFullYear(), now.getMonth()]); onChange(isoDate(now.getFullYear(), now.getMonth(), now.getDate())); setOpen(false); }}>{t("today")}</button></div>
      </Popover>
    </>
  );
}

// ... and a month grid for picking a month (value "YYYY-MM"). Replaces long date lists.
export function MonthPicker({ value, onChange, label }) {
  const { lang } = usePrefs();
  const t = useT();
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const sel = parseIso(value);
  const [y, setY] = useState(sel ? sel[0] : new Date().getFullYear());
  const choose = (mi) => { onChange(`${y}-${String(mi + 1).padStart(2, "0")}`); setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} type="button" className="input select-btn" aria-label={label} aria-expanded={open} onClick={() => { if (sel) setY(sel[0]); setOpen((o) => !o); }}>
        <span>{sel ? fmt(lang, { month: "short", year: "numeric" }, sel[0], sel[1]) : "—"}</span><span className="select-caret" aria-hidden>▾</span>
      </button>
      <Popover open={open} anchor={btn.current} onClose={() => setOpen(false)} width={240}>
        <div className="cal-head">
          <button type="button" className="btn btn-ghost btn-icon" aria-label={t("prev")} onClick={() => setY(y - 1)}>‹</button>
          <b>{y}</b>
          <button type="button" className="btn btn-ghost btn-icon" aria-label={t("next")} onClick={() => setY(y + 1)}>›</button>
        </div>
        <div className="mgrid">
          {Array.from({ length: 12 }, (_, mi) => (
            <button key={mi} type="button" className="btn btn-ghost" aria-pressed={!!sel && sel[0] === y && sel[1] === mi} onClick={() => choose(mi)}>{fmt(lang, { month: "short" }, y, mi)}</button>
          ))}
        </div>
      </Popover>
    </>
  );
}
