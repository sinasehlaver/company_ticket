import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "look/kit/i18n.js";
import { money } from "../format.js";

// Day re-pricing when held or sold seats would change: one keep/apply choice per group ("Eski fiyatı koru" is the
// default). preview = server /prices/preview {free, held, sold, soldOld, soldNew}. Resolves {held, sold} or null.
let current = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export function repriceChoice(preview) {
  return new Promise((resolve) => {
    current?.resolve(null);
    current = { preview, resolve };
    emit();
  });
}
const finish = (v) => { const c = current; current = null; emit(); c?.resolve(v); };

export function RepriceHost() {
  const d = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => current);
  return d ? <RepriceDialog p={d.preview} /> : null;
}

const OPTS = ["keep", "apply"];

function Choice({ name, value, onChange, label }) {
  const t = useT();
  const i = OPTS.indexOf(value);
  const key = (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault(); onChange(OPTS[1 - i]);
    e.currentTarget.querySelector(`[data-v="${OPTS[1 - i]}"]`)?.focus();
  };
  return (
    <div className="seg reprice-seg" role="radiogroup" aria-label={label} data-group={name} style={{ "--n": 2, "--i": i }} onKeyDown={key}>
      <span className="seg-thumb" aria-hidden />
      {OPTS.map((v) => (
        <button key={v} type="button" role="radio" className="seg-btn" data-v={v} aria-checked={value === v} tabIndex={value === v ? 0 : -1}
          onClick={() => onChange(v)}>{t(v === "keep" ? "keepOldPrice" : "applyNewPrice")}</button>
      ))}
    </div>
  );
}

function RepriceDialog({ p }) {
  const t = useT();
  const [held, setHeld] = useState("keep");
  const [sold, setSold] = useState("keep");
  const ok = useRef(null);
  const back = useRef(document.activeElement);
  useEffect(() => { setTimeout(() => ok.current?.focus(), 0); const b = back.current; return () => b?.focus?.(); }, []);
  const delta = p.soldNew - p.soldOld;
  return (
    <div className="overlay overlay-center" onMouseDown={() => finish(null)}>
      <form className="dialog dialog-confirm reprice-dialog" role="dialog" aria-modal="true" aria-labelledby="rdlg-title"
        onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); finish({ held, sold }); }}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); finish(null); } }}>
        <h2 id="rdlg-title">{t("repriceTitle")}</h2>
        <p className="muted">{t("repriceFree", { n: p.free })}</p>
        {p.held > 0 && (
          <div className="reprice-group">
            <div><b>{t("repriceHeld", { n: p.held })}</b><p className="muted small">{t("repriceHeldHint")}</p></div>
            <Choice name="held" value={held} onChange={setHeld} label={t("repriceHeld", { n: p.held })} />
          </div>
        )}
        {p.sold > 0 && (
          <div className="reprice-group">
            <div><b>{t("repriceSold", { n: p.sold })}</b>
              <p className="muted small">{t("repriceSoldHint", { old: money(p.soldOld), now: money(p.soldNew), delta: `${delta >= 0 ? "+" : "−"}${money(Math.abs(delta))}` })}</p></div>
            <Choice name="sold" value={sold} onChange={setSold} label={t("repriceSold", { n: p.sold })} />
          </div>
        )}
        <div className="dialog-btns">
          <button type="button" className="btn btn-ghost" onClick={() => finish(null)}>{t("cancel")}</button>
          <button ref={ok} type="submit" className="btn btn-primary">{t("repriceOk")}</button>
        </div>
      </form>
    </div>
  );
}
