import { useEffect, useState } from "react";
import { useT } from "look/kit/i18n.js";
import { usePrefs } from "look/kit/prefs.js";
import { toast } from "look/kit/Toasts.jsx";
import { Select } from "look/kit/Select.jsx";
import { DatePicker } from "look/kit/DatePicker.jsx";
import { Switch } from "look/kit/Controls.jsx";
import { Empty, ErrorState } from "look/kit/States.jsx";
import { get, post, put } from "../api.js";
import { DeleteButton } from "../ui/TypedConfirm.jsx";
import { RenameTitle } from "./Halls.jsx";
import { go } from "../router.js";
import { useLoad } from "../ui/useLoad.js";
import { Busy } from "../ui/Busy.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { dayParts, istanbulToday, money, num } from "../format.js";
import { isPrice, missingRows, pricesBody } from "../prices.js";
import { PriceEditor } from "./PriceEditor.jsx";

// F2 list of events (newest first). Başkan+: "Yeni etkinlik" (F5) inline card, also reached by #/events/new.
export function Events({ boss, creating }) {
  const t = useT();
  const { lang } = usePrefs();
  const list = useLoad(() => get("/api/events"), []);
  const [open, setOpen] = useState(!!creating);
  useEffect(() => setOpen(!!creating), [creating]);
  const events = list.data?.events ?? [];
  return (
    <div className="page page-mid">
      <header className="view-head">
        <div><h1>{t("tabEvents")}</h1><p className="muted">{t("eventsHint")}</p></div>
        {boss && !open && <button className="btn btn-primary" onClick={() => setOpen(true)}>＋ {t("newEvent")}</button>}
      </header>
      {boss && open && <NewEventCard onDone={(ev) => { setOpen(false); if (ev) go(`events/${ev.id}`); else if (creating) go("events"); }} />}
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} />
        : list.loading && !list.data ? <Skeleton cards={3} />
        : !events.length ? <Empty title={t("noEvents")} hint={boss ? t("noEventsBoss") : t("noEventsHint")} />
        : (
          <ul className="cards-grid">
            {events.map((e) => {
              const p = e.firstDate ? dayParts(e.firstDate, lang) : null;
              return (
                <li key={e.id}>
                  <a className="card card-link" href={`#/events/${e.id}`}>
                    <span className="card-title ell">{e.name}</span>
                    <span className="card-meta"><span className="chip">{e.hallName}</span>
                      <span className="muted">{t("dayCount", { n: e.dayCount })}</span></span>
                    <span className="muted small">{p ? t("firstDay", { date: `${p.day} ${p.month} ${p.year}` }) : t("noDaysYet")}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}

function NewEventCard({ onDone }) {
  const t = useT();
  const halls = useLoad(() => get("/api/halls"), []);
  const [name, setName] = useState("");
  const [hallId, setHallId] = useState(null);
  const [error, setError] = useState(null);
  const list = halls.data?.halls ?? [];
  useEffect(() => { if (hallId == null && list.length) setHallId(list[0].id); }, [list, hallId]);
  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError(t("nameRequired")); return false; }
    try {
      const r = await post("/api/events", { name: name.trim(), hallId });
      toast(t("eventCreated", { name: r.event.name }));
      onDone(r.event);
      return true;
    } catch (e) { setError(e.message); toast(e.message); return false; }
  };
  return (
    <form className="card form-card" onSubmit={(e) => e.preventDefault()}>
      <h2>{t("newEvent")}</h2>
      <div className="form-row">
        <label className="field-v grow"><span>{t("eventName")}</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("eventNamePh")} aria-invalid={!!error && !name.trim()} />
        </label>
        <div className="field-v"><span>{t("hall")}</span>
          {halls.error ? <span className="form-error">{halls.error.message}</span>
            : <Select label={t("hall")} value={hallId} onChange={setHallId}
              options={list.map((h) => ({ value: h.id, label: h.name, desc: h.kind === "count" ? t("countHallDesc", { n: num(h.seatCount) }) : t("seatedHallDesc", { n: num(h.seatCount) }) }))} />}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-btns">
        <button type="button" className="btn btn-ghost" onClick={() => onDone(null)}>{t("cancel")}</button>
        <Busy type="submit" onClick={submit} disabled={hallId == null}>{t("create")}</Busy>
      </div>
    </form>
  );
}

// F2 event → its days as cards. Başkan+: "Yeni gün".
export function Event({ id, boss, sudo }) {
  const t = useT();
  const { lang } = usePrefs();
  const ev = useLoad(() => get(`/api/events/${id}`), [id]);
  if (ev.error) return <div className="page page-mid"><ErrorState message={ev.error.message} onRetry={ev.reload} /></div>;
  if (!ev.data) return <div className="page page-mid"><Skeleton head cards={3} /></div>;
  const e = ev.data.event;
  const rename = async (name) => { const r = await put(`/api/events/${e.id}`, { name }); ev.setData(r); return r.event.name; };
  return (
    <div className="page page-mid">
      <header className="view-head">
        <div><p className="crumb"><a href="#/events">{t("tabEvents")}</a></p>
          {boss ? <RenameTitle name={e.name} label={t("eventName")} save={rename} /> : <h1>{e.name}</h1>}
          <p className="muted">{boss ? <a className="chip chip-link" href={`#/halls/${e.hallId}`}>{e.hallName}</a> : <span className="chip">{e.hallName}</span>} · {t("dayCount", { n: e.days.length })}</p></div>
        <div className="head-chips">
          {sudo && <DeleteButton title={t("deleteEventTitle", { name: e.name })} text={t("deleteEventText", { n: e.days.length })} name={e.name}
            path={`/api/events/${e.id}`} onDone={() => go("events")} />}
          {boss && <a className="btn btn-primary" href={`#/events/${e.id}/new-day`}>＋ {t("newDay")}</a>}
        </div>
      </header>
      {!e.days.length ? <Empty title={t("noDays")} hint={boss ? t("noDaysBoss") : t("noDaysHint")} /> : (
        <ul className="cards-grid days-grid">
          {e.days.map((d) => {
            const p = dayParts(d.date, lang);
            return (
              <li key={d.id}>
                <a className="card card-link day-card" href={`#/day/${d.id}`}>
                  <span className="day-date"><b>{p.day}</b><span>{p.month}</span></span>
                  <span className="day-info"><span className="card-title">{p.weekday}</span>
                    <span className="day-time">{p.time}</span><span className="muted small">{e.hallName}</span></span>
                  <span className="card-arrow" aria-hidden>→</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// F6 create a day: Istanbul date + time, prices prefilled from the hall, "remember on the hall" switch (default on).
export function NewDay({ id, setBack }) {
  const t = useT();
  const data = useLoad(async () => {
    const { event } = await get(`/api/events/${id}`);
    const { hall } = await get(`/api/halls/${event.hallId}`);
    return { event, hall };
  }, [id]);
  const [date, setDate] = useState(istanbulToday());
  const [time, setTime] = useState("20:30");
  const [values, setValues] = useState(null);
  const [price, setPrice] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState(null);
  const [invalid, setInvalid] = useState([]);
  useEffect(() => { setBack?.(`events/${id}`); }, [id, setBack]);
  useEffect(() => {
    if (!data.data) return;
    const h = data.data.hall;
    setValues(Object.fromEntries(h.rows.map((r) => [r, h.prices[r] != null ? String(h.prices[r]) : ""])));
    setPrice(h.price != null ? String(h.price) : "");
  }, [data.data]);
  if (data.error) return <div className="page page-mid"><ErrorState message={data.error.message} onRetry={data.reload} /></div>;
  if (!data.data || values == null) return <div className="page page-mid"><Skeleton head cards={2} /></div>;
  const { event, hall } = data.data;
  const seated = hall.kind === "seated";
  const submit = async () => {
    setError(null); setInvalid([]);
    if (!/^\d{2}:\d{2}$/.test(time)) { setError(t("timeRequired")); return false; }
    let body;
    if (seated) {
      const miss = missingRows(hall.rows, values);
      if (miss.length) { setInvalid(miss); setError(t("pricesMissing", { rows: miss.map((r) => r.toUpperCase()).join(", ") })); return false; }
      body = { prices: pricesBody(hall.rows, values) };
    } else {
      if (!isPrice(price)) { setError(t("priceRequired")); return false; }
      body = { price: Number(price) };
    }
    try {
      const r = await post(`/api/events/${event.id}/days`, { date: `${date}T${time}`, remember, ...body });
      toast(t("dayCreated"));
      go(`day/${r.day.id}`);
      return true;
    } catch (e) { setError(e.message); toast(e.message); return false; }
  };
  return (
    <div className="page page-mid">
      <header className="view-head">
        <div><p className="crumb"><a href={`#/events/${event.id}`}>{event.name}</a></p><h1>{t("newDay")}</h1>
          <p className="muted">{hall.name} · {seated ? t("seatedHallDesc", { n: num(hall.seatCount) }) : t("countHallDesc", { n: num(hall.seatCount) })}</p></div>
      </header>
      <form className="card form-card" onSubmit={(e) => e.preventDefault()}>
        <div className="form-row">
          <div className="field-v"><span>{t("date")}</span><DatePicker label={t("date")} value={date} onChange={setDate} /></div>
          <label className="field-v"><span>{t("time")}</span>
            <input className="input input-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></label>
          <p className="muted small grow form-note">{t("tzNote")}</p>
        </div>
        <h2 className="sub-h">{t("prices")}</h2>
        {seated ? <PriceEditor rows={hall.rows} values={values} onChange={setValues} invalid={invalid} /> : (
          <label className="field-v narrow"><span>{t("ticketPrice")}</span>
            <span className="input-suffix"><input className="input" inputMode="numeric" value={price} aria-invalid={!!error && !isPrice(price)}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 5))} /><span aria-hidden>₺</span></span>
            {isPrice(price) && <span className="muted small">{t("countTotal", { n: num(hall.seatCount), total: money(hall.seatCount * Number(price)) })}</span>}
          </label>
        )}
        <Switch checked={remember} onChange={setRemember} label={t("rememberPrices")} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-btns">
          <a className="btn btn-ghost" href={`#/events/${event.id}`}>{t("cancel")}</a>
          <Busy type="submit" onClick={submit}>{t("createDay")}</Busy>
        </div>
      </form>
    </div>
  );
}
