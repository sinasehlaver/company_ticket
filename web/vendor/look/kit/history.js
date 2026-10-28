// Undo/redo store. Pure JS (no React) so node:test can cover it. Snapshot identity changes on every update
// so it works directly with useSyncExternalStore.
export function createHistory(initial, { limit = 100 } = {}) {
  let past = [];
  let future = [];
  let present = initial;
  const subs = new Set();
  let snap = build();

  function build() {
    return { data: present, canUndo: past.length > 0, canRedo: future.length > 0 };
  }
  function emit() {
    snap = build();
    subs.forEach((f) => f());
  }

  return {
    getSnapshot: () => snap,
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
    // next may be a value or (prev) => value; identical result is a no-op (no history entry)
    set(next) {
      const value = typeof next === "function" ? next(present) : next;
      if (value === present) return;
      past = [...past, present].slice(-limit);
      present = value;
      future = [];
      emit();
    },
    undo() {
      if (!past.length) return false;
      future = [present, ...future];
      present = past[past.length - 1];
      past = past.slice(0, -1);
      emit();
      return true;
    },
    redo() {
      if (!future.length) return false;
      past = [...past, present];
      present = future[0];
      future = future.slice(1);
      emit();
      return true;
    },
    // loading a file/reset: new baseline, history cleared
    reset(value) {
      past = [];
      future = [];
      present = value;
      emit();
    },
  };
}
