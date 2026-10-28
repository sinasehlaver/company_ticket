import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "look/kit/i18n.js";
import { money, seatLabel } from "../format.js";

// Django-style seat map: one coloured band per row (hue = price tier), price outside the band on both sides, the row letter on both
// sides inside it, "-" rows as aisles, "-1" as gaps, "SAHNE" below. layout = buildLayout(...). onSeat(cell, row) or null (preview).
// fit: scale the whole map down to the container width ("Sığdır"; the day page opens at real size everywhere).
// onSeat(cell, row, buttonEl) through one delegated click.
export function SeatMap({ layout, onSeat, boss = false, fit = true, pending }) {
  const t = useT();
  const box = useRef(null);
  const inner = useRef(null);
  const [scale, setScale] = useState(1);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      if (!box.current || !inner.current) return;
      const w = inner.current.offsetWidth, h = inner.current.offsetHeight; // layout size, unaffected by transforms
      setNatural({ w, h });
      setScale(fit && w ? Math.min(1, box.current.clientWidth / w) : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box.current);
    ro.observe(inner.current);
    return () => ro.disconnect();
  }, [fit, layout.width]);
  const label = (c, row) => {
    const name = seatLabel(row.row, c.num);
    if (c.status === "sold") return `${name} · ${t("legendSold")}`;
    if (c.status === "mine") return `${name} · ${t("legendMine")}`;
    if (c.status === "other") return `${name} · ${boss && c.holder ? t("heldBy", { name: c.holder }) : t("legendOther")}`;
    return `${name} · ${money(c.price)}`;
  };
  // One delegated click handler (no closure per seat); the latest onSeat/layout are read through refs so the
  // memoized <Seat>s never re-render for a new handler, only when their own primitive props change.
  const live = useRef({ onSeat, byId: null });
  const byId = useMemo(() => {
    const m = new Map();
    for (const r of layout.rows) if (r.cells) for (const c of r.cells) if (!c.gap && c.id != null) m.set(String(c.id), [c, r]);
    return m;
  }, [layout]);
  live.current = { onSeat, byId };
  const click = useCallback((e) => {
    const b = e.target.closest?.("button.seat");
    const hit = b && live.current.byId.get(b.dataset.id);
    if (hit) live.current.onSeat?.(hit[0], hit[1], b);
  }, []);
  return (
    <div className={`seatmap-box${fit ? " is-fit" : ""}`} ref={box}>
      <div className="seatmap-sizer" style={{ width: natural.w * scale || undefined, height: natural.h * scale || undefined }}>
        <div className="seatmap" ref={inner} onClick={onSeat ? click : undefined} style={{ "--cols": layout.width, transform: scale < 1 ? `scale(${scale})` : undefined }}>
          {layout.rows.map((r) => r.type === "aisle" ? <div key={r.key} className="sm-aisle" aria-hidden /> : (
            <div key={r.key} className="sm-row" style={r.hue != null ? { "--h": r.hue } : undefined} data-tier={r.hue != null || undefined}>
              <span className="sm-price sm-price-l">{r.price != null ? money(r.price) : "—"}</span>
              <div className="sm-band">
              <span className="sm-letter">{r.row.toUpperCase()}</span>
              <span className="sm-walk" aria-hidden />
              {r.cells.map((c, i) => c.gap ? <span key={`g${i}`} className="sm-gap" aria-hidden /> : onSeat ? (
                <Seat key={c.num} id={c.id} num={c.num} name={seatLabel(r.row, c.num)} status={c.status} label={label(c, r)} pending={!!pending?.has(c.id)} />
              ) : <span key={c.num} className="seat" data-s="free" data-tip={label(c, r)}>{c.num}</span>)}
              <span className="sm-walk" aria-hidden />
              <span className="sm-letter">{r.row.toUpperCase()}</span>
              </div>
              <span className="sm-price sm-price-r">{r.price != null ? money(r.price) : "—"}</span>
            </div>
          ))}
          <div className="sm-stage">{t("stage")}</div>
        </div>
      </div>
    </div>
  );
}

// Primitive props only, so memo() skips every seat whose status/label/pending didn't change.
const Seat = memo(function Seat({ id, num, name, status, label, pending }) {
  return (
    <button type="button" className="seat" data-id={id} data-seat={name} data-s={status} data-pending={pending || undefined}
      disabled={status === "missing"} aria-label={label} data-tip={label} aria-pressed={status === "mine"}>{num}</button>
  );
});

export function Legend({ counts, boss }) {
  const t = useT();
  const items = [["free", "legendFree"], ["mine", "legendMine"], ["other", boss ? "legendOtherBoss" : "legendOther"], ["sold", "legendSold"]];
  return (
    <ul className="legend" aria-label={t("legend")}>
      {items.map(([s, k]) => <li key={s}><span className="seat seat-sw" data-s={s} aria-hidden />{t(k)}{counts && <b className="legend-n">{counts[s]}</b>}</li>)}
    </ul>
  );
}
