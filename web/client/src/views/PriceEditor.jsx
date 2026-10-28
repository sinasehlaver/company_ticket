import { useEffect, useRef, useState } from "react";
import { useT } from "look/kit/i18n.js";
import { applySchema, isPrice, rowHues, schemaText } from "../prices.js";

// Port of ticketsystem/templates/partials/price_editor.html: one number per row, coloured by tier, plus a "brush":
// type a price, then click or drag across row tiles to paint it. The schema line (a-f:75,g:60) can be pasted too.
// values: {row: string}. onChange(next values).
export function PriceEditor({ rows, values, onChange, invalid = [] }) {
  const t = useT();
  const [brush, setBrush] = useState("");
  const [schema, setSchema] = useState(() => schemaText(values));
  const painting = useRef(false);
  const vals = useRef(values);
  vals.current = values;
  useEffect(() => { if (document.activeElement?.dataset?.schema !== "1") setSchema(schemaText(values)); }, [values]);
  useEffect(() => {
    const up = () => { painting.current = false; };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, []);
  const hues = rowHues(values);
  const canPaint = isPrice(brush);
  const paint = (row) => {
    if (!row || vals.current[row] === String(Number(brush))) return;
    onChange({ ...vals.current, [row]: String(Number(brush)) });
  };
  const down = (e) => {
    if (!canPaint || e.target.tagName === "INPUT") return;
    const row = e.target.closest("[data-row]")?.dataset.row;
    if (!row) return;
    e.preventDefault();
    painting.current = true;
    paint(row);
  };
  const move = (e) => {
    if (!painting.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    paint(el?.closest?.("[data-row]")?.dataset.row);
  };
  const bad = new Set(invalid);
  return (
    <div className="price-editor">
      <div className="pe-tools">
        <label className="field-v pe-brush"><span>{t("brush")}</span>
          <input className="input" inputMode="numeric" placeholder="75" value={brush} onChange={(e) => setBrush(e.target.value.replace(/\D/g, "").slice(0, 5))} />
        </label>
        <p className="muted small pe-hint">{canPaint ? t("brushHint", { price: Number(brush) }) : t("brushOff")}</p>
      </div>
      <div className={`pe-grid${canPaint ? " is-painting" : ""}`} onPointerDown={down} onPointerMove={move}>
        {rows.map((r) => (
          <label key={r} data-row={r} className="pe-tile" aria-invalid={bad.has(r) || undefined}
            style={hues[r] != null ? { "--h": hues[r] } : undefined} data-tier={hues[r] != null || undefined}>
            <span className="pe-letter">{r.toLocaleUpperCase("en")}</span>
            <input className="pe-input" inputMode="numeric" aria-label={t("rowPrice", { row: r.toUpperCase() })} value={values[r] ?? ""}
              onChange={(e) => onChange({ ...values, [r]: e.target.value.replace(/\D/g, "").slice(0, 5) })} />
          </label>
        ))}
      </div>
      <label className="field-v"><span>{t("schema")}</span>
        <input className="input mono" data-schema="1" value={schema} placeholder="a-f:75,g-k:60" spellCheck={false}
          onChange={(e) => setSchema(e.target.value)}
          onBlur={() => { const next = applySchema(schema, rows); if (Object.keys(next).length) onChange({ ...values, ...next }); else setSchema(schemaText(values)); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} />
      </label>
    </div>
  );
}
