import { useState } from "react";
import { useT } from "./i18n.js";

// Placeholder gate for config.users. It only records a local display name — it is NOT authentication.
// A real app replaces onSubmit with a server login (httpOnly session cookie, authz on every route).
export function SignIn({ onSubmit }) {
  const t = useT();
  const [name, setName] = useState("");
  return (
    <form className="page signin" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim().slice(0, 40)); }}>
      <h1>{t("signIn")}</h1>
      <div className="field"><label htmlFor="n">{t("name")}</label><input id="n" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus /></div>
      <button className="btn btn-primary" disabled={!name.trim()}>{t("signIn")}</button>
    </form>
  );
}
