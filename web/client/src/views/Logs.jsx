import { useEffect, useState } from "react";
import { useT } from "look/kit/i18n.js";
import { usePrefs } from "look/kit/prefs.js";
import { Empty, ErrorState } from "look/kit/States.jsx";
import { toast } from "look/kit/Toasts.jsx";
import { get } from "../api.js";
import { useLoad } from "../ui/useLoad.js";
import { Busy } from "../ui/Busy.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { dayLabel, dayParts, dayShort, money, seatLabel, stamp } from "../format.js";

// F12 Loglar: every day, newest first.
export function Logs() {
  const t = useT();
  const { lang } = usePrefs();
  const list = useLoad(() => get("/api/logs/days"), []);
  const days = list.data?.days ?? [];
  return (
    <div className="page page-mid">
      <header className="view-head"><div><h1>{t("tabLogs")}</h1><p className="muted">{t("logsHint")}</p></div></header>
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} />
        : list.loading && !list.data ? <Skeleton cards={4} />
        : !days.length ? <Empty title={t("noLogDays")} hint={t("noLogDaysHint")} />
        : (
          <ul className="list-card card">
            {days.map((d) => {
              const p = dayParts(d.date, lang);
              return (
                <li key={d.id}><a className="list-row" href={`#/logs/${d.id}`}>
                  <span className="day-date sm"><b>{p.day}</b><span>{p.month}</span></span>
                  <span className="list-main"><span className="ell"><b>{d.eventName}</b></span><span className="muted small">{p.weekday} {p.time} · {d.hallName}</span></span>
                  <span className="card-arrow" aria-hidden>→</span>
                </a></li>
              );
            })}
          </ul>
        )}
    </div>
  );
}

// Day log + seat search (400 = unparseable seat, 404 = no such seat on this day; both shown inline).
export function DayLog({ id, setBack }) {
  const t = useT();
  const { lang } = usePrefs();
  const [seat, setSeat] = useState("");
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState(null);
  const url = (q) => `/api/days/${id}/logs${q ? `?seat=${encodeURIComponent(q)}` : ""}`;
  const res = useLoad(() => get(url(query)), [id, query]);
  useEffect(() => { setBack?.("logs"); }, [setBack]);
  useEffect(() => { setSeat(""); setQuery(""); setSearchError(null); }, [id]);
  // The search is tried first so a bad seat (400) / unknown seat (404) stays an inline error over the current list.
  const search = async () => {
    const q = seat.trim();
    setSearchError(null);
    if (!q) { setQuery(""); return true; }
    try {
      res.setData(await get(url(q)));
      setQuery(q);
      return true;
    } catch (e) {
      if (e.status === 400 || e.status === 404) setSearchError(e.message);
      else toast(e.message);
      return false;
    }
  };
  if (res.error) return <div className="page page-mid"><ErrorState message={res.error.message} onRetry={res.reload} /></div>;
  const d = res.data;
  if (!d) return <div className="page page-mid"><Skeleton head cards={1} /></div>;
  return (
    <div className="page page-mid">
      <header className="view-head">
        <div><p className="crumb"><a href="#/logs">{t("tabLogs")}</a> · <a href={`#/events/${d.day.event.id}`}>{d.day.event.name}</a></p>
          <h1>{dayLabel(d.day.date, lang)}</h1></div>
        <a className="btn btn-ghost btn-sm" href={`#/day/${d.day.id}`}>{t("seatPlan")}</a>
      </header>
      {d.days.length > 1 && (
        <nav className="tabs day-tabs" aria-label={t("days")}>
          {d.days.map((x) => <a key={x.id} className="tab" href={`#/logs/${x.id}`} aria-current={String(x.id) === String(id) ? "page" : undefined}>{dayShort(x.date, lang)}</a>)}
        </nav>
      )}
      <form className="search-row" onSubmit={(e) => e.preventDefault()}>
        <input className="input mono" placeholder="a-12" value={seat} aria-label={t("seatSearch")} aria-invalid={!!searchError || undefined}
          onChange={(e) => { setSeat(e.target.value); setSearchError(null); }} />
        <Busy type="submit" className="btn btn-soft" onClick={search}>{t("search")}</Busy>
        {d.seat && <button type="button" className="btn btn-ghost" onClick={() => { setSeat(""); setQuery(""); }}>{t("showAll")}</button>}
      </form>
      {searchError && <p className="form-error" role="alert">{searchError}</p>}
      {d.seat && <p className="muted">{t("seatFilter", { seat: d.seat.toUpperCase() })}</p>}
      {!d.logs.length ? <Empty title={t("noLogs")} hint={t("noLogsHint")} /> : (
        <div className="card table-card">
          <table className="log-table">
            <thead><tr><th>{t("colTime")}</th><th>{t("colAction")}</th><th>{t("colUser")}</th><th>{t("colSeat")}</th><th className="num">{t("colPrice")}</th></tr></thead>
            <tbody>
              {d.logs.map((l, i) => (
                <tr key={i}>
                  <td className="mono small">{stamp(l.at, lang)}</td>
                  <td><span className="chip" data-act={l.action === "satış" ? "sell" : "cancel"}>{l.action === "satış" ? t("actSell") : t("actCancel")}</span></td>
                  <td>{l.username}</td>
                  <td className="mono">{seatLabel(l.row, l.num)}</td>
                  <td className="num">{money(l.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
