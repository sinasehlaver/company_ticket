import { useEffect, useMemo, useState } from "react";
import { useT } from "look/kit/i18n.js";
import { toast } from "look/kit/Toasts.jsx";
import { Empty, ErrorState } from "look/kit/States.jsx";
import { get, post, put } from "../api.js";
import { go } from "../router.js";
import { useLoad } from "../ui/useLoad.js";
import { Busy } from "../ui/Busy.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { money, num } from "../format.js";
import { bandsFromPrices, buildLayout } from "../seatmap.js";
import { isPrice, missingRows, pricesBody } from "../prices.js";
import { PriceEditor } from "./PriceEditor.jsx";
import { DeleteButton } from "../ui/TypedConfirm.jsx";
import { SeatMap } from "./SeatMap.jsx";

// F2 Sahneler list.
export function Halls({ boss }) {
  const t = useT();
  const list = useLoad(() => get("/api/halls"), []);
  const halls = list.data?.halls ?? [];
  return (
    <div className="page page-mid">
      <header className="view-head">
        <div><h1>{t("tabHalls")}</h1><p className="muted">{t("hallsHint")}</p></div>
        {boss && <a className="btn btn-primary" href="#/halls/new">＋ {t("newHall")}</a>}
      </header>
      {list.error ? <ErrorState message={list.error.message} onRetry={list.reload} />
        : list.loading && !list.data ? <Skeleton cards={2} />
        : !halls.length ? <Empty title={t("noHalls")} hint={boss ? t("noHallsBoss") : t("noHallsHint")} />
        : (
          <ul className="cards-grid">
            {halls.map((h) => (
              <li key={h.id}>
                <a className="card card-link" href={`#/halls/${h.id}`}>
                  <span className="card-title ell">{h.name}</span>
                  <span className="card-meta"><span className="chip">{h.kind === "count" ? t("kindCount") : t("kindSeated")}</span>
                    <span className="muted">{t("seatN", { n: num(h.seatCount) })}</span></span>
                  <span className="muted small mono ell">{h.priceSchema || t("noPrices")}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

// F2/F4 Salon: read-only map preview; başkan+ renames and edits the saved prices (existing days keep theirs).
export function Hall({ id, boss, sudo }) {
  const t = useT();
  const res = useLoad(() => get(`/api/halls/${id}`), [id]);
  const hall = res.data?.hall;
  const layout = useMemo(() => (hall?.kind === "seated" ? buildLayout(hall.seats.all, bandsFromPrices(hall.prices)) : null), [hall]);
  if (res.error) return <div className="page page-mid"><ErrorState message={res.error.message} onRetry={res.reload} /></div>;
  if (!hall) return <div className="page page-wide"><Skeleton head map /></div>;
  const onSaved = (h) => res.setData({ hall: h });
  return (
    <div className="page page-wide">
      <header className="view-head">
        <div><p className="crumb"><a href="#/halls">{t("tabHalls")}</a></p>
          {boss ? <RenameTitle name={hall.name} label={t("hallName")} save={async (name) => { const r = await put(`/api/halls/${hall.id}`, { name }); onSaved(r.hall); return r.hall.name; }} />
            : <h1>{hall.name}</h1>}
          <p className="muted">{hall.kind === "count" ? t("countHallDesc", { n: num(hall.seatCount) }) : t("seatedHallDesc", { n: num(hall.seatCount) })}
            {hall.priceSchema && <> · <span className="mono">{hall.priceSchema}</span></>}</p></div>
        {sudo && <DeleteButton title={t("deleteHallTitle", { name: hall.name })} text={t("deleteHallText")} name={hall.name}
          path={`/api/halls/${hall.id}`} onDone={() => go("halls")} />}
      </header>
      {layout ? <section className="card map-card"><SeatMap layout={layout} onSeat={null} /></section> : (
        <section className="card count-preview"><span className="big-n">{num(hall.seatCount)}</span><span className="muted">{t("countSeats")}</span>
          <span className="muted">{hall.price ? t("savedPrice", { price: money(hall.price) }) : t("noPrices")}</span></section>
      )}
      {boss && <HallPrices hall={hall} onSaved={onSaved} />}
    </div>
  );
}

// Title with ✎ → inline rename. save(name) -> the saved name (throws ApiError on refusal).
export function RenameTitle({ name: current, label, save: persist }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(current);
  const [error, setError] = useState(null);
  useEffect(() => setName(current), [current]);
  if (!editing) return (
    <h1 className="title-edit">{current}
      <button className="btn btn-ghost btn-icon" onClick={() => setEditing(true)} aria-label={t("rename")} data-tip={t("rename")}>✎</button></h1>
  );
  const save = async () => {
    setError(null);
    if (!name.trim()) { setError(t("nameRequired")); return false; }
    try {
      const saved = await persist(name.trim());
      setEditing(false); toast(t("renamed", { name: saved }));
      return true;
    } catch (e) { setError(e.message); toast(e.message); return false; }
  };
  return (
    <form className="rename-form" onSubmit={(e) => e.preventDefault()}>
      <input className="input input-title" autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label={label}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); setName(current); } }} />
      <Busy type="submit" onClick={save}>{t("save")}</Busy>
      <button type="button" className="btn btn-ghost" onClick={() => { setEditing(false); setName(current); }}>{t("cancel")}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

function HallPrices({ hall, onSaved }) {
  const t = useT();
  const seated = hall.kind === "seated";
  const init = () => Object.fromEntries(hall.rows.map((r) => [r, hall.prices[r] != null ? String(hall.prices[r]) : ""]));
  const [values, setValues] = useState(init);
  const [price, setPrice] = useState(hall.price ? String(hall.price) : "");
  const [error, setError] = useState(null);
  const [invalid, setInvalid] = useState([]);
  const save = async () => {
    setError(null); setInvalid([]);
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
      const r = await put(`/api/halls/${hall.id}/prices`, body);
      onSaved(r.hall); toast(t("pricesSaved"));
      return true;
    } catch (e) { setError(e.message); toast(e.message); return false; }
  };
  return (
    <section className="card form-card">
      <h2>{t("hallPrices")}</h2>
      <p className="muted small">{t("hallPricesHint")}</p>
      {seated ? <PriceEditor rows={hall.rows} values={values} onChange={setValues} invalid={invalid} /> : (
        <label className="field-v narrow"><span>{t("ticketPrice")}</span>
          <span className="input-suffix"><input className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 5))} /><span aria-hidden>₺</span></span></label>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-btns"><Busy onClick={save}>{t("savePrices")}</Busy></div>
    </section>
  );
}

const SAMPLE = `{"all": [{"c": ["1", "2", "-1", "3", "4"]}, {"-": []}, {"b": ["1", "2", "3", "4", "5"]}]}`;

// F3 Yeni salon: name + seats JSON ({"all":[...]} or {"count":N}); the server validates the shape.
export function NewHall({ setBack }) {
  const t = useT();
  const [name, setName] = useState("");
  const [seats, setSeats] = useState("");
  const [error, setError] = useState(null);
  useEffect(() => { setBack?.("halls"); }, [setBack]);
  const parsed = useMemo(() => {
    if (!seats.trim()) return { ok: false };
    try { return { ok: true, value: JSON.parse(seats) }; } catch (e) { return { ok: false, error: e.message }; }
  }, [seats]);
  const preview = useMemo(() => {
    const all = parsed.ok && Array.isArray(parsed.value?.all) ? parsed.value.all : null;
    try { return all ? buildLayout(all) : null; } catch { return null; }
  }, [parsed]);
  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError(t("nameRequired")); return false; }
    if (!parsed.ok) { setError(parsed.error ? t("jsonBad", { msg: parsed.error }) : t("seatsRequired")); return false; }
    try {
      const r = await post("/api/halls", { name: name.trim(), seats: parsed.value });
      toast(t("hallCreated", { name: r.hall.name }));
      go(`halls/${r.hall.id}`);
      return true;
    } catch (e) { setError(e.message); toast(e.message); return false; }
  };
  return (
    <div className="page page-mid">
      <header className="view-head"><div><p className="crumb"><a href="#/halls">{t("tabHalls")}</a></p><h1>{t("newHall")}</h1></div></header>
      <form className="card form-card" onSubmit={(e) => e.preventDefault()}>
        <label className="field-v"><span>{t("hallName")}</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field-v"><span>{t("seatsJson")}</span>
          <textarea className="input mono textarea" rows={8} spellCheck={false} value={seats} placeholder={SAMPLE} aria-invalid={!!parsed.error || undefined}
            onChange={(e) => setSeats(e.target.value)} />
          <span className="muted small">{parsed.error ? <span className="form-error">{t("jsonBad", { msg: parsed.error })}</span> : t("seatsJsonHint")}</span>
        </label>
        {preview?.count > 0 && <div className="map-card mini"><SeatMap layout={preview} onSeat={null} /></div>}
        {parsed.ok && Number.isInteger(parsed.value?.count) && <p className="muted">{t("countHallDesc", { n: num(parsed.value.count) })}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-btns"><a className="btn btn-ghost" href="#/halls">{t("cancel")}</a><Busy type="submit" onClick={submit}>{t("create")}</Busy></div>
      </form>
    </div>
  );
}
