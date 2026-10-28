import { useT } from "./i18n.js";

// The three non-happy states every list / async view ships with.
export function Empty({ title, hint }) {
  const t = useT();
  return <div className="state"><strong>{title ?? t("empty")}</strong><span>{hint ?? t("emptyHint")}</span></div>;
}
export function Loading() {
  const t = useT();
  return <div className="state" aria-busy="true"><div className="skeleton" /><div className="skeleton short" /><span className="sr">{t("loading")}</span></div>;
}
export function ErrorState({ message, onRetry }) {
  const t = useT();
  return (
    <div className="state state-error" role="alert">
      <strong>{t("error")}</strong>{message && <span>{message}</span>}
      {onRetry && <button className="btn" onClick={onRetry}>{t("retry")}</button>}
    </div>
  );
}
