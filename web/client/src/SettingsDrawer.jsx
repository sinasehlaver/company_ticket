import { useEffect, useRef } from "react";
import { useT } from "look/kit/i18n.js";
import { setPrefs, usePrefs } from "look/kit/prefs.js";
import { Appearance } from "look/kit/Appearance.jsx";
import { Seg } from "look/kit/Settings.jsx";
import { config } from "./config.js";
import { BackupSection } from "./views/Backup.jsx";

// Right drawer: Appearance (every ui-picker foundation) + language + account. The kit Settings page is not reused because
// its "Reset to sample data" button is for local-document apps. "Yedek" (backup) = views/Backup.jsx.
export function SettingsDrawer({ open, onClose, me, onLogout }) {
  const t = useT();
  const p = usePrefs();
  const ref = useRef(null);
  useEffect(() => { if (open) setTimeout(() => ref.current?.focus(), 0); }, [open]);
  if (!open) return null;
  const boss = me.role === "baskan" || me.role === "superuser";
  return (
    <div className="overlay drawer-overlay" onMouseDown={onClose}>
      <aside ref={ref} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label={t("settings")} onMouseDown={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>{t("settings")}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label={t("close")} data-tip={t("close")}>✕</button>
        </header>
        <div className="drawer-body">
          {boss ? <Appearance /> : (
            <div className="field">
              <label>{t("theme")}</label>
              <Seg label={t("theme")} value={p.theme} options={["light", "dark", "system"]} text={(v) => t(v)} onChange={(theme) => setPrefs({ theme })} />
            </div>
          )}
          <div className="field">
            <label>{t("language")}</label>
            <Seg label={t("language")} value={p.lang} options={config.languages} text={(l) => (l === "tr" ? "Türkçe" : "English")} onChange={(lang) => setPrefs({ lang })} />
          </div>
          {boss && <BackupSection me={me} />}
          <section className="drawer-section">
            <h2>{t("account")}</h2>
            <div className="account-row">
              <span className="avatar-dot" aria-hidden>{me.username.slice(0, 1).toLocaleUpperCase("tr")}</span>
              <span className="account-name"><strong>{me.username}</strong><span className="muted">{t(`role_${me.role}`)}</span></span>
              <button className="btn" onClick={() => { onClose(); onLogout(); }}>{t("logout")}</button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
