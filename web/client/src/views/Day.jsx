import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "look/kit/i18n.js";
import { usePrefs } from "look/kit/prefs.js";
import { toast } from "look/kit/Toasts.jsx";
import { confirmDialog } from "look/kit/Dialog.jsx";
import { useShortcuts } from "look/kit/shortcuts.js";
import { tip } from "look/kit/Tooltip.jsx";
import { ErrorState } from "look/kit/States.jsx";
import { Popover, Menu } from "look/kit/Popover.jsx";
import { DatePicker } from "look/kit/DatePicker.jsx";
import { get, post, put } from "../api.js";
import { go } from "../router.js";
import { Busy } from "../ui/Busy.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { useLoad } from "../ui/useLoad.js";
import { DeleteButton } from "../ui/TypedConfirm.jsx";
import { repriceChoice } from "../ui/RepriceDialog.jsx";
import { confirmStamp, dayLabel, dayShort, istanbulInput, money, num, seatLabel } from "../format.js";
import { bandsFromDict, buildLayout, tally } from "../seatmap.js";
import { cancelCount, cancelPreview } from "../cancel.js";
import { isPrice, missingRows, pricesBody } from "../prices.js";
import { Legend, SeatMap } from "./SeatMap.jsx";
import { PriceEditor } from "./PriceEditor.jsx";

const POLL_MS = 3000;

// F7-F11 the day page. One `state` object from the server drives everything; every mutation returns a fresh one.
// Polling: GET /state?since=<version> every 3 s while the tab is visible (204 = unchanged). A poll answer is dropped
// when a mutation's state landed after the poll was sent (mutSeq), so a slow poll can never undo a click.
export function Day({ id, boss, sudo, setBack }) {
  const t = useT();
  const { lang } = usePrefs();
  const [info, setInfo] = useState(null); // {day, days}
  const [state, setStateRaw] = useState(null);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const stateRef = useRef(null);
  const mutSeq = useRef(0);
  const setState = useCallback((s, fromMutation = true) => {
    if (!s) return;
    if (fromMutation) mutSeq.current++;
    stateRef.current = s;
    setStateRaw(s);
  }, []);

  const load = useCallback(() => {
    setError(null);
    get(`/api/days/${id}`).then((r) => { setInfo({ day: r.day, days: r.days }); setState(r.state); setStale(false); }, setError);
  }, [id, setState]);
  useEffect(() => { setInfo(null); setStateRaw(null); stateRef.current = null; load(); }, [load]);
  useEffect(() => { if (info) setBack?.(`events/${info.day.event.id}`); }, [info, setBack]);

  // polling
  const inFlight = useRef(false);
  const poll = useCallback(async () => {
    if (inFlight.current || document.hidden || !stateRef.current) return;
    inFlight.current = true;
    const at = mutSeq.current;
    try {
      const r = await get(`/api/days/${id}/state?since=${encodeURIComponent(stateRef.current.version)}`);
      if (r && at === mutSeq.current) setState(r, false);
      setStale(false);
    } catch { setStale(true); } finally { inFlight.current = false; }
  }, [id, setState]);
  useEffect(() => {
    const iv = setInterval(poll, POLL_MS);
    const wake = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", wake); window.removeEventListener("focus", wake); };
  }, [poll]);

  // a failed mutation: toast the server's message and show the fresh state it sent (409) or refetch it
  const failed = useCallback((e) => {
    toast(e.message);
    if (e.body?.state) setState(e.body.state);
    else poll();
  }, [setState, poll]);

  const days = info?.days ?? [];
  const at = days.findIndex((d) => String(d.id) === String(id));
  useShortcuts({
    "[": () => at > 0 && go(`day/${days[at - 1].id}`),
    "]": () => at >= 0 && at < days.length - 1 && go(`day/${days[at + 1].id}`),
  });

  if (error) return <div className="page page-wide"><ErrorState message={error.message} onRetry={load} /></div>;
  if (!info || !state) return <div className="page page-wide"><Skeleton head map /></div>;
  const { day } = info;
  const seated = day.kind === "seated";
  return (
    <div className="page page-wide day-page">
      <header className="view-head day-head">
        <div>
          <p className="crumb"><a href={`#/events/${day.event.id}`}>{day.event.name}</a> · {boss ? <a href={`#/halls/${day.event.hallId}`}>{day.event.hallName}</a> : day.event.hallName}</p>
          <h1 className={days.length > 1 ? "sr-only" : undefined}>{dayLabel(day.date, lang)}</h1>
        </div>
        <div className="head-chips">
          {stale && <span className="chip chip-warn" data-tip={t("staleHint")}>{t("stale")}</span>}
          {boss && <a className="btn btn-ghost btn-sm" href={`#/logs/${day.id}`}>{t("dayLog")}</a>}
        </div>
      </header>
      {days.length > 1 && (
        <nav className="tabs day-tabs" aria-label={t("days")}>
          {days.map((d, i) => (
            <a key={d.id} className="tab" href={`#/day/${d.id}`} aria-current={String(d.id) === String(id) ? "page" : undefined}
              data-tip={i === at - 1 ? tip(t("prevDay"), "[") : i === at + 1 ? tip(t("nextDay"), "]") : undefined}>{dayShort(d.date, lang)}</a>
          ))}
        </nav>
      )}
      <Stats state={state} seated={seated} boss={boss} />
      {seated
        ? <Seated day={day} state={state} setState={setState} failed={failed} boss={boss} />
        : <CountHall day={day} state={state} setState={setState} failed={failed} />}
      {boss && <Holders day={day} state={state} setState={setState} failed={failed} />}
      {boss && state.sold?.count > 0 && <CancelCard day={day} state={state} setState={setState} failed={failed} seated={seated} />}
      {boss && <DayAdmin key={day.id} day={day} sudo={sudo} countPrice={seated ? null : state.seats[0]?.[3]}
        onDay={(d) => { setInfo((i) => ({ day: { ...i.day, date: d.date, ticketsDict: d.ticketsDict },
          days: i.days.map((x) => (String(x.id) === String(d.id) ?{ ...x, date: d.date } : x)) })); poll(); }} />}
      <SellBar day={day} state={state} setState={setState} failed={failed} seated={seated} />
    </div>
  );
}

function Stats({ state, seated, boss }) {
  const t = useT();
  return (
    <div className="stats">
      <div className="stat"><span className="stat-n">{num(state.free)}</span><span className="stat-l">{t("statFree")}</span></div>
      <div className="stat stat-mine"><span className="stat-n">{num(state.mine.count)}</span><span className="stat-l">{t("statMine")}</span></div>
      {boss && state.sold && <>
        <div className="stat"><span className="stat-n">{num(state.sold.count)}</span><span className="stat-l">{t("statSold")}</span></div>
        <div className="stat"><span className="stat-n">{money(state.sold.revenue)}</span><span className="stat-l">{t("statRevenue")}</span></div>
      </>}
      {!seated && <span className="spacer" />}
    </div>
  );
}

function Seated({ day, state, setState, failed, boss }) {
  const t = useT();
  const bands = useMemo(() => bandsFromDict(day.ticketsDict), [day.ticketsDict]);
  const layout = useMemo(() => buildLayout(day.seats, bands, state.seats), [day.seats, bands, state.seats]);
  const counts = useMemo(() => tally(state.seats), [state.seats]);
  const [fit, setFit] = useState(false); // real size by default (desktop too); "Sığdır" scales it down
  const [pending, setPending] = useState(() => new Set());
  const [menu, setMenu] = useState(null); // başkan: {anchor, id, name, holder} for another user's hold
  const closeMenu = useCallback(() => setMenu(null), []);
  const release = async (m) => {
    try {
      const r = await post(`/api/days/${day.id}/release`, { ticketId: m.id });
      setState(r.state);
      toast(t("releasedSeat", { seat: m.name, name: m.holder }));
    } catch (e) { failed(e); }
  };
  const onSeat = async (c, r, el) => {
    const name = seatLabel(r.row, c.num);
    if (c.status === "sold") { toast(t("seatSold", { seat: name })); return; }
    if (c.status === "other" && boss) { setMenu({ anchor: el, id: c.id, name, holder: c.holder ?? "?" }); return; }
    if (c.status === "other") { toast(t("seatTaken", { seat: name })); return; }
    if (pending.has(c.id)) return;
    setPending((p) => new Set(p).add(c.id));
    try {
      const r2 = await post(`/api/days/${day.id}/toggle`, { ticketId: c.id });
      setState(r2.state);
    } catch (e) { failed(e); } finally {
      setPending((p) => { const n = new Set(p); n.delete(c.id); return n; });
    }
  };
  return (
    <section className="card map-card">
      <div className="map-tools">
        <Legend counts={counts} boss={boss} />
        <span className="spacer" />
        <button className="btn btn-soft btn-sm" aria-pressed={fit} onClick={() => setFit((f) => !f)} data-tip={fit ? t("realSizeHint") : t("fitHint")}>
          {fit ? t("realSize") : t("fit")}</button>
      </div>
      <SeatMap layout={layout} onSeat={onSeat} boss={boss} fit={fit} pending={pending} />
      <Popover open={!!menu} anchor={menu?.anchor} onClose={closeMenu}>
        {menu && <>
          <p className="menu-title">{t("seatHeldBy", { seat: menu.name, name: menu.holder })}</p>
          <Menu onClose={closeMenu} items={[{ id: "release", label: t("releaseHold"), danger: true, run: () => release(menu) }]} />
        </>}
      </Popover>
    </section>
  );
}

// Başkan: who holds what right now (another sales point may have walked away with seats in their cart).
function Holders({ day, state, setState, failed }) {
  const t = useT();
  const list = state.holders ?? [];
  const releaseAll = async (h) => {
    try {
      const r = await post(`/api/days/${day.id}/release`, { userId: h.userId });
      setState(r.state);
      toast(t("releasedAll", { n: r.released, name: h.username }));
      return true;
    } catch (e) { failed(e); return false; }
  };
  return (
    <section className="card holders-card">
      <div className="cancel-head"><h2>{t("holders")}</h2><span className="muted small">{t("holdersHint")}</span></div>
      {!list.length ? <p className="muted small">{t("noHolders")}</p> : (
        <ul className="holders">
          {list.map((h) => (
            <li key={h.userId} data-holder={h.username}>
              <b>{h.username}</b><span className="chip">{t("countTickets", { n: num(h.count) })}</span><span className="spacer" />
              <Busy className="btn btn-soft btn-sm" onClick={() => releaseAll(h)}>{t("releaseAll")}</Busy>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Başkan: move the day, re-price its unsold seats; superuser: delete it (typed confirm).
function DayAdmin({ day, sudo, onDay, countPrice }) {
  const t = useT();
  const { lang } = usePrefs();
  const seated = day.kind === "seated";
  const init = istanbulInput(day.date) ?? { date: "", time: "" };
  const [date, setDate] = useState(init.date);
  const [time, setTime] = useState(init.time);
  const hall = useLoad(() => get(`/api/halls/${day.event.hallId}`), [day.event.hallId]);
  const [values, setValues] = useState(() => Object.fromEntries(Object.entries(day.ticketsDict ?? {}).map(([r, v]) => [r, String(v?.["-1"]?.[0] ?? "")])));
  const [price, setPrice] = useState(countPrice != null ? String(countPrice) : "");
  const [error, setError] = useState(null);
  const [invalid, setInvalid] = useState([]);
  const saveDate = async () => {
    setError(null);
    if (!/^\d{2}:\d{2}$/.test(time)) { setError(t("timeRequired")); return false; }
    try {
      const r = await put(`/api/days/${day.id}`, { date: `${date}T${time}` });
      onDay(r.day); toast(t("dayMoved", { date: dayLabel(r.day.date, lang) }));
      return true;
    } catch (e) { setError(e.message); toast(e.message); return false; }
  };
  const savePrices = async () => {
    setError(null); setInvalid([]);
    let body;
    if (seated) {
      const rows = hall.data?.hall.rows ?? [];
      const miss = missingRows(rows, values);
      if (miss.length) { setInvalid(miss); setError(t("pricesMissing", { rows: miss.map((r) => r.toUpperCase()).join(", ") })); return false; }
      body = { prices: pricesBody(rows, values) };
    } else {
      if (!isPrice(price)) { setError(t("priceRequired")); return false; }
      body = { price: Number(price) };
    }
    try {
      const p = await post(`/api/days/${day.id}/prices/preview`, body);
      if (p.held > 0 || p.sold > 0) {
        const c = await repriceChoice(p);
        if (!c) return false;
        body = { ...body, ...c };
      }
      const r = await put(`/api/days/${day.id}/prices`, body);
      onDay(r.day); toast(r.changed ? t("dayRepriced", { n: r.changed }) : t("dayRepricedNone"));
      return true;
    } catch (e) { setError(e.message); toast(e.message); return false; }
  };
  const [open, setOpen] = useState(false);
  return (
    <section className="card form-card day-admin" data-collapsed={!open}>
      <div className="cancel-head">
        <button type="button" className="section-title" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="chev" aria-hidden>▾</span><h2>{t("editDay")}</h2></button>
        <span className="muted small">{t("bossOnly")}</span></div>
      {open && <>
      <div className="form-row">
        <div className="field-v"><span>{t("date")}</span><DatePicker label={t("date")} value={date} onChange={setDate} /></div>
        <label className="field-v"><span>{t("time")}</span>
          <input className="input input-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <Busy className="btn btn-soft" onClick={saveDate}>{t("saveDate")}</Busy>
      </div>
      <h3 className="sub-h">{t("prices")}</h3>
      <p className="muted small">{t("repriceHint")}</p>
      {seated ? (hall.data ? <PriceEditor rows={hall.data.hall.rows} values={values} onChange={setValues} invalid={invalid} />
        : hall.error ? <p className="form-error">{hall.error.message}</p> : <Skeleton cards={1} />) : (
        <label className="field-v narrow"><span>{t("ticketPrice")}</span>
          <span className="input-suffix"><input className="input" inputMode="numeric" value={price} aria-label={t("ticketPrice")}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 5))} /><span aria-hidden>₺</span></span></label>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-btns">
        {sudo && <DeleteButton title={t("deleteDayTitle", { date: dayLabel(day.date, lang) })} text={t("deleteDayText")} name={confirmStamp(day.date)}
          path={`/api/days/${day.id}`} onDone={() => go(`events/${day.event.id}`)} className="btn btn-danger" />}
        <span className="spacer" />
        <Busy onClick={savePrices}>{t("savePrices")}</Busy>
      </div>
      </>}
    </section>
  );
}

function CountHall({ day, state, setState, failed }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const step = async (dir) => {
    if (busy) return;
    setBusy(true);
    try { setState((await post(`/api/days/${day.id}/count/${dir}`)).state); } catch (e) { failed(e); } finally { setBusy(false); }
  };
  const price = state.seats[0]?.[3];
  return (
    <section className="card count-card">
      <div className="count-free"><span className="big-n">{num(state.free)}</span><span className="muted">{t("countFree", { n: num(day.seatCount) })}</span>
        {price != null && <span className="chip">{t("perTicket", { price: money(price) })}</span>}</div>
      <div className="count-mine">
        <span className="stat-l">{t("statMine")}</span>
        <div className="stepper" role="group" aria-label={t("statMine")}>
          <button className="btn btn-icon stepper-btn" onClick={() => step("release")} disabled={busy || !state.mine.count} aria-label={t("releaseOne")} data-tip={t("releaseOne")}>−</button>
          <output className="stepper-n" aria-live="polite">{num(state.mine.count)}</output>
          <button className="btn btn-icon stepper-btn" onClick={() => step("hold")} disabled={busy || !state.free} aria-label={t("holdOne")} data-tip={t("holdOne")}>＋</button>
        </div>
      </div>
    </section>
  );
}

// Sticky bottom bar: what I hold (chips; a click on a seated chip releases it) + total + "Satış Yap" (F9).
function SellBar({ day, state, setState, failed, seated }) {
  const t = useT();
  const { mine } = state;
  // toggle is not idempotent: a double-click on a chip would release then re-hold the seat, so one request per seat
  const [releasing, setReleasing] = useState(() => new Set());
  const inFlight = useRef(new Set());
  const release = async (s) => {
    if (inFlight.current.has(s.id)) return;
    inFlight.current.add(s.id);
    setReleasing((p) => new Set(p).add(s.id));
    try { setState((await post(`/api/days/${day.id}/toggle`, { ticketId: s.id })).state); } catch (e) { failed(e); } finally {
      inFlight.current.delete(s.id);
      setReleasing((p) => { const n = new Set(p); n.delete(s.id); return n; });
    }
  };
  const sell = async () => {
    const rows = seated
      ? mine.list.map((s) => [seatLabel(s.row, s.num), money(s.price)])
      : [[t("countLine", { n: mine.count, price: money(mine.list[0]?.price ?? 0) }), ""]];
    const ok = await confirmDialog({
      title: t("sellTitle", { n: mine.count }),
      // list scrolls, total stays pinned (CSS .sell-sum); spans because the kit wraps text in a <p>
      text: (
        <span className="sell-sum">
          <span className="sell-rows">{rows.map(([a, b], i) => <span key={i} className="sell-row"><span>{a}</span><b>{b}</b></span>)}</span>
          <span className="sell-total"><span>{t("total")}</span><b>{money(mine.total)}</b></span>
        </span>
      ),
      ok: t("sell"), danger: false,
    });
    if (!ok) return false;
    try {
      const r = await post(`/api/days/${day.id}/sell`, { ticketIds: mine.list.map((s) => s.id) });
      setState(r.state);
      toast(t("soldN", { n: r.sold.length, total: money(r.total) }));
      return true;
    } catch (e) { failed(e); return false; }
  };
  return (
    <div className="sellbar" data-empty={!mine.count || undefined}>
      <div className="sellbar-in">
        <div className="sellbar-list">
          <span className="sellbar-title">{t("myHolds")}</span>
          {!mine.count ? <span className="muted small">{seated ? t("noHoldsSeated") : t("noHoldsCount")}</span>
            : seated ? (
              <ul className="hold-chips">
                {mine.list.map((s) => (
                  <li key={s.id}><button className="hold-chip" onClick={() => release(s)} disabled={releasing.has(s.id)} aria-busy={releasing.has(s.id) || undefined} data-tip={t("releaseSeat")}>
                    <b>{seatLabel(s.row, s.num)}</b><span>{money(s.price)}</span><span className="x" aria-hidden>×</span></button></li>
                ))}
              </ul>
            ) : <span className="hold-count">{t("countLine", { n: mine.count, price: money(mine.list[0]?.price ?? 0) })}</span>}
        </div>
        <div className="sellbar-total"><span className="stat-l">{t("total")}</span><b>{money(mine.total)}</b></div>
        <Busy className="btn btn-primary btn-lg" onClick={sell} disabled={!mine.count}>{t("sell")}</Busy>
      </div>
    </div>
  );
}

// F10 başkan: cancel sold seats ("a-32, b-25") or N tickets on a count hall. Live preview, confirm (red "İptal et").
function CancelCard({ day, state, setState, failed, seated }) {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const preview = seated ? cancelPreview(text) : null;
  const n = seated ? null : cancelCount(text, state.sold.count);
  const submit = async () => {
    setError(null);
    if (!text.trim()) { setError(seated ? t("cancelEmpty") : t("cancelCountBad", { max: state.sold.count })); return false; }
    // Malformed input can't cancel anything (the server is all-or-nothing), so it goes straight to the server for its
    // grouped message; a well-formed list is confirmed first.
    const wellFormed = seated ? preview.ok : n != null;
    if (wellFormed) {
      const what = seated ? preview.seats.join(", ") : t("countTickets", { n });
      const ok = await confirmDialog({ title: t("cancelTitle"), text: `${what}\n\n${t("cancelWarn")}`, ok: t("cancelOk"), danger: true });
      if (!ok) return false;
    }
    try {
      const r = await post(`/api/days/${day.id}/cancel`, seated ? { tickets: text } : { count: /^\s*-?\d+\s*$/.test(text) ? Number(text) : text });
      setState(r.state);
      setText("");
      toast(t("cancelledN", { n: r.cancelled.length }));
      return true;
    } catch (e) { setError(e.message); failed(e); return false; }
  };
  return (
    <section className="card cancel-card">
      <div className="cancel-head"><h2>{t("cancelSale")}</h2><span className="muted small">{t("bossOnly")}</span></div>
      <form className="cancel-form" onSubmit={(e) => e.preventDefault()}>
        {seated
          ? <textarea className="input mono textarea" rows={2} placeholder="a-32, b-25" value={text} spellCheck={false} aria-label={t("cancelSale")}
              aria-invalid={!!error || (preview.bad.length > 0) || undefined} onChange={(e) => { setText(e.target.value); setError(null); }} />
          : <input className="input narrow" inputMode="numeric" placeholder="1" value={text} aria-label={t("cancelSale")}
              aria-invalid={!!error || undefined} onChange={(e) => { setText(e.target.value); setError(null); }} />}
        <Busy className="btn btn-danger" type="submit" onClick={submit}>{t("cancelOk")}</Busy>
      </form>
      {seated && text.trim() && (
        <ul className="preview-chips" aria-live="polite">
          {preview.seats.map((s) => <li key={s} className="chip">{s}</li>)}
          {preview.bad.map((s, i) => <li key={`b${i}`} className="chip chip-bad">{s || t("emptyItem")}</li>)}
          {preview.dup.map((s) => <li key={`d${s}`} className="chip chip-warn">{t("dupItem", { seat: s })}</li>)}
        </ul>
      )}
      {!seated && text.trim() && n == null && <p className="muted small">{t("cancelCountBad", { max: state.sold.count })}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="muted small">{seated ? t("cancelHint") : t("cancelCountHint", { max: state.sold.count })}</p>
    </section>
  );
}
