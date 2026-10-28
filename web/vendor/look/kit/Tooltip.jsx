import { useEffect, useState } from "react";

// One tooltip for the whole app (mount once). Any element with data-tip="Undo  ⌘Z" gets a delayed (300ms) tip that
// wraps onto several lines, stays inside the window and flips below near the top. Elements with class "ell" that are
// cut off by an ellipsis show their full text. Tips name the shortcut; build them with tip() from one shortcut table.
export function Tooltip() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    let timer, cur;
    const hide = () => { clearTimeout(timer); cur = null; setTip(null); };
    const textOf = (el) => el.dataset.tip || (el.classList.contains("ell") && el.scrollWidth > el.clientWidth ? el.textContent : "");
    const show = (el) => {
      const text = textOf(el);
      if (!text) return;
      cur = el;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (cur !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setTip({ text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
      }, 300);
    };
    const over = (e) => {
      const el = e.target.closest?.("[data-tip], .ell");
      if (el === cur) return;
      hide();
      if (el) show(el);
    };
    const focus = (e) => { if (e.target.matches?.(":focus-visible")) { const el = e.target.closest("[data-tip], .ell"); if (el) show(el); } };
    addEventListener("pointerover", over);
    addEventListener("focusin", focus);
    addEventListener("focusout", hide);
    addEventListener("pointerdown", hide, true);
    addEventListener("scroll", hide, true);
    addEventListener("keydown", hide, true);
    return () => {
      clearTimeout(timer);
      removeEventListener("pointerover", over); removeEventListener("focusin", focus); removeEventListener("focusout", hide);
      removeEventListener("pointerdown", hide, true); removeEventListener("scroll", hide, true); removeEventListener("keydown", hide, true);
    };
  }, []);
  if (!tip) return null;
  const below = tip.top < 60;
  return (
    <div
      className="tooltip"
      role="tooltip"
      data-below={below}
      style={{ left: Math.min(Math.max(tip.x, 136), innerWidth - 136), top: below ? tip.bottom + 6 : tip.top - 6 }}
    >
      {tip.text}
    </div>
  );
}

// "Undo" + "mod+z" -> "Undo  ⌘Z". One place turns shortcut ids into labels, so tips and the cheat-sheet agree.
const MAC = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform);
export function keyLabel(combo) {
  return combo.split("+").map((k) => ({ mod: MAC ? "⌘" : "Ctrl+", shift: "⇧", alt: MAC ? "⌥" : "Alt+", escape: "Esc", arrowup: "↑", arrowdown: "↓", backspace: "⌫", delete: "⌫" }[k] ?? k.toUpperCase())).join("");
}
export const tip = (label, combo) => (combo ? `${label}  ${keyLabel(combo)}` : label);
