import { useRef, useState } from "react";
import { Popover } from "./Popover.jsx";
import { isHex } from "./pick-logic.js";
import { useT } from "./i18n.js";

export const SWATCHES = ["#5b9dff", "#e8705a", "#9b8cff", "#3cc6b4", "#f0a94e", "#ff6b9a", "#43b85c", "#8b909a"];

// Picks: one colour dot opens swatches (everyday). `advanced` adds an exact hex field: use it only in advanced settings.
export function ColorPicker({ value, onChange, label, advanced = false, swatches = SWATCHES }) {
  const t = useT();
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  const pick = (c) => { onChange(c); setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} type="button" className="color-dot" style={{ background: value }} aria-label={`${label}: ${value}`} data-tip={label} aria-expanded={open}
        onClick={() => { setHex(value); setOpen((o) => !o); }} />
      <Popover open={open} anchor={btn.current} onClose={() => setOpen(false)}>
        <div className="swatches" role="radiogroup" aria-label={label}>
          {swatches.map((c, i) => (
            <button key={c} type="button" role="radio" aria-checked={c === value} className="color-dot" style={{ background: c }} aria-label={c}
              ref={(el) => { if (el && (c === value || (!swatches.includes(value) && i === 0))) el.focus(); }} onClick={() => pick(c)} />
          ))}
        </div>
        {advanced && (
          <form className="hex-row" onSubmit={(e) => { e.preventDefault(); if (isHex(hex)) pick(hex.toLowerCase()); }}>
            <input className="input" value={hex} maxLength={7} aria-label={t("hex")} aria-invalid={!isHex(hex)} onChange={(e) => setHex(e.target.value.trim())} />
            <button className="btn btn-soft" disabled={!isHex(hex)}>OK</button>
          </form>
        )}
      </Popover>
    </>
  );
}
