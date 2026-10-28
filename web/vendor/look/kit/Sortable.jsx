import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "./i18n.js";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Reorder by drag (HTML5 DnD on the handle) or keyboard (Alt+↑/↓ on the handle). onMove(from, to) is a pure index move.
// render(item, { handle }) -> row content. variant "cards" = block rows (lists of cards), default = flex rows.
// leavingId plays the exit animation on that row; neighbours then glide into place (FLIP) once it is removed.
export function Sortable({ items, onMove, render, variant = "rows", leavingId }) {
  const t = useT();
  const from = useRef(null);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const ul = useRef(null);
  const tops = useRef(new Map());

  // FLIP: after every render, rows whose position changed animate from where they were to where they are.
  useLayoutEffect(() => {
    const next = new Map();
    for (const el of ul.current.children) {
      const top = el.getBoundingClientRect().top;
      const prev = tops.current.get(el.dataset.id);
      next.set(el.dataset.id, top);
      if (prev != null && Math.abs(prev - top) > 1 && !reduced()) {
        el.animate([{ transform: `translateY(${prev - top}px)` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.22,.61,.36,1)" });
      }
    }
    tops.current = next;
  });

  return (
    <ul className={`rows rows-${variant}`} ref={ul}>
      {items.map((it, i) => {
        const handle = (
          <button
            className="grip"
            draggable
            aria-label={t("reorder")}
            data-tip={t("reorder")}
            onDragStart={(e) => { from.current = i; setDrag(it.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
            onDragEnd={() => { from.current = null; setDrag(null); setOver(null); }}
            onKeyDown={(e) => {
              if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              const to = i + (e.key === "ArrowUp" ? -1 : 1);
              if (to >= 0 && to < items.length) onMove(i, to);
            }}
          >⋮⋮</button>
        );
        return (
          <li
            key={it.id}
            data-id={it.id}
            className={`row row-${variant}`}
            data-over={over === i && from.current !== i}
            data-dragging={drag === it.id}
            data-leaving={leavingId === it.id}
            onDragOver={(e) => { if (from.current != null) { e.preventDefault(); setOver(i); } }}
            onDrop={(e) => { e.preventDefault(); if (from.current != null && from.current !== i) onMove(from.current, i); from.current = null; setDrag(null); setOver(null); }}
          >
            {render(it, { handle })}
          </li>
        );
      })}
    </ul>
  );
}

export const moveIndex = (arr, from, to) => {
  const a = arr.slice();
  a.splice(to, 0, a.splice(from, 1)[0]);
  return a;
};
