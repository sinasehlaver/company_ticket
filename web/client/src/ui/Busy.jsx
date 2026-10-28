import { useEffect, useRef, useState } from "react";

// Same look as the kit's BusyButton (.busy-btn: disabled + spinner, ✓ after), but an app wrapper because:
// onClick returns false for a handled failure (no ✓, no rethrow -> no unhandled rejection), and it can be a form submit.
export function Busy({ onClick, children, className = "btn btn-primary", type = "button", disabled = false, doneLabel = "✓", ...rest }) {
  const [s, setS] = useState("idle");
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const run = async (e) => {
    if (type === "submit") e.preventDefault();
    if (s === "busy") return;
    setS("busy");
    let ok = false;
    try { ok = (await onClick?.(e)) !== false; } catch (err) { console.error(err); }
    if (!live.current) return;
    setS(ok ? "done" : "idle");
    if (ok) setTimeout(() => live.current && setS("idle"), 1000);
  };
  return (
    <button type={type} className={`${className} busy-btn`} data-s={s} disabled={disabled || s === "busy"} aria-busy={s === "busy"} onClick={run} {...rest}>
      <span className="spin" aria-hidden />
      <span>{s === "done" ? doneLabel : children}</span>
    </button>
  );
}
