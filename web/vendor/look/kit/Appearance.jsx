import { usePrefs, setPrefs, setLook } from "./prefs.js";
import { useT } from "./i18n.js";
import { FOUNDATIONS, DEFAULTS } from "./appearance.js";
import { Seg } from "./Settings.jsx";
import { Select } from "./Select.jsx";

// Settings → Appearance: the ui-picker foundations (look.js), defaulting to the user's picks. A change here overrides
// the pick for this app only (prefs.look); "Reset to my picks" drops the overrides. New picker options appear here
// after `node _look/scripts/sync.mjs`.
export function Appearance() {
  const t = useT();
  const p = usePrefs();
  const overridden = Object.keys(p.look || {}).length > 0 || p.theme !== DEFAULTS.theme;
  return (
    <section className="appearance" aria-label={t("appearance")}>
      <h2>{t("appearance")}</h2>
      {FOUNDATIONS.map((f) => {
        const value = f.attr === "theme" ? p.theme : p.look?.[f.attr] ?? DEFAULTS[f.attr];
        const set = (v) => (f.attr === "theme" ? setPrefs({ theme: v }) : setLook(f.attr, v === DEFAULTS[f.attr] ? undefined : v));
        const name = (id) => (f.attr === "theme" ? t(id) : f.options.find((o) => o.id === id)?.name ?? id);
        const label = f.attr === "theme" ? t("theme") : f.title;
        return (
          <div className="field" key={f.attr}>
            <label>{label} <span className="look-pick">· {t("yourPick")}: {name(DEFAULTS[f.attr])}</span></label>
            {f.attr === "accent" ? (
              <div className="look-swatches" role="radiogroup" aria-label={label}>
                {f.options.map((o) => (
                  <button key={o.id} type="button" role="radio" aria-checked={value === o.id} aria-label={o.name} data-tip={o.name}
                    className="look-swatch" data-accent={o.id} onClick={() => set(o.id)} />
                ))}
              </div>
            ) : f.options.length <= 4 ? (
              <Seg label={label} value={value} options={f.options.map((o) => o.id)} text={name} onChange={set} />
            ) : (
              <Select label={label} value={value} options={f.options.map((o) => ({ value: o.id, label: o.name }))} onChange={set} />
            )}
          </div>
        );
      })}
      {overridden && <button className="btn" onClick={() => setPrefs({ look: {}, theme: DEFAULTS.theme })}>{t("resetLook")}</button>}
    </section>
  );
}
