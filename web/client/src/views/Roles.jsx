import { useState } from "react";
import { useT } from "look/kit/i18n.js";
import { toast } from "look/kit/Toasts.jsx";
import { confirmDialog } from "look/kit/Dialog.jsx";
import { Seg } from "look/kit/Settings.jsx";
import { Help } from "look/kit/Controls.jsx";
import { Empty, ErrorState } from "look/kit/States.jsx";
import { get, post, put, del } from "../api.js";
import { useLoad } from "../ui/useLoad.js";
import { Busy } from "../ui/Busy.jsx";
import { Skeleton } from "../ui/Skeleton.jsx";
import { roleLabel } from "../roles.js";

// Roller (cap roles, docs/ROLES_PLAN.md). One card per role: the cancel 3-way + grouped on/off switches, saved on each
// change (PUT, toast). superuser = locked "every permission" card. The server decides per role whether the caller may
// change it (`editable`: baskan only by the superuser; never a role holding caps the caller lacks) and refuses granting
// a cap the caller doesn't have; the UI mirrors that by disabling those switches. Built-ins can't be renamed/deleted;
// a role with accounts can't be deleted.
const GROUPS = [
  ["capGroupSales", ["releaseOthers"]],
  ["capGroupEvents", ["events", "reprice", "halls"]],
  ["capGroupView", ["logs", "report"]],
  ["capGroupAdmin", ["accounts", "backup", "roles"]],
];
const CANCEL = ["off", "own", "any"];
const CANCEL_RANK = { off: 0, own: 1, any: 2 };

export function Roles({ me }) {
  const t = useT();
  const res = useLoad(() => get("/api/roles"), []);
  const roles = res.data?.roles;
  const replace = (role) => res.setData((d) => ({ ...d, roles: d.roles.map((x) => (x.key === role.key ? role : x)) }));
  return (
    <div className="page page-mid roles-page">
      <header className="view-head"><div><h1>{t("tabRoles")}</h1>
        <p className="muted">{me.role === "superuser" ? t("rolesHintSuper") : t("rolesHint")}</p></div></header>
      <NewRole onCreated={(role) => { res.setData((d) => ({ ...d, roles: [...d.roles, role] })); toast(t("roleCreated", { name: role.name })); }} />
      {res.error ? <ErrorState message={res.error.message} onRetry={res.reload} />
        : !roles ? <Skeleton cards={2} />
        : !roles.length ? <Empty title={t("noRoles")} hint="" />
        : roles.map((r) => (
          <RoleCard key={r.key} role={r} me={me} onSaved={replace}
            onDeleted={() => res.setData((d) => ({ ...d, roles: d.roles.filter((x) => x.key !== r.key) }))} />
        ))}
    </div>
  );
}

function NewRole({ onCreated }) {
  const t = useT();
  const [name, setName] = useState("");
  const [error, setError] = useState(null);
  const submit = async () => {
    setError(null);
    if (!name.trim()) { setError(t("roleNameRequired")); return false; }
    try {
      const r = await post("/api/roles", { name: name.trim(), caps: {} });
      onCreated(r.role); setName("");
      return true;
    } catch (e) { setError(e.message); toast(e.message); return false; }
  };
  return (
    <form className="card form-card new-role" onSubmit={(e) => e.preventDefault()}>
      <h2>{t("newRole")}</h2>
      <div className="form-row">
        <label className="field-v"><span>{t("roleName")}</span>
          <input className="input" value={name} maxLength={40} placeholder={t("roleNamePh")} onChange={(e) => setName(e.target.value)} /></label>
        <Busy type="submit" onClick={submit}>{t("createRole")}</Busy>
      </div>
      <p className="muted small">{t("newRoleHint")}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

function RoleCard({ role, me, onSaved, onDeleted }) {
  const t = useT();
  const [busy, setBusy] = useState(null); // cap key being saved
  const name = roleLabel(t, role.key, role.name);
  const locked = role.key === "superuser";
  const sudo = me.role === "superuser";
  // a non-superuser can't grant what it lacks (server: 403 "Kendinizde olmayan…")
  const mayGrant = (cap, v) => sudo || (cap === "cancel" ? CANCEL_RANK[v] <= CANCEL_RANK[me.caps.cancel] : me.caps[cap] === true);
  const save = async (body, key) => {
    setBusy(key);
    try {
      const r = await put(`/api/roles/${role.key}`, body);
      onSaved(r.role);
      if (body.name) toast(t("renamed", { name: r.role.name }));
      else toast(t("roleSaved", { name }));
      return true;
    } catch (e) { toast(e.message); return false; } finally { setBusy(null); }
  };
  const setCap = (cap, v) => save({ caps: { ...role.caps, [cap]: v } }, cap);
  const remove = async () => {
    const ok = await confirmDialog({ title: t("deleteRoleTitle", { name }), text: t("deleteRoleText"), ok: t("delete"), danger: true });
    if (!ok) return false;
    try {
      await del(`/api/roles/${role.key}`);
      onDeleted(); toast(t("roleDeleted", { name }));
      return true;
    } catch (e) { toast(e.message); return false; }
  };
  return (
    <section className="card role-card" data-role-card={role.key} data-locked={!role.editable || undefined}>
      <div className="role-head">
        {role.editable && !role.builtin ? <RoleName name={role.name} save={(n) => save({ name: n }, "name")} /> : <h2>{name}</h2>}
        {role.builtin && <span className="chip">{t("builtinRole")}</span>}
        <span className="chip" data-tip={t("roleUsersHint")}>{t("roleUsers", { n: role.users })}</span>
        <span className="spacer" />
        {role.editable && !role.builtin && (role.users > 0
          ? <span className="muted small" data-tip={t("roleInUseHint")}>{t("roleInUse")}</span>
          : <Busy className="btn btn-ghost btn-sm btn-danger-text" onClick={remove}>{t("delete")}</Busy>)}
      </div>
      {locked ? <p className="muted">{t("everyCap")}</p> : <>
        {!role.editable && <p className="muted small">{role.key === "baskan" ? t("baskanLocked") : t("roleLocked")}</p>}
        <div className="cap-row" data-cap="cancel">
          <span className="cap-label">{t("cap_cancel")}<Help text={t("capHint_cancel")} /></span>
          {role.editable
            ? <span className="cap-seg" aria-busy={busy === "cancel" || undefined}>
                <Seg label={t("cap_cancel")} value={role.caps.cancel} options={CANCEL} text={(v) => t(`cancel_${v}`)}
                  onChange={(v) => { if (v === role.caps.cancel || busy) return; if (!mayGrant("cancel", v)) { toast(t("cantGrant")); return; } setCap("cancel", v); }} /></span>
            : <span className="chip">{t(`cancel_${role.caps.cancel}`)}</span>}
        </div>
        <div className="cap-groups">
          {GROUPS.map(([g, caps]) => (
            <div key={g} className="cap-group">
              <h3 className="sub-h">{t(g)}</h3>
              {caps.map((cap) => {
                const on = role.caps[cap] === true;
                const can = role.editable && (on || mayGrant(cap, true));
                return (
                  <div key={cap} className="cap-row" data-cap={cap}>
                    <span className="cap-label">{t(`cap_${cap}`)}<Help text={t(`capHint_${cap}`)} /></span>
                    <button type="button" role="switch" aria-checked={on} aria-label={`${name}: ${t(`cap_${cap}`)}`} className="switch"
                      disabled={!can || busy === cap} aria-busy={busy === cap || undefined}
                      data-tip={role.editable && !can ? t("cantGrant") : undefined}
                      onClick={() => setCap(cap, !on)}><span className="switch-knob" /></button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </>}
    </section>
  );
}

// h2 with ✎ → inline rename (custom roles only).
function RoleName({ name: current, save }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(current);
  if (!editing) return (
    <h2 className="title-edit">{current}
      <button className="btn btn-ghost btn-icon" onClick={() => { setName(current); setEditing(true); }} aria-label={t("rename")} data-tip={t("rename")}>✎</button></h2>
  );
  const submit = async () => {
    if (!name.trim()) { toast(t("roleNameRequired")); return false; }
    if (name.trim() === current) { setEditing(false); return true; }
    const ok = await save(name.trim());
    if (ok) setEditing(false);
    return ok;
  };
  return (
    <form className="rename-form" onSubmit={(e) => e.preventDefault()}>
      <input className="input" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label={t("roleName")}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} />
      <Busy type="submit" onClick={submit}>{t("save")}</Busy>
      <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>{t("cancel")}</button>
    </form>
  );
}
