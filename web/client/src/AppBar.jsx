import { useRef, useState } from "react";
import { useT } from "look/kit/i18n.js";
import { setPrefs, usePrefs } from "look/kit/prefs.js";
import { nextTheme } from "look/kit/pick-logic.js";
import { tip } from "look/kit/Tooltip.jsx";
import { Popover, Menu } from "look/kit/Popover.jsx";
import { config } from "./config.js";

const osDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

// The kit Navbar always renders undo/redo + open/save (document apps). This is server data (plan "UI" deviations),
// so the app has its own bar on the same kit classes: back · title | underline tabs | ⌘K · ? · theme · ⚙ · user menu.
export function AppBar({ tabs, active, go, canBack, onBack, onPalette, onHelp, onSettings, me, onLogout }) {
  const t = useT();
  const { theme } = usePrefs();
  const dark = (theme === "system" ? (osDark() ? "dark" : "light") : theme) === "dark";
  const userBtn = useRef(null);
  const [menu, setMenu] = useState(false);
  const tabBtns = tabs.map((tab) => (
    <button key={tab.id} className="tab" aria-current={active === tab.id ? "page" : undefined} onClick={() => go(tab.id)}>{t(tab.label)}</button>
  ));
  return (
    <>
      <header className="nav">
        <div className="nav-side">
          {canBack && <button className="btn btn-ghost btn-icon" onClick={onBack} aria-label={t("back")} data-tip={tip(t("back"), "escape")}>←</button>}
          <button className="brand" onClick={() => go("events")} aria-label={config.title}>
            <span className="brand-mark" aria-hidden>C</span><strong className="nav-title ell">{config.title}</strong>
          </button>
        </div>
        <nav className="tabs nav-tabs" aria-label={t("views")}>{tabBtns}</nav>
        <div className="nav-side nav-end">
          <button className="btn btn-ghost btn-icon hide-sm" onClick={onPalette} aria-label={t("palette")} data-tip={tip(t("palette"), "mod+k")}>⌘</button>
          <button className="btn btn-ghost btn-icon hide-sm" onClick={onHelp} aria-label={t("shortcuts")} data-tip={tip(t("shortcuts"), "?")}>?</button>
          <button className="btn btn-ghost btn-icon" onClick={() => setPrefs({ theme: nextTheme(theme, osDark()) })} aria-label={t("theme")} data-tip={dark ? t("light") : t("dark")}>{dark ? "☀" : "☾"}</button>
          <button className="btn btn-ghost btn-icon" onClick={onSettings} aria-label={t("settings")} data-tip={t("settings")}>⚙</button>
          <button ref={userBtn} className="user-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} data-tip={`${me.username} · ${t(`role_${me.role}`)}`}>
            <span className="avatar-dot" aria-hidden>{me.username.slice(0, 1).toLocaleUpperCase("tr")}</span>
            <span className="user-name ell hide-sm">{me.username}</span>
          </button>
        </div>
      </header>
      <Popover open={menu} anchor={userBtn.current} onClose={() => setMenu(false)} width={220}>
        <div className="user-card">
          <strong className="ell">{me.username}</strong>
          <span className="role-chip" data-role={me.role}>{t(`role_${me.role}`)}</span>
        </div>
        <Menu onClose={() => setMenu(false)} items={[
          { id: "settings", label: t("settings"), icon: "⚙", run: onSettings },
          "-",
          { id: "logout", label: t("logout"), icon: "⎋", danger: true, run: onLogout },
        ]} />
      </Popover>
      <nav className="tabs tabbar" aria-label={t("views")}>{tabBtns}</nav>
    </>
  );
}
