import { useEffect, useMemo, useState } from "react";
import { useT } from "look/kit/i18n.js";
import { usePrefs } from "look/kit/prefs.js";
import { toast } from "look/kit/Toasts.jsx";
import { confirmDialog } from "look/kit/Dialog.jsx";
import { get, post } from "../api.js";
import { Busy } from "../ui/Busy.jsx";
import { dayShort, money, seatLabel } from "../format.js";
import { bandsFromDict, buildLayout } from "../seatmap.js";
import { moveQuote, pickedSeats, refundTotal } from "../cancel.js";
import { SeatMap } from "./SeatMap.jsx";

const rowsOf = (list, only) => (
  <span className="sell-sum">
    <span className="sell-rows">{list.map((s) => <span key={s[0]} className="sell-row"><span>{seatLabel(s[1], s[2])}</span><b>{money(s[3])}</b></span>)}</span>
    {only}
  </span>
);

/** Confirm (danger) + POST /cancel for sold seats given as state.seats tuples. Resolves true when cancelled. */
export async function cancelSeats({ t, day, list, setState, failed }) {
  if (!list.length) return false;
  const total = refundTotal(list);
  const ok = await confirmDialog({
    title: `⚠ ${t("cancelTitleN", { n: list.length })}`,
    text: rowsOf(list, <>
      <span className="sell-total cancel-refund"><span>{t("refundTotal")}</span><b>{money(total)}</b></span>
      <span className="cancel-danger">⚠ {t("cancelDanger")}</span>
    </>),
    ok: t("cancelYes"), danger: true,
  });
  if (!ok) return false;
  try {
    const r = await post(`/api/days/${day.id}/cancel`, { tickets: list.map((s) => seatLabel(s[1], s[2])).join(", ") });
    setState(r.state);
    toast(t("cancelledRefund", { n: r.cancelled.length, total: money(total) }));
    return true;
  } catch (e) { failed(e); return false; }
}

/** Sticky bar of the "Bilet İptali" mode: count, refund, clear, cancel. */
export function CancelBar({ day, state, setState, failed, picked, setPicked, exit }) {
  const t = useT();
  const list = pickedSeats(state.seats, picked);
  const go = async () => { if (await cancelSeats({ t, day, list, setState, failed })) { setPicked(new Set()); exit(); } };
  return (
    <div className="sellbar cancelbar" data-empty={!list.length || undefined}>
      <div className="sellbar-in">
        <div className="sellbar-list">
          <span className="sellbar-title">⚠ {t("cancelMode")}</span>
          <span className="muted small">{list.length ? t("pickedN", { n: list.length }) : t("pickToCancel")}</span>
        </div>
        <div className="sellbar-total"><span className="muted small">{t("refundTotal")}</span><b>{money(refundTotal(list))}</b></div>
        <button className="btn btn-ghost" onClick={() => setPicked(new Set())} disabled={!list.length}>{t("clearPicks")}</button>
        <Busy className="btn btn-danger" onClick={go} disabled={!list.length}>{t("cancelPicked")}</Busy>
      </div>
    </div>
  );
}

/** "Düzenle": move one sold ticket to a free seat of any seated day; shows what the customer pays / gets back. */
export function MoveDialog({ day, seat, onClose, setState, failed }) {
  const t = useT();
  const { lang } = usePrefs();
  const [events, setEvents] = useState([]);
  const [evId, setEvId] = useState(String(day.event.id));
  const [evDays, setEvDays] = useState(null);
  const [dayId, setDayId] = useState(String(day.id));
  const [target, setTarget] = useState(null); // {day, state}
  const [pick, setPick] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { get("/api/events").then((r) => setEvents(r.events), (e) => setErr(e.message)); }, []);
  useEffect(() => {
    setEvDays(null);
    get(`/api/events/${evId}`).then((r) => {
      setEvDays(r.event.days);
      setDayId((cur) => (r.event.days.some((d) => String(d.id) === cur) ? cur : String(r.event.days[0]?.id ?? "")));
    }, (e) => setErr(e.message));
  }, [evId]);
  useEffect(() => {
    if (!dayId) { setTarget(null); return; }
    setTarget(null); setPick(null);
    get(`/api/days/${dayId}`).then((r) => setTarget(r), (e) => setErr(e.message));
  }, [dayId]);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape" && !document.querySelector(".dialog-confirm")) { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  const seated = target?.day.kind === "seated";
  const layout = useMemo(() => {
    if (!seated) return null;
    const seats = target.state.seats.map((s) => (s[0] === pick?.id ? [...s.slice(0, 5), 1, true, null, false] : s)); // the pick shows as "yours"
    return buildLayout(target.day.seats, bandsFromDict(target.day.ticketsDict), seats);
  }, [target, seated, pick]);
  const onSeat = (c, r) => {
    if (c.status === "free" || c.status === "mine") setPick({ id: c.id, name: seatLabel(r.row, c.num), price: c.price });
    else toast(c.status === "sold" ? t("seatSold", { seat: seatLabel(r.row, c.num) }) : t("seatTaken", { seat: seatLabel(r.row, c.num) }));
  };
  const q = pick ? moveQuote(seat.price, pick.price) : null;
  const go = async () => {
    const ok = await confirmDialog({
      title: t("moveTitle"),
      text: <span className="sell-sum"><span className="sell-rows">
        <span className="sell-row"><span>{seat.name} → {pick.name}</span><b>{money(seat.price)} → {money(pick.price)}</b></span></span>
        <span className="sell-total"><span>{t(q.kind === "pay" ? "customerPays" : q.kind === "refund" ? "customerGets" : "noDifference")}</span><b>{money(q.amount)}</b></span>
      </span>,
      ok: t("moveYes"), danger: q.kind === "refund",
    });
    if (!ok) return false;
    try {
      const r = await post(`/api/days/${day.id}/move`, { ticketId: seat.id, toDayId: Number(dayId), toTicketId: pick.id });
      setState(r.state);
      toast(t("movedTo", { from: seat.name, to: r.to.row.toUpperCase() + "-" + r.to.num }));
      onClose();
      return true;
    } catch (e) { failed(e); if (e.body?.state) setPick(null); return false; }
  };
  return (
    <div className="overlay overlay-center" onMouseDown={onClose}>
      <div className="dialog move-dialog" role="dialog" aria-modal="true" aria-labelledby="mv-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="mv-title">{t("moveHead", { seat: seat.name })}</h2>
        <p className="muted small">{t("moveHint")}</p>
        <div className="move-pickers">
          <label>{t("event")}
            <select className="input" value={evId} onChange={(e) => setEvId(e.target.value)}>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></label>
          <label>{t("dayWord")}
            <select className="input" value={dayId} onChange={(e) => setDayId(e.target.value)} disabled={!evDays}>
              {(evDays ?? []).map((d) => <option key={d.id} value={d.id}>{dayShort(d.date, lang)}</option>)}
            </select></label>
        </div>
        {err && <p className="form-error">{err}</p>}
        <div className="move-map">
          {!target ? <p className="muted">…</p> : !seated ? <p className="muted">{t("moveNeedsSeated")}</p>
            : <SeatMap layout={layout} onSeat={onSeat} fit />}
        </div>
        <div className="move-sum" data-kind={q?.kind}>
          {!pick ? <span className="muted">{t("moveChoose")}</span> : <>
            <span>{seat.name} <b>{money(seat.price)}</b> → {pick.name} <b>{money(pick.price)}</b></span>
            <b className="move-delta">{t(q.kind === "pay" ? "customerPays" : q.kind === "refund" ? "customerGets" : "noDifference")}{q.kind !== "even" && `: ${money(q.amount)}`}</b>
          </>}
        </div>
        <div className="dialog-btns">
          <button className="btn btn-ghost" onClick={onClose}>{t("cancel")}</button>
          <Busy className="btn btn-primary" onClick={go} disabled={!pick || !seated}>{t("moveYes")}</Busy>
        </div>
      </div>
    </div>
  );
}
