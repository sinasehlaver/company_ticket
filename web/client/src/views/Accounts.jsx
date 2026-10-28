import { useState } from "react";
import { useT } from "look/kit/i18n.js";
import { usePrefs } from "look/kit/prefs.js";
import { toast } from "look/kit/Toasts.jsx";
import { confirmDialog } from "look/kit/Dialog.jsx";
import { Select } from "look/kit/Select.jsx";
import { Switch } from "look/kit/Controls.jsx";
import { Empty, ErrorState } from "look/kit/States.jsx";
import { get, post, put } from "../api.js";
import { useLoad } from "../ui/useLoad.js";
import { Busy } from "../ui/Busy.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { stamp } from "../format.js";

// Hesaplar (başkan+). Başkan manages sales accounts; the superuser manages every account but its own. The server
// enforces the same rules (and never lets the last active superuser go); the UI just hides what would be refused.
// Only the superuser changes roles (per-row Select -> in-app confirm -> PUT {role}).
const canManage = (me, u) => me.id !== u.id && (me.role === "superuser" || u.role === "sales");

export function Accounts({ me }) {
  const t = useT();
  const { lang } = usePrefs();
  const res = useLoad(() => get("/api/users"), []);
  const [shown, setShown] = useState(null); // {username, password} shown once
  const replace = (u) => res.setData((d) => ({ ...d, users: d.users.map((x) => (x.id === u.id ? u : x)) }));
  const setDisabled = async (u, disabled) => {
    try {
      const r = await put(`/api/users/${u.id}`, { disabled });
      replace(r.user);
      toast(t(disabled ? "userDisabled" : "userEnabled", { name: u.username }));
      return true;
    } catch (e) { toast(e.message); return false; }
  };
  const reset = async (u) => {
    const ok = await confirmDialog({ title: t("resetTitle", { name: u.username }), text: t("resetText"), ok: t("resetOk"), danger: true });
    if (!ok) return false;
    try {
      const r = await post(`/api/users/${u.id}/password`, { generate: true });
      setShown({ username: u.username, password: r.password });
      toast(t("passwordReset", { name: u.username }));
      return true;
    } catch (e) { toast(e.message); return false; }
  };
  const changeRole = async (u, role) => {
    if (role === u.role) return;
    const from = t(`role_${u.role}`), to = t(`role_${role}`);
    const ok = await confirmDialog({ title: t("roleTitle", { name: u.username, from, to }), text: t("roleText"), ok: t("roleOk"), danger: role !== "superuser" && u.role !== "sales" });
    if (!ok) return;
    try {
      const r = await put(`/api/users/${u.id}`, { role });
      replace(r.user);
      toast(t("roleChanged", { name: u.username, role: to }));
    } catch (e) { toast(e.message); }
  };
  const roleOpts = ["sales", "baskan", "superuser"].map((v) => ({ value: v, label: t(`role_${v}`) }));
  const users = res.data?.users;
  return (
    <div className="page page-mid accounts-page">
      <header className="view-head"><div><h1>{t("tabAccounts")}</h1>
        <p className="muted">{me.role === "superuser" ? t("accountsHintSuper") : t("accountsHintBoss")}</p></div></header>
      <NewUser me={me} min={res.data?.minPassword ?? 8} onCreated={(u, password) => {
        res.setData((d) => ({ ...d, users: [...d.users, u] }));
        toast(t("userCreated", { name: u.username }));
        if (password) setShown({ username: u.username, password });
      }} />
      {res.error ? <ErrorState message={res.error.message} onRetry={res.reload} />
        : !users ? <Skeleton cards={1} />
        : !users.length ? <Empty title={t("noUsers")} hint="" />
        : (
          <div className="card table-card">
            <table className="log-table accounts-table">
              <thead><tr><th>{t("username")}</th><th>{t("colRole")}</th><th>{t("colActive")}</th><th>{t("colLastLogin")}</th><th className="num"><span className="sr-only">{t("actions")}</span></th></tr></thead>
              <tbody>
                {users.map((u) => {
                  const can = canManage(me, u);
                  return (
                    <tr key={u.id} data-user={u.username} data-off={u.disabled || undefined}>
                      <td><b>{u.username}</b>{u.id === me.id && <span className="muted small"> · {t("you")}</span>}</td>
                      <td>{can && me.role === "superuser"
                        ? <span className="role-select" data-role-select={u.username}><Select label={t("roleFor", { name: u.username })} value={u.role} options={roleOpts} onChange={(v) => changeRole(u, v)} width={170} /></span>
                        : <span className="chip" data-role={u.role}>{t(`role_${u.role}`)}</span>}</td>
                      <td>{can
                        ? <ActiveSwitch u={u} onChange={(v) => setDisabled(u, !v)} label={t("activeFor", { name: u.username })} />
                        : <span className={u.disabled ? "muted" : ""}>{u.disabled ? t("inactive") : t("active")}</span>}</td>
                      <td className="small">{u.lastLogin ? stamp(u.lastLogin, lang) : <span className="muted">{t("never")}</span>}</td>
                      <td className="num">{can && <Busy className="btn btn-ghost btn-sm" onClick={() => reset(u)}>{t("resetPassword")}</Busy>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {shown && <PasswordOnce {...shown} onClose={() => setShown(null)} />}
    </div>
  );
}

function ActiveSwitch({ u, onChange, label }) {
  const [busy, setBusy] = useState(false);
  return (
    <span className="active-switch" aria-busy={busy || undefined}>
      <button type="button" role="switch" aria-checked={!u.disabled} aria-label={label} className="switch" disabled={busy}
        onClick={async () => { setBusy(true); await onChange(u.disabled); setBusy(false); }}><span className="switch-knob" /></button>
    </span>
  );
}

function NewUser({ me, min, onCreated }) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("sales");
  const [generate, setGenerate] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const roles = [{ value: "sales", label: t("role_sales") }, ...(me.role === "superuser" ? [{ value: "baskan", label: t("role_baskan") }] : [])];
  const submit = async () => {
    setError(null);
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(username.trim())) { setError(t("usernameBad")); return false; }
    if (!generate && password.length < min) { setError(t("passwordShort", { n: min })); return false; }
    try {
      const r = await post("/api/users", { username: username.trim(), role, ...(generate ? { generate: true } : { password }) });
      onCreated(r.user, r.password);
      setUsername(""); setPassword("");
      return true;
    } catch (e) { setError(e.message); toast(e.message); return false; }
  };
  return (
    <form className="card form-card new-user" onSubmit={(e) => e.preventDefault()}>
      <h2>{t("newUser")}</h2>
      <div className="form-row">
        <label className="field-v"><span>{t("username")}</span>
          <input className="input" value={username} autoComplete="off" spellCheck={false} maxLength={40} onChange={(e) => setUsername(e.target.value)} /></label>
        <div className="field-v"><span>{t("colRole")}</span><Select label={t("colRole")} value={role} options={roles} onChange={setRole} width={200} /></div>
        {!generate && <label className="field-v"><span>{t("password")}</span>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
      </div>
      <Switch checked={generate} onChange={setGenerate} label={t("generatePassword")} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-btns"><Busy type="submit" onClick={submit}>{t("createUser")}</Busy></div>
    </form>
  );
}

// The generated password, shown exactly once (the server keeps only the hash).
function PasswordOnce({ username, password, onClose }) {
  const t = useT();
  const copy = async () => {
    try { await navigator.clipboard.writeText(password); toast(t("copied")); } catch { toast(t("copyFailed")); }
  };
  return (
    <div className="overlay overlay-center" onMouseDown={onClose}>
      <div className="dialog dialog-confirm pw-dialog" role="dialog" aria-modal="true" aria-labelledby="pw-title" onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
        <h2 id="pw-title">{t("pwTitle", { name: username })}</h2>
        <p className="muted">{t("pwOnce")}</p>
        <div className="pw-box"><code className="mono pw-value">{password}</code>
          <button type="button" className="btn btn-soft btn-sm" onClick={copy}>{t("copy")}</button></div>
        <div className="dialog-btns"><button type="button" className="btn btn-primary" autoFocus onClick={onClose}>{t("done")}</button></div>
      </div>
    </div>
  );
}
