import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "look/kit/i18n.js";
import { usePrefs } from "look/kit/prefs.js";
import { toast } from "look/kit/Toasts.jsx";
import { Help } from "look/kit/Controls.jsx";
import { get, post, upload, download } from "../api.js";
import { dayShort, stamp } from "../format.js";
import { Busy } from "../ui/Busy.jsx";
import { useLoad } from "../ui/useLoad.js";

// Settings → "Yedek", başkan+ only (the file holds every password hash; sales don't see the section). Download the
// whole DB (.db, server rate-limits 1 per 30 s), merge-import a
// backup (preview diff → typed "İÇE AKTAR" → the current state is downloaded first → commit → result) and the
// snapshot list (taken automatically before each import/restore). Restore is superuser only (typed "GERİ YÜKLE").
const IMPORT_WORD = "İÇE AKTAR";
const RESTORE_WORD = "GERİ YÜKLE";
const ENTITIES = ["halls", "events", "days", "users", "tickets", "logs"];
const camel = (s) => s.replace(/-(\w)/g, (_, c) => c.toUpperCase());
const kb = (n) => `${Math.max(1, Math.round(n / 1024)).toLocaleString("tr")} KB`;

export function BackupSection({ me }) {
  const t = useT();
  const elevated = me.role === "baskan" || me.role === "superuser";
  const file = useRef(null);
  const [preview, setPreview] = useState(null);
  const [restoring, setRestoring] = useState(null);
  const snaps = useLoad(() => (elevated ? get("/api/backup/snapshots") : Promise.resolve(null)), [elevated]);

  const exportNow = async () => {
    try { const r = await download("/api/backup/export"); toast(t("backupDownloaded", { name: r.name })); }
    catch (e) { toast(e.message); return false; }
  };
  const pick = async (f) => {
    if (!f) return;
    try { setPreview({ ...(await upload("/api/backup/import/preview", f)), fileName: f.name }); }
    catch (e) { toast(e.body?.holds ? `${e.message} ${t("holdsList", { n: e.body.holds.reduce((a, h) => a + h.count, 0) })}` : e.message); }
    finally { if (file.current) file.current.value = ""; }
  };
  const snapDownload = async (id) => {
    try { await download(`/api/backup/snapshots/${id}/download`); } catch (e) { toast(e.message); return false; }
  };

  return (
    <section className="drawer-section backup" data-testid="backup">
      <h2>{t("backup")} <Help text={t("backupHelp")} /></h2>
      <div className="backup-btns">
        <Busy className="btn" onClick={exportNow} data-act="backup-export">{t("backupDownload")}</Busy>
        {elevated && <>
          <button type="button" className="btn" data-act="backup-import" onClick={() => file.current?.click()}>{t("backupImport")}</button>
          <input ref={file} type="file" accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3" hidden data-testid="backup-file"
            onChange={(e) => pick(e.target.files?.[0])} />
        </>}
      </div>
      {elevated && (
        <div className="snap-list">
          <h3>{t("snapshots")} <Help text={t("snapshotsHelp")} /></h3>
          {snaps.error ? <p className="form-error">{snaps.error.message}</p>
            : !snaps.data ? <p className="muted">…</p>
            : !snaps.data.snapshots.length ? <p className="muted">{t("noSnapshots")}</p>
            : <ul className="snap-rows">{snaps.data.snapshots.map((s) => (
              <li key={s.id} className="snap-row" data-id={s.id}>
                <span className="snap-meta"><strong>#{s.id} · <Stamp iso={s.createdAt} /></strong>
                  <span className="muted small">{t(`reason_${s.reason || "import"}`)} · {s.createdBy} · {kb(s.size)}</span></span>
                <Busy className="btn btn-ghost btn-sm" onClick={() => snapDownload(s.id)}>{t("download")}</Busy>
                {me.role === "superuser" && <button type="button" className="btn btn-danger btn-sm" onClick={() => setRestoring(s)}>{t("restore")}</button>}
              </li>))}</ul>}
        </div>
      )}
      {preview && <ImportDialog p={preview} onClose={() => setPreview(null)} onDone={() => snaps.reload()} />}
      {restoring && <RestoreDialog s={restoring} onClose={() => setRestoring(null)} onDone={() => snaps.reload()} />}
    </section>
  );
}

function Stamp({ iso }) { const { lang } = usePrefs(); return stamp(iso, lang); }

function Report({ report, counts }) {
  const t = useT();
  const cols = ["added", "updated", "deleted", "kept"];
  return (
    <div className="table-wrap diff-wrap">
      <table className="log-table diff-table">
        <thead><tr><th>{t("entity")}</th>{counts && <th className="num">{t("inFile")}</th>}{counts && <th className="num">{t("inLive")}</th>}
          {cols.map((c) => <th key={c} className="num">{t(`col_${c}`)}</th>)}<th>{t("col_skipped")}</th></tr></thead>
        <tbody>{ENTITIES.map((e) => {
          const r = report[e];
          const sk = Object.entries(r.skipped || {});
          return (
            <tr key={e} data-entity={e}>
              <td>{t(`ent_${e}`)}</td>
              {counts && <td className="num">{counts.file[e] ?? "—"}</td>}{counts && <td className="num">{counts.live[e] ?? "—"}</td>}
              {cols.map((c) => <td key={c} className={`num${r[c] && c !== "kept" ? " diff-hit" : ""}`} data-col={c}>{r[c]}</td>)}
              <td className="wrap">{sk.length ? sk.map(([k, n]) => <span key={k} className="chip">{t(`skip_${camel(k)}`)} {n}</span>) : "—"}</td>
            </tr>);
        })}</tbody>
      </table>
    </div>
  );
}

function Warnings({ warnings }) {
  const t = useT();
  const { lang } = usePrefs();
  if (!warnings?.length) return null;
  return (
    <ul className="typed-warn backup-warn" role="alert">{warnings.map((w) => (
      <li key={w.code} data-warn={w.code}>{t(`warn_${w.code}`, { n: w.count })}
        {w.days?.length > 0 && <ul className="warn-days">{w.days.map((d) => (
          <li key={d.dayUid} data-day={d.dayUid}><span className="muted">{d.event ? `${d.event} · ` : ""}{d.date ? dayShort(d.date, lang) : "—"}</span>
            {" · "}{d.seats ? d.seats.join(", ") : t("ticketCount", { n: d.count })}</li>))}</ul>}
      </li>))}</ul>
  );
}

/** Centred modal portaled to <body> (the drawer clips); Esc / outside click close unless busy. */
function Modal({ busy, onClose, label, children, onSubmit, wide }) {
  const back = useRef(document.activeElement);
  useEffect(() => { const b = back.current; return () => b?.focus?.(); }, []);
  return createPortal(
    <div className="overlay overlay-center" onMouseDown={(e) => { e.stopPropagation(); if (!busy) onClose(); }}>
      <form className={`dialog dialog-confirm typed-dialog${wide ? " dialog-wide" : ""}`} role="alertdialog" aria-modal="true" aria-label={label}
        onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); if (!busy) onClose(); } }}>
        {children}
      </form>
    </div>, document.body);
}

function TypedField({ word, value, onChange }) {
  const t = useT();
  const input = useRef(null);
  useEffect(() => { setTimeout(() => input.current?.focus(), 0); }, []);
  return (
    <label className="field-v">
      <span>{t("typeToConfirm")} <b className="mono typed-name">{word}</b></span>
      <input ref={input} className="input" value={value} autoComplete="off" spellCheck={false} data-testid="typed"
        aria-invalid={(value && value.trim() !== word) || undefined} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ImportDialog({ p, onClose, onDone }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const ready = typed.trim().normalize("NFC") === IMPORT_WORD && !busy;
  const run = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    let fallback = false; // the pre-import download hit the 30 s limit: offer the automatic snapshot instead
    try { await download("/api/backup/export"); }
    catch (e) {
      if (e.status !== 429) { setBusy(false); setError(`${t("preBackupFailed")} ${e.message}`); return; }
      fallback = true;
    }
    try {
      const r = await post("/api/backup/import/commit", { token: p.token, confirm: typed.trim() });
      setResult({ ...r, fallback });
      onDone();
      const snap = () => download(`/api/backup/snapshots/${r.snapshotId}/download`).catch((e) => toast(e.message));
      if (fallback) toast(t("importDoneSnap", { id: r.snapshotId }), { action: { label: t("download"), run: snap }, ms: 12000 });
      else toast(t("importDone"));
    } catch (e) {
      setError(e.body?.holds ? `${e.message} ${t("holdsList", { n: e.body.holds.reduce((a, h) => a + h.count, 0) })}` : e.message);
      toast(e.message);
    } finally { setBusy(false); }
  };
  if (result) return (
    <Modal onClose={onClose} label={t("importResult")} onSubmit={onClose} wide>
      <h2>{t("importResult")}</h2>
      <p className="muted">{t("importResultText", { id: result.snapshotId })}</p>
      <Report report={result.report} />
      <Warnings warnings={result.warnings} />
      <div className="dialog-btns">
        {result.fallback && <Busy className="btn" onClick={() => download(`/api/backup/snapshots/${result.snapshotId}/download`).catch((e) => { toast(e.message); return false; })}>
          {t("downloadSnapshot", { id: result.snapshotId })}</Busy>}
        <button type="submit" className="btn btn-primary" data-act="import-done">{t("done")}</button>
      </div>
    </Modal>
  );
  return (
    <Modal busy={busy} onClose={onClose} label={t("backupImport")} onSubmit={run} wide>
      <h2>{t("backupImport")}</h2>
      <p className="muted">{t("importIntro", { name: p.fileName })}</p>
      <Report report={p.report} counts={p.counts} />
      <Warnings warnings={p.warnings} />
      <p className="muted small">{t("importPreBackup")}</p>
      <TypedField word={IMPORT_WORD} value={typed} onChange={(v) => { setTyped(v); setError(null); }} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-btns">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t("cancel")}</button>
        <button type="submit" className="btn btn-solid-danger busy-btn" data-act="import-commit" data-s={busy ? "busy" : "idle"} disabled={!ready} aria-busy={busy}>
          <span className="spin" aria-hidden /><span>{t("importOk")}</span></button>
      </div>
    </Modal>
  );
}

function RestoreDialog({ s, onClose, onDone }) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ready = typed.trim().normalize("NFC") === RESTORE_WORD && !busy;
  const run = async () => {
    if (!ready) return;
    setBusy(true); setError(null);
    try {
      const r = await post(`/api/backup/snapshots/${s.id}/restore`, { confirm: typed.trim() });
      toast(t("restored", { id: s.id, pre: r.snapshotId }));
      onDone(); onClose();
    } catch (e) { setBusy(false); setError(e.message); toast(e.message); }
  };
  return (
    <Modal busy={busy} onClose={onClose} label={t("restore")} onSubmit={run}>
      <h2>{t("restoreTitle", { id: s.id })}</h2>
      <p className="muted">{t("restoreText")}</p>
      <TypedField word={RESTORE_WORD} value={typed} onChange={(v) => { setTyped(v); setError(null); }} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-btns">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>{t("cancel")}</button>
        <button type="submit" className="btn btn-solid-danger busy-btn" data-s={busy ? "busy" : "idle"} disabled={!ready} aria-busy={busy}>
          <span className="spin" aria-hidden /><span>{t("restore")}</span></button>
      </div>
    </Modal>
  );
}
