import { useEffect, useRef, useState } from "react";
import { useT } from "./i18n.js";

// ⌘K command palette. commands: [{ id, label, hint?, run }]. Fuzzy-ish: all words must appear in the label.
export function Palette({ open, onClose, commands }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef(null);
  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);
  if (!open) return null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = commands.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)));
  const run = (c) => { onClose(); c.run(); };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog palette" role="dialog" aria-modal="true" aria-label={t("palette")} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="input"
          placeholder={t("typeCommand")}
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter" && list[sel]) run(list[sel]);
          }}
        />
        <ul className="palette-list" role="listbox">
          {list.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === sel} className="palette-item" data-sel={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
              <span>{c.label}</span>
              {c.hint && <kbd>{c.hint}</kbd>}
            </li>
          ))}
          {!list.length && <li className="palette-empty">{t("noMatch")}</li>}
        </ul>
      </div>
    </div>
  );
}
