import { useState } from "react";
import { useT } from "look/kit/i18n.js";
import { post } from "../api.js";
import { Busy } from "../ui/Busy.jsx";
import { config } from "../config.js";

// F1. Server: 400 missing fields, 401 wrong, 403 disabled, 429 rate-limited (its own Turkish message is shown).
export function Login({ onIn }) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const submit = async () => {
    setError(null);
    if (!username.trim() || !password) { setError({ message: t("loginMissing") }); return false; }
    try {
      onIn(await post("/api/login", { username: username.trim(), password }));
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="login-brand"><span className="brand-mark brand-mark-lg" aria-hidden>C</span>
          <div><h1>{config.title}</h1><p className="muted">{t("loginHint")}</p></div>
        </div>
        <label className="field-v"><span>{t("username")}</span>
          <input className="input" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={username}
            aria-invalid={!!error} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field-v"><span>{t("password")}</span>
          <input className="input" name="password" type="password" autoComplete="current-password" value={password}
            aria-invalid={!!error} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="form-error" role="alert" data-status={error.status}>{error.status === 429 ? `⏳ ${error.message}` : error.message}</p>}
        <Busy type="submit" className="btn btn-primary btn-block" onClick={submit}>{t("login")}</Busy>
      </form>
    </div>
  );
}
