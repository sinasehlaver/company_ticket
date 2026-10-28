// Live preview of the başkan "Satış iptal" input. Mirrors server/reserve.js parseSeatList (the server stays the judge):
// 'a-32, B-25' -> seats ["A-32","B-25"]; junk / empty items and duplicates are listed so the user sees them before sending.
const SEAT = /^([a-zA-Z])-([0-9A-Za-z]{1,10})$/;

export function cancelPreview(text) {
  const seats = [], bad = [], dup = [], seen = new Set();
  if (typeof text !== "string" || !text.trim()) return { seats, bad, dup, ok: false };
  for (const raw of text.split(",")) {
    const tok = raw.trim(); // an empty item (trailing / double comma) is bad too, like on the server
    const m = SEAT.exec(tok);
    if (!m) { bad.push(tok); continue; }
    const label = `${m[1].toUpperCase()}-${m[2]}`;
    if (seen.has(label)) { if (!dup.includes(label)) dup.push(label); continue; }
    seen.add(label);
    seats.push(label);
  }
  return { seats, bad, dup, ok: seats.length > 0 && !bad.length && !dup.length };
}

/** Count-hall cancel input: integer 1..sold or null. */
export function cancelCount(text, sold) {
  if (!/^\s*\d{1,6}\s*$/.test(String(text ?? ""))) return null;
  const n = Number(text);
  return n >= 1 && n <= sold ? n : null;
}
