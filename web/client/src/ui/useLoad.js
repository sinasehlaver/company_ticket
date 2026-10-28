import { useCallback, useEffect, useRef, useState } from "react";

// Async view data: {data, error, loading, reload, setData}. Stale responses (deps changed meanwhile) are dropped.
export function useLoad(fn, deps) {
  const [s, setS] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const my = ++seq.current;
    setS((p) => ({ ...p, loading: true, error: null }));
    fn().then(
      (data) => my === seq.current && setS({ data, error: null, loading: false }),
      (error) => my === seq.current && setS((p) => ({ ...p, error, loading: false })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  const setData = useCallback((f) => setS((p) => ({ ...p, data: typeof f === "function" ? f(p.data) : f })), []);
  return { ...s, reload: run, setData };
}
