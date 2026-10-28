import { useEffect, useRef, useState } from "react";
import { useT } from "./i18n.js";

// Picks: a square tick is for SELECTING items; a switch is for ON/OFF settings. Don't swap them.
export function Checkbox({ checked, onChange, label, indeterminate = false }) {
  return (
    <button type="button" role="checkbox" aria-checked={indeterminate ? "mixed" : checked} aria-label={label} className="cb"
      onClick={(e) => { e.stopPropagation(); onChange(!checked, e); }}>
      <span aria-hidden>{indeterminate ? "–" : checked ? "✓" : ""}</span>
    </button>
  );
}
export function Switch({ checked, onChange, label }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}><span className="switch-knob" /></button>
    </label>
  );
}

// A small "?" beside a heading with a one-sentence tooltip.
export function Help({ text }) {
  return <button type="button" className="help" aria-label={text} data-tip={text}>?</button>;
}

// Picks: an async button disables itself, spins while working, then shows ✓ for a second. Can't be double-fired.
export function BusyButton({ onClick, children, className = "btn btn-primary", doneLabel = "✓" }) {
  const [s, setS] = useState("idle");
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const run = async (e) => {
    if (s === "busy") return;
    setS("busy");
    try {
      await onClick(e);
      if (!live.current) return;
      setS("done");
      setTimeout(() => live.current && setS("idle"), 1000);
    } catch (err) {
      if (live.current) setS("idle");
      throw err;
    }
  };
  return (
    <button type="button" className={`${className} busy-btn`} data-s={s} disabled={s === "busy"} aria-busy={s === "busy"} onClick={run}>
      <span className="spin" aria-hidden />
      <span>{s === "done" ? doneLabel : children}</span>
    </button>
  );
}

// Picks: autosave has no Save button; a status chip in the top bar reports it. state: saved | saving | error | dirty
export function StatusChip({ state, text }) {
  const t = useT();
  return <span className="status-chip" data-s={state} role="status"><span className="status-dot" aria-hidden />{text ?? t(`st_${state}`)}</span>;
}

// Picks: the empty/import state for files is a big button-like drop zone (never a bare <input type=file>).
export function DropZone({ onFiles, accept = ".json", hint }) {
  const t = useT();
  const [over, setOver] = useState(false);
  const input = useRef(null);
  return (
    <button type="button" className="dropzone" data-over={over}
      onClick={() => input.current.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); }}>
      <span className="dropzone-icon" aria-hidden>⤓</span>
      <span><b>{t("dropFile")}</b> {t("orClick")}</span>
      <span className="muted">{hint ?? accept}</span>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { if (e.target.files.length) onFiles([...e.target.files]); e.target.value = ""; }} />
    </button>
  );
}
