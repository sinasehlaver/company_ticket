import { useEffect, useRef, useSyncExternalStore } from "react";
import { useT } from "./i18n.js";

// Centred in-app dialog (never window.confirm). Only for IRREVERSIBLE actions: files on disk, processes, anything with
// no undo. Rows and other undoable things delete instantly with an Undo toast instead.
// if (await confirmDialog({ title: "Delete “x.json”?", text: "This removes the file from disk.", ok: "Delete" })) …
let current = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export function confirmDialog({ title, text, ok, danger = true }) {
  return new Promise((resolve) => {
    current?.resolve(false);
    current = { title, text, ok, danger, resolve };
    emit();
  });
}
const finish = (v) => { const c = current; current = null; emit(); c?.resolve(v); };

export function DialogHost() {
  const t = useT();
  const d = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => current);
  const okRef = useRef(null);
  const back = useRef(null);
  useEffect(() => {
    if (!d) return;
    back.current = document.activeElement;
    setTimeout(() => okRef.current?.focus(), 0);
    return () => back.current?.focus?.();
  }, [d]);
  if (!d) return null;
  return (
    <div className="overlay overlay-center" onMouseDown={() => finish(false)}>
      <div
        className="dialog dialog-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); finish(false); }
          if (e.key === "Tab") { // keep focus inside
            const bs = [...e.currentTarget.querySelectorAll("button")];
            const i = bs.indexOf(document.activeElement);
            e.preventDefault();
            bs[(i + (e.shiftKey ? -1 : 1) + bs.length) % bs.length].focus();
          }
        }}
      >
        <h2 id="dlg-title">{d.title}</h2>
        {d.text && <p className="muted">{d.text}</p>}
        <div className="dialog-btns">
          <button className="btn btn-ghost" onClick={() => finish(false)}>{t("cancel")}</button>
          <button ref={okRef} className={`btn ${d.danger ? "btn-solid-danger" : "btn-primary"}`} onClick={() => finish(true)}>{d.ok}</button>
        </div>
      </div>
    </div>
  );
}
