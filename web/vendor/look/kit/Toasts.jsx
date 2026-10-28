import { useSyncExternalStore } from "react";

let toasts = [];
let nextId = 1;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

// toast("Deleted", { action: { label: "Undo", run: undo } })
export function toast(message, { action, ms = 5000 } = {}) {
  const id = nextId++;
  toasts = [...toasts, { id, message, action }];
  emit();
  setTimeout(() => dismiss(id), ms);
}
// two-step so the exit animation plays before the node is removed
function dismiss(id) {
  if (!toasts.some((t) => t.id === id && !t.leaving)) return;
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit(); }, 180);
}

export function Toasts() {
  const list = useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast" data-leaving={!!t.leaving}>
          <span>{t.message}</span>
          {t.action && (
            <button className="btn btn-ghost" onClick={() => { t.action.run(); dismiss(t.id); }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}
