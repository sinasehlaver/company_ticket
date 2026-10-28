import { setPrefs, usePrefs } from "./prefs.js";
import { useT } from "./i18n.js";
import { app } from "./app.js";
import { Appearance } from "./Appearance.jsx";

// Segmented control with a sliding thumb (CSS vars --i / --n position it; buttons are equal width).
export function Seg({ value, options, onChange, label, text = (o) => o }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label} style={{ "--i": Math.max(0, options.indexOf(value)), "--n": options.length }}>
      <span className="seg-thumb" aria-hidden />
      {options.map((o) => (
        <button key={o} role="radio" aria-checked={value === o} className="seg-btn" onClick={() => onChange(o)}>{text(o)}</button>
      ))}
    </div>
  );
}

export function Settings({ onReset }) {
  const t = useT();
  const p = usePrefs();
  return (
    <div className="page">
      <h1>{t("settings")}</h1>
      <Appearance />
      <div className="field"><label>{t("language")}</label><Seg label={t("language")} value={p.lang} options={app.languages} text={(l) => l.toUpperCase()} onChange={(lang) => setPrefs({ lang })} /></div>
      <div className="field"><label>{t("dataSection")}</label><button className="btn" onClick={onReset}>{t("resetData")}</button></div>
    </div>
  );
}
