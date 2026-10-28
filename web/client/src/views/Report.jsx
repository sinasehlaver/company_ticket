import { useT } from "look/kit/i18n.js";
import { usePrefs } from "look/kit/prefs.js";
import { useState } from "react";
import { Select } from "look/kit/Select.jsx";
import { Empty, ErrorState } from "look/kit/States.jsx";
import { get } from "../api.js";
import { useLoad } from "../ui/useLoad.js";
import { Skeleton } from "../ui/Skeleton.jsx";
import { dayShort, money, num } from "../format.js";

// Rapor (başkan+): sold + revenue per event and day, split by sales point and by price; CSV download (Excel, TR).
export function Report() {
  const t = useT();
  const { lang } = usePrefs();
  const [event, setEvent] = useState("");
  const events = useLoad(() => get("/api/events"), []);
  const res = useLoad(() => get(`/api/report${event ? `?event=${event}` : ""}`), [event]);
  const options = [{ value: "", label: t("allEvents") }, ...(events.data?.events ?? []).map((e) => ({ value: String(e.id), label: e.name }))];
  const r = res.data;
  return (
    <div className="page page-mid report-page">
      <header className="view-head">
        <div><h1>{t("tabReport")}</h1><p className="muted">{t("reportHint")}</p></div>
        <div className="head-chips">
          <Select label={t("event")} value={event} options={options} onChange={setEvent} />
          <a className="btn btn-soft" href={`/api/report.csv${event ? `?event=${event}` : ""}`} download data-tip={t("csvHint")}>{t("csv")}</a>
        </div>
      </header>
      {res.error ? <ErrorState message={res.error.message} onRetry={res.reload} />
        : !r ? <Skeleton cards={2} />
        : !r.events.length ? <Empty title={t("noReport")} hint={t("noReportHint")} />
        : <>
          <div className="stats">
            <div className="stat"><span className="stat-n">{num(r.totals.sold)}</span><span className="stat-l">{t("statSold")}</span></div>
            <div className="stat"><span className="stat-n">{money(r.totals.revenue)}</span><span className="stat-l">{t("statRevenue")}</span></div>
          </div>
          {r.events.map((e) => (
            <section key={e.id} className="card report-card">
              <div className="report-head">
                <h2><a href={`#/events/${e.id}`}>{e.name}</a></h2>
                <span className="muted small">{e.hallName}</span>
                <span className="spacer" />
                <span className="chip">{t("soldOf", { n: num(e.sold), cap: num(e.capacity) })}</span>
                <b className="report-sum">{money(e.revenue)}</b>
              </div>
              {!e.days.length ? <p className="muted small">{t("noDays")}</p> : (
                <div className="table-wrap">
                  <table className="log-table report-table">
                    <thead><tr><th>{t("colDay")}</th><th className="num">{t("statSold")}</th><th className="num">{t("statRevenue")}</th>
                      <th>{t("colByUser")}</th><th>{t("colByPrice")}</th></tr></thead>
                    <tbody>
                      {e.days.map((d) => (
                        <tr key={d.id}>
                          <td><a href={`#/day/${d.id}`}>{dayShort(d.date, lang)}</a></td>
                          <td className="num">{num(d.sold)}<span className="muted small"> / {num(d.capacity)}</span></td>
                          <td className="num"><b>{money(d.revenue)}</b></td>
                          <td className="wrap">{d.byUser.length ? d.byUser.map((u) => (
                            <span key={u.username} className="chip" data-tip={money(u.revenue)}>{u.username} <b>{num(u.count)}</b></span>)) : <span className="muted">—</span>}</td>
                          <td className="wrap">{d.byPrice.length ? d.byPrice.map((p) => (
                            <span key={p.price} className="chip" data-tip={money(p.revenue)}>{money(p.price)} × <b>{num(p.count)}</b></span>)) : <span className="muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </>}
    </div>
  );
}
