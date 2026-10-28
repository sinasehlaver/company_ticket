// Typings for table.js / table-logic.js (the JS stays the source of truth).
import type { MutableRefObject, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

export type SortDir = "asc" | "desc";
export type Sort = { key: string; dir: SortDir };
export type Id = string | number;

export function sortRows<R>(rows: readonly R[], key: string, dir?: SortDir, getValue?: (row: R, key: string) => unknown, locale?: string | string[]): R[];
export function nextSort(sort: Sort | null, key: string): Sort | null;
export function selectClick<I extends Id>(
  sel: ReadonlySet<I>, ids: readonly I[], id: I, mods?: { shift?: boolean; meta?: boolean }, anchor?: I | null,
): { sel: Set<I>; anchor: I | null };
export function allState<I extends Id>(sel: ReadonlySet<I>, ids: readonly I[]): "none" | "some" | "all";
export function selectAll<I extends Id>(sel: ReadonlySet<I>, ids: readonly I[]): Set<I>;
export function pruneSel<I extends Id>(sel: Set<I>, ids: readonly I[]): Set<I>;
export function moveRow<I extends Id>(ids: readonly I[], sel: ReadonlySet<I>, delta: number): I[];

export type UseTableOptions<R, I extends Id = string> = {
  rows: readonly R[];
  getId: (row: R) => I;
  sortValue?: (row: R, key: string) => unknown;
  locale?: string | string[];
  onDelete?: (ids: I[]) => void;
  onCopy?: (ids: I[]) => void;
  onCut?: (ids: I[]) => void;
  onPaste?: (ids: I[]) => void;
  onDuplicate?: (ids: I[]) => void;
  /** Gets the full new id order (only called while unsorted). */
  onMove?: (order: I[]) => void;
  initialSort?: Sort | null;
};

type ClickEvent = Pick<ReactMouseEvent, "shiftKey" | "metaKey" | "ctrlKey"> | { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };

export type UseTable<R, I extends Id = string> = {
  view: R[];
  ids: I[];
  sort: Sort | null;
  setSort: (s: Sort | null | ((s: Sort | null) => Sort | null)) => void;
  toggleSort: (key: string) => void;
  clearSort: () => void;
  sorted: boolean;
  canReorder: boolean;
  sel: Set<I>;
  setSel: (s: Set<I> | ((s: Set<I>) => Set<I>)) => void;
  isSel: (id: I) => boolean;
  click: (e: ClickEvent, id: I) => void;
  checkbox: (e: ClickEvent | undefined, id: I) => void;
  headerCheckbox: { checked: boolean; indeterminate: boolean; onChange: () => void };
  clear: () => void;
  onKeyDown: (e: ReactKeyboardEvent | KeyboardEvent) => void;
  focusId: MutableRefObject<I | null>;
};

export function useTable<R, I extends Id = string>(opts: UseTableOptions<R, I>): UseTable<R, I>;
