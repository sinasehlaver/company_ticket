import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "look/kit/i18n.js";
import { toast } from "look/kit/Toasts.jsx";
import { Checkbox } from "look/kit/Controls.jsx";
import { del } from "../api.js";

// Typed-confirmation delete (irreversible: no undo, no VCS). The user types `name`; the red verb button is enabled only
// on an exact match. The server answers 409 {sold} when sales would be erased: the dialog then asks for an explicit
// tick and retries with force:true. Resolves with the server result, or null when the user backs out.
// const r = await typedDelete({ title, text, name, path: `/api/days/5` });
let current = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export function typedDelete({ title, text, name, path }) {
  return new Promise((resolve) => {
    current?.resolve(null);
    current = { title, text, name, path, resolve };
    emit();
  });
}
const finish = (v) => { const c = current; current = null; emit(); c?.resolve(v); };

export function TypedDeleteHost() {
  const d = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => current);
  return d ? <TypedDialog key={d.path} d={d} /> : null;
}

function TypedDialog({ d }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [sold, setSold] = useState(null); // number once the server said 409
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const back = useRef(document.activeElement);
  useEffect(() => { setTimeout(() => input.current?.focus(), 0); const b = back.current; return () => b?.focus?.(); }, []);
  const match = typed.trim() === d.name.trim();
  const ready = match && !busy && (sold == null || force);
  const run = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const r = await del(d.path, { confirm: typed.trim(), ...(sold != null ? { force: true } : {}) });
      finish(r);
    } catch (e) {
      setBusy(false);
      if (e.status === 409 && e.body?.sold) { setSold(e.body.sold); return; }
      setError(e.message); toast(e.message);
    }
  };
  return (
    <div className="overlay overlay-center" onMouseDown={() => !busy && finish(null)}>
      <form className="dialog dialog-confirm typed-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tdlg-title"
        onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); run(); }}
        onKeyDown={(e) => { if (e.key === "Escape" && !busy) { e.stopPropagation(); finish(null); } }}>
        <h2 id="tdlg-title">{d.title}</h2>
        {d.text && <p className="muted">{d.text}</p>}
        <label className="field-v">
          <span>{t("typeToConfirm")} <b className="mono typed-name">{d.name}</b></span>
          <input ref={input} className="input" value={typed} autoComplete="off" spellCheck={false} aria-invalid={(typed && !match) || undefined}
            onChange={(e) => { setTyped(e.target.value); setError(null); }} />
        </label>
        {sold != null && (
          <div className="typed-warn" role="alert">
            <p>{t("deleteSoldWarn", { n: sold })}</p>
            <div className="cb-row"><Checkbox checked={force} onChange={setForce} label={t("deleteWithSales", { n: sold })} />
              <span onClick={() => setForce((f) => !f)}>{t("deleteWithSales", { n: sold })}</span></div>
          </div>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-btns">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => finish(null)}>{t("cancel")}</button>
          <button type="submit" className="btn btn-solid-danger busy-btn" data-s={busy ? "busy" : "idle"} disabled={!ready} aria-busy={busy}>
            <span className="spin" aria-hidden /><span>{t("delete")}</span></button>
        </div>
      </form>
    </div>
  );
}

/** Superuser "Sil" button: opens the typed dialog, toasts the outcome, calls onDone(result). */
export function DeleteButton({ title, text, name, path, onDone, className = "btn btn-danger btn-sm" }) {
  const t = useT();
  const click = async () => {
    const r = await typedDelete({ title, text, name, path });
    if (!r) return;
    const n = r.deleted?.tickets ?? 0;
    toast(r.sold ? t("deletedWithSales", { name: r.name, n: r.sold }) : n ? t("deletedTickets", { name: r.name, n }) : t("deletedName", { name: r.name }));
    onDone?.(r);
  };
  return <button type="button" className={className} onClick={click}>{t("delete")}</button>;
}
