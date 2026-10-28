// Money and date formatting. Pure (no React/DOM). Dates are stored UTC; always shown in Europe/Istanbul.
export const TZ = "Europe/Istanbul";
const LOCALE = { tr: "tr-TR", en: "en-GB" };
const loc = (lang) => LOCALE[lang] ?? "tr-TR";

const NUM = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
/** 1250 -> "1.250 ₺" (tr-TR grouping in every UI language: it's Turkish lira). */
export const money = (n) => `${NUM.format(Number(n) || 0)} ₺`;
export const num = (n) => NUM.format(Number(n) || 0);

function parts(iso, lang, opts) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const out = {};
  for (const p of new Intl.DateTimeFormat(loc(lang), { timeZone: TZ, hourCycle: "h23", ...opts }).formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "28 Ekim Salı 20:30" (en: "28 October Tuesday 20:30"). */
export function dayLabel(iso, lang = "tr") {
  const p = parts(iso, lang, { day: "numeric", month: "long", weekday: "long", hour: "2-digit", minute: "2-digit" });
  return p ? `${p.day} ${p.month} ${p.weekday} ${p.hour}:${p.minute}` : "—";
}
/** Compact tab label: "28 Eki Sal 20:30". */
export function dayShort(iso, lang = "tr") {
  const p = parts(iso, lang, { day: "numeric", month: "short", weekday: "short", hour: "2-digit", minute: "2-digit" });
  return p ? `${p.day} ${p.month} ${p.weekday} ${p.hour}:${p.minute}` : "—";
}
/** Parts for a date card: {day:"28", month:"Ekim", weekday:"Salı", time:"20:30", year:"2026"}. */
export function dayParts(iso, lang = "tr") {
  const p = parts(iso, lang, { day: "numeric", month: "long", weekday: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return p ? { day: p.day, month: p.month, weekday: p.weekday, year: p.year, time: `${p.hour}:${p.minute}` } : null;
}
/** Log timestamp "28.10.2026 20:31:05". */
export function stamp(iso, lang = "tr") {
  const p = parts(iso, lang, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return p ? `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second}` : "—";
}
/** "28.10.2026 20:30" in Istanbul: what the user types to confirm deleting a day (server: admin.js istanbulLabel). */
export function confirmStamp(iso) {
  const p = parts(iso, "tr", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return p ? `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}` : "";
}
/** UTC ISO -> Istanbul {date:"YYYY-MM-DD", time:"HH:MM"} (prefills the day edit form). */
export function istanbulInput(iso) {
  const p = parts(iso, "tr", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return p ? { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` } : null;
}
/** Today's date in Istanbul as "YYYY-MM-DD" (default for the new-day form). */
export function istanbulToday(now = new Date()) {
  const p = parts(now.toISOString(), "tr", { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}
/** Seat label as the server writes it: ("a", "12") -> "A-12" (ASCII upper: row letters are data ids, not words). */
export const seatLabel = (row, num) => `${String(row).toUpperCase()}-${num}`;
