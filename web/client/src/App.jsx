import { useCallback, useEffect, useState } from "react";
import { useT } from "look/kit/i18n.js";
import { usePrefs, setPrefs } from "look/kit/prefs.js";
import { useShortcuts } from "look/kit/shortcuts.js";
import { toast, Toasts } from "look/kit/Toasts.jsx";
import { Palette } from "look/kit/Palette.jsx";
import { Tooltip, keyLabel } from "look/kit/Tooltip.jsx";
import { DialogHost } from "look/kit/Dialog.jsx";
import { Loading, ErrorState } from "look/kit/States.jsx";
import { get, post, setCsrf, onUnauthorized } from "./api.js";
import { useRoute, go, split, parentOf } from "./router.js";
import { config } from "./config.js";
import { AppBar } from "./AppBar.jsx";
import { SettingsDrawer } from "./SettingsDrawer.jsx";
import { Login } from "./views/Login.jsx";
import { Events, Event, NewDay } from "./views/Events.jsx";
import { Halls, Hall, NewHall } from "./views/Halls.jsx";
import { Day } from "./views/Day.jsx";
import { Logs, DayLog } from "./views/Logs.jsx";
import { Report } from "./views/Report.jsx";
import { Accounts } from "./views/Accounts.jsx";
import { TypedDeleteHost } from "./ui/TypedConfirm.jsx";
import { RepriceHost } from "./ui/RepriceDialog.jsx";

export const RANK = { sales: 1, baskan: 2, superuser: 3 };
export const atLeast = (me, role) => (RANK[me?.role] ?? 0) >= RANK[role];

// Root tabs, filtered by role (the server enforces the same minRole per route).
const TABS = [
  { id: "events", label: "tabEvents", minRole: "sales" },
  { id: "halls", label: "tabHalls", minRole: "baskan" },
  { id: "logs", label: "tabLogs", minRole: "baskan" },
  { id: "report", label: "tabReport", minRole: "baskan" },
  { id: "accounts", label: "tabAccounts", minRole: "baskan" },
];
// One shortcut table: the cheat sheet and the tooltips are built from it.
const KEYS = [["mod+k", "palette"], ["?", "shortcuts"], ["escape", "back"], ["[", "prevDay"], ["]", "nextDay"]];

export default function App() {
  const t = useT();
  const [me, setMe] = useState(undefined); // undefined = asking the server, null = signed out
  const [bootError, setBootError] = useState(null);
  const restore = useCallback(() => {
    setBootError(null);
    get("/api/me").then(
      (r) => { setCsrf(r.csrf); setMe(r.user); },
      (e) => (e.status === 401 ? setMe(null) : setBootError(e)),
    );
  }, []);
  useEffect(restore, [restore]);
  useEffect(() => onUnauthorized(() => { setCsrf(""); setMe((m) => { if (m) toast(t("sessionEnded")); return null; }); }), [t]);

  let body;
  if (bootError) body = <div className="page"><ErrorState message={bootError.message} onRetry={restore} /></div>;
  else if (me === undefined) body = <div className="page"><Loading /></div>;
  else if (!me) body = <Login onIn={(r) => { setCsrf(r.csrf); setMe(r.user); }} />;
  else body = <Shell me={me} onOut={() => { setCsrf(""); setMe(null); }} />;
  return (
    <>
      {body}
      <DialogHost />
      <TypedDeleteHost />
      <RepriceHost />
      <Tooltip />
      <Toasts />
    </>
  );
}

function Shell({ me, onOut }) {
  const t = useT();
  const { lang } = usePrefs();
  const route = useRoute();
  const [back, setBack] = useState(null); // a view's real parent (a day knows its event), reset on every route change
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [events, setEvents] = useState([]);
  useEffect(() => setBack(null), [route]);

  const parts = split(route);
  const tabs = TABS.filter((tab) => atLeast(me, tab.minRole));
  const active = parts[0] === "day" ? "events" : parts[0];
  const parent = parentOf(route, back);
  const goBack = () => parent && go(parent);

  const logout = async () => {
    try { await post("/api/logout"); } catch { /* session already gone */ }
    onOut();
    toast(t("loggedOut"));
  };

  useShortcuts({
    "mod+k": () => setPalette((p) => !p),
    "?": () => setHelp(true),
    escape: () => {
      if (palette) setPalette(false);
      else if (help) setHelp(false);
      else if (settings) setSettings(false);
      else goBack();
    },
  });
  useEffect(() => {
    if (!palette) return;
    get("/api/events").then((r) => setEvents(r.events), () => {});
  }, [palette]);

  const commands = [
    ...tabs.map((tab) => ({ id: `tab-${tab.id}`, label: `${t("goTo")}: ${t(tab.label)}`, run: () => go(tab.id) })),
    ...(atLeast(me, "baskan") ? [
      { id: "new-event", label: t("newEvent"), run: () => go("events/new") },
      { id: "new-hall", label: t("newHall"), run: () => go("halls/new") },
    ] : []),
    ...events.map((e) => ({ id: `ev-${e.id}`, label: `${t("event")}: ${e.name}`, run: () => go(`events/${e.id}`) })),
    { id: "settings", label: t("settings"), run: () => setSettings(true) },
    { id: "theme-dark", label: `${t("theme")}: ${t("dark")}`, run: () => setPrefs({ theme: "dark" }) },
    { id: "theme-light", label: `${t("theme")}: ${t("light")}`, run: () => setPrefs({ theme: "light" }) },
    { id: "theme-system", label: `${t("theme")}: ${t("system")}`, run: () => setPrefs({ theme: "system" }) },
    { id: "lang", label: `${t("language")}: ${lang === "tr" ? "English" : "Türkçe"}`, run: () => setPrefs({ lang: lang === "tr" ? "en" : "tr" }) },
    { id: "help", label: t("shortcuts"), hint: "?", run: () => setHelp(true) },
    { id: "logout", label: t("logout"), run: logout },
  ];

  const [a, b, c] = parts;
  const ctx = { me, setBack, boss: atLeast(me, "baskan"), sudo: atLeast(me, "superuser") };
  let view;
  if (a === "events" && b === "new") view = <Events {...ctx} creating />;
  else if (a === "events" && b && c === "new-day") view = <NewDay {...ctx} id={b} />;
  else if (a === "events" && b) view = <Event {...ctx} id={b} />;
  else if ((a === "halls" || a === "logs") && !ctx.boss) view = <Events {...ctx} />;
  else if (a === "halls" && b === "new") view = <NewHall {...ctx} />;
  else if (a === "halls" && b) view = <Hall {...ctx} id={b} />;
  else if (a === "halls") view = <Halls {...ctx} />;
  else if (a === "day" && b) view = <Day {...ctx} id={b} />;
  else if (a === "logs" && b) view = <DayLog {...ctx} id={b} />;
  else if (a === "logs") view = <Logs {...ctx} />;
  else if (a === "report" && ctx.boss) view = <Report {...ctx} />;
  else if (a === "accounts" && ctx.boss) view = <Accounts {...ctx} />;
  else view = <Events {...ctx} />;

  useEffect(() => { document.title = config.title; }, [route]);

  return (
    <div className="shell">
      <AppBar tabs={tabs} active={active} go={go} canBack={!!parent} onBack={goBack} me={me} onLogout={logout}
        onPalette={() => setPalette(true)} onHelp={() => setHelp(true)} onSettings={() => setSettings(true)} />
      <main className="main"><div className="view" key={route}>{view}</div></main>
      <Palette open={palette} onClose={() => setPalette(false)} commands={commands} />
      {help && (
        <div className="overlay overlay-center" onMouseDown={() => setHelp(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label={t("shortcuts")} onMouseDown={(e) => e.stopPropagation()}>
            <h2>{t("shortcuts")}</h2>
            <dl className="keys">
              {KEYS.map(([k, act]) => <div key={k}><dt><kbd>{keyLabel(k)}</kbd></dt><dd>{t(act)}</dd></div>)}
            </dl>
          </div>
        </div>
      )}
      <SettingsDrawer open={settings} onClose={() => setSettings(false)} me={me} onLogout={logout} />
    </div>
  );
}
