import { useRef } from "react";
import { setCollapsed, setPrefs, usePrefs } from "./prefs.js";
import { useT } from "./i18n.js";

const ARROW = { left: ["‹", "›"], right: ["›", "‹"] };
const MIN = 180, MAX = 480, DEF = 240;

// Side panel. Picks: wide windows = collapse to a rail + a thick resize handle (wide hit area, thickens with accent on
// hover/drag, double-click resets); narrow windows (<720px, CSS) = an overlay drawer. Width animates; the body keeps
// its width so nothing reflows mid-animation. Width + collapsed are UI prefs (not undoable, not in the data file).
export function Panel({ id, side = "left", title, children }) {
  const t = useT();
  const p = usePrefs();
  const closed = !!p.collapsed[`panel:${id}`];
  const width = p.sizes?.[`panel:${id}`] ?? DEF;
  const [shut, open] = ARROW[side];
  const ref = useRef(null);
  const setWidth = (w) => setPrefs({ sizes: { ...p.sizes, [`panel:${id}`]: w } });
  const drag = (e) => {
    const h = e.currentTarget, el = ref.current, x0 = e.clientX, w0 = el.offsetWidth;
    h.setPointerCapture(e.pointerId);
    h.dataset.drag = "true";
    el.style.transition = "none";
    let w = w0;
    const move = (ev) => { w = Math.max(MIN, Math.min(MAX, w0 + (side === "left" ? 1 : -1) * (ev.clientX - x0))); el.style.setProperty("--panel-w", `${w}px`); };
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", () => {
      h.removeEventListener("pointermove", move);
      delete h.dataset.drag;
      el.style.transition = "";
      el.style.removeProperty("--panel-w");
      if (w !== w0) setWidth(w);
    }, { once: true });
  };
  const key = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const d = (e.key === "ArrowRight" ? 16 : -16) * (side === "left" ? 1 : -1);
    setWidth(Math.max(MIN, Math.min(MAX, width + d)));
  };
  return (
    <aside ref={ref} className={`panel panel-${side}`} data-collapsed={closed} aria-label={title} style={{ "--panel-w": `${width}px` }}>
      <button className="panel-toggle" aria-expanded={!closed} aria-label={`${closed ? t("expand") : t("collapse")}: ${title}`} data-tip={closed ? t("expand") : t("collapse")} onClick={() => setCollapsed(`panel:${id}`, !closed)}>
        {closed ? open : shut}
      </button>
      <div className="panel-body" aria-hidden={closed}>
        <h2 className="panel-title">{title}</h2>
        {children}
      </div>
      {!closed && (
        <div className="panel-rz" role="separator" aria-orientation="vertical" aria-label={t("resize")} aria-valuenow={width} aria-valuemin={MIN} aria-valuemax={MAX}
          tabIndex={0} data-tip={t("resizeTip")} onPointerDown={drag} onDoubleClick={() => setWidth(DEF)} onKeyDown={key} />
      )}
    </aside>
  );
}
