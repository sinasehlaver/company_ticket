import { useEffect, useRef } from "react";

const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// map: { "mod+z": fn, "mod+shift+z": fn, "mod+s": fn, "escape": fn, "?": fn }. "mod" = ⌘ on macOS, Ctrl elsewhere.
// While typing in a field only mod+s/o/k and escape fire (text fields keep their native undo).
export function useShortcuts(map) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      const combo = [(e.metaKey || e.ctrlKey) && "mod", e.shiftKey && k !== "?" && "shift", e.altKey && "alt", k].filter(Boolean).join("+");
      const fn = ref.current[combo];
      if (!fn) return;
      if (typing(e.target) && !/^(mod\+[sok]|escape)$/.test(combo)) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
