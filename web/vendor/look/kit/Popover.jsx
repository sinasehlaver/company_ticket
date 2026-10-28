import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A floating panel pinned to an anchor rect (or a point, for right-click). Portaled so no ancestor clips it,
// flips above / shifts left when there's no room, closes on outside pointerdown and Esc, returns focus to the trigger.
export function Popover({ open, anchor, point, onClose, children, className = "", width }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const el = ref.current;
    if (!el) return;
    const r = point ? { left: point.x, right: point.x, top: point.y, bottom: point.y } : anchor?.getBoundingClientRect();
    if (!r) return;
    const w = el.offsetWidth, h = el.offsetHeight, gap = point ? 0 : 6;
    let left = Math.min(r.left, innerWidth - w - 8);
    let top = r.bottom + gap;
    if (top + h > innerHeight - 8 && r.top - gap - h > 8) top = r.top - gap - h;
    setPos({ left: Math.max(8, left), top });
  }, [open, anchor, point]);
  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (!ref.current?.contains(e.target) && !anchor?.contains?.(e.target)) onClose(); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); anchor?.focus?.(); } };
    const away = () => onClose();
    addEventListener("pointerdown", down, true);
    addEventListener("keydown", key, true);
    addEventListener("resize", away);
    return () => { removeEventListener("pointerdown", down, true); removeEventListener("keydown", key, true); removeEventListener("resize", away); };
  }, [open, anchor, onClose]);
  if (!open) return null;
  return createPortal(
    <div ref={ref} className={`pop ${className}`} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }} data-ready={!!pos}>
      {children}
    </div>,
    document.body,
  );
}

// items: [{ id, label, kbd?, danger?, icon?, run }] or "-" for a separator.
export function Menu({ items, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector("button")?.focus(); }, []);
  const move = (e) => {
    const bs = [...ref.current.querySelectorAll("button")];
    const i = bs.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
  };
  return (
    <div className="menu" role="menu" ref={ref} onKeyDown={move}>
      {items.map((it, i) => it === "-" ? <hr key={i} /> : (
        <button key={it.id} role="menuitem" className={`menu-item${it.danger ? " danger" : ""}`} onClick={() => { onClose(); it.run(); }}>
          {it.icon && <span className="menu-icon" aria-hidden>{it.icon}</span>}
          <span className="menu-label">{it.label}</span>
          {it.kbd && <kbd>{it.kbd}</kbd>}
        </button>
      ))}
    </div>
  );
}

// Right-click (and ⇧F10 / the context-menu key) on any element opens `items` as a menu at the pointer.
// const ctx = useContextMenu(); <li onContextMenu={ctx.open(items)} onKeyDown={ctx.key(items)}>… {ctx.menu}
export function useContextMenu() {
  const [state, setState] = useState(null);
  const close = () => setState(null);
  return {
    open: (items) => (e) => { e.preventDefault(); setState({ items, point: { x: e.clientX, y: e.clientY } }); },
    key: (items) => (e) => {
      if (!((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu")) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      setState({ items, point: { x: r.left + 24, y: r.bottom } });
    },
    menu: (
      <Popover open={!!state} point={state?.point} onClose={close}>
        {state && <Menu items={state.items} onClose={close} />}
      </Popover>
    ),
  };
}
