import { app } from "./app.js";
import { useT } from "./i18n.js";
import { setPrefs, usePrefs } from "./prefs.js";
import { nextTheme } from "./pick-logic.js";
import { tip } from "./Tooltip.jsx";
import { StatusChip } from "./Controls.jsx";

const osDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

// Top bar (picks: left · centre · right, back bar, Mac toolbar and big title, combined). Left: back (non-root only),
// title, autosave status chip. Centre: underline tabs. Right: undo/redo, file, ⌘K, ?, one theme icon, and (only when
// app.users) the avatar. Each tooltip names its shortcut. On narrow screens the tabs move to a bottom bar (CSS).
export function Navbar({ tabs, route, go, canBack, onBack, history, onSave, onOpen, onPalette, onHelp, status, user, onSignOut }) {
  const t = useT();
  const { theme } = usePrefs();
  const dark = (theme === "system" ? (osDark() ? "dark" : "light") : theme) === "dark";
  return (
    <>
      <header className="nav">
        <div className="nav-side">
          {canBack && <button className="btn btn-ghost btn-icon" onClick={onBack} aria-label={t("back")} data-tip={tip(t("back"), "escape")}>←</button>}
          <strong className="nav-title ell">{app.title}</strong>
          {status && <StatusChip state={status} />}
        </div>
        <nav className="tabs nav-tabs" aria-label="Views">
          {tabs.map((tab) => (
            <button key={tab.id} className="tab" aria-current={route === tab.id ? "page" : undefined} onClick={() => go(tab.id)}>{t(tab.label)}</button>
          ))}
        </nav>
        <div className="nav-side nav-end">
          <button className="btn btn-ghost btn-icon" disabled={!history.canUndo} onClick={history.undo} aria-label={t("undo")} data-tip={tip(t("undo"), "mod+z")}>↶</button>
          <button className="btn btn-ghost btn-icon" disabled={!history.canRedo} onClick={history.redo} aria-label={t("redo")} data-tip={tip(t("redo"), "mod+shift+z")}>↷</button>
          <button className="btn btn-ghost btn-icon" onClick={onOpen} aria-label={t("open")} data-tip={tip(t("open"), "mod+o")}>⤒</button>
          <button className="btn btn-ghost btn-icon" onClick={onSave} aria-label={t("save")} data-tip={tip(t("save"), "mod+s")}>⤓</button>
          <button className="btn btn-ghost btn-icon" onClick={onPalette} aria-label={t("palette")} data-tip={tip(t("palette"), "mod+k")}>⌘</button>
          <button className="btn btn-ghost btn-icon" onClick={onHelp} aria-label={t("shortcuts")} data-tip={tip(t("shortcuts"), "?")}>?</button>
          <button className="btn btn-ghost btn-icon" onClick={() => setPrefs({ theme: nextTheme(theme, osDark()) })} aria-label={t("theme")} data-tip={dark ? t("light") : t("dark")}>{dark ? "☀" : "☾"}</button>
          {app.users && user && (
            <button className="btn avatar" onClick={onSignOut} data-tip={t("signOut")} aria-label={`${user.name} — ${t("signOut")}`}>{user.name.slice(0, 1).toUpperCase()}</button>
          )}
        </div>
      </header>
      <nav className="tabs tabbar" aria-label="Views (mobile)">
        {tabs.map((tab) => (
          <button key={tab.id} className="tab" aria-current={route === tab.id ? "page" : undefined} onClick={() => go(tab.id)}>{t(tab.label)}</button>
        ))}
      </nav>
    </>
  );
}
