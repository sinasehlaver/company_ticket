// Headless browser pass over the built app (run through `npm run verify`, which sets APP_URL + passwords and a scratch DB).
// baskan creates a KKM day through the UI (schema paste + brush) -> seat map shape -> two sales points race for one seat
// -> sell dialog -> click timing log -> başkan cancel with bad input -> başkan releases another user's holds -> count hall +/-
// -> phone -> logs -> Rapor -> superuser Hesaplar (new user signs in, promoted to başkan) -> Settings → Yedek (download, holds block,
// import preview diff → typed İÇE AKTAR → result) -> day re-price (sold → apply) -> typed-confirm day delete. Screenshots: desktop dark + light, phone.
import { launch } from "/Users/sina/Projects/.claude/scripts/browser.mjs";
import { mkdirSync } from "node:fs";

const URL = process.env.APP_URL;
const SHOTS = "/private/tmp/claude-501/-Users-sina-Projects/company-ticket-shots";
mkdirSync(SHOTS, { recursive: true });
const PW = { baskan: process.env.BASKAN_PASSWORD, sales: process.env.TICKET_USER_PASSWORD };
if (!URL || !PW.baskan || !PW.sales) throw new Error("run through npm run verify (APP_URL + passwords)");

let failures = 0;
const dialogs = [];
const ok = (cond, msg) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const step = (s) => console.log(`\n— ${s}`);

const { browser, page: first, errors } = await launch();
await first.close();

async function context(name, { phone = false, theme = "light" } = {}) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((th) => {
    if (!localStorage.getItem("company-ticket:prefs")) localStorage.setItem("company-ticket:prefs", JSON.stringify({ theme: th }));
  }, theme);
  ctx.setDefaultTimeout(30000); // a stuck locator fails the run instead of hanging it
  const page = await ctx.newPage();
  page.on("dialog", (d) => { dialogs.push(d.type()); d.dismiss(); });
  page.on("pageerror", (e) => { errors.push(String(e)); console.log(`[${name} pageerror]`, String(e)); });
  page.on("console", (m) => m.type() === "error" && !/status of (409|400|404|401|429)/.test(m.text()) && (errors.push(m.text()), console.log(`[${name} console.error]`, m.text())));
  return { ctx, page };
}

async function login(page, username, password) {
  await page.goto(`${URL}/`);
  await page.getByLabel(/Kullanıcı adı/).fill(username);
  await page.getByLabel(/Şifre/).fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.locator(".nav").waitFor();
}

// fetch from inside the page (same session cookie + CSRF from /api/me)
const api = (page, method, path, body) => page.evaluate(async ([method, path, body]) => {
  const me = await (await fetch("/api/me")).json();
  const r = await fetch(path, { method, headers: { "content-type": "application/json", "x-csrf-token": me.csrf }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [method, path, body]);

const toastHas = async (page, re, ms = 10000) => {
  try { await page.locator(".toast", { hasText: re }).first().waitFor({ timeout: ms }); return true; } catch { return false; }
};

// ---------------------------------------------------------------- başkan: login, event, day via UI
step("başkan login + new event + new day (UI)");
const B = await context("baskan", { theme: "dark" });
await login(B.page, "baskan", PW.baskan);
ok(await B.page.locator(".nav-tabs .tab", { hasText: "Etkinlikler" }).isVisible(), "tabs visible after login");
ok(await B.page.locator(".role-chip, .user-btn").first().isVisible(), "user menu in navbar");

const halls = (await api(B.page, "GET", "/api/halls")).body.halls;
const kkm = halls.find((h) => h.kind === "seated");
const mim = halls.find((h) => h.kind === "count");
ok(kkm && mim, `seed halls: ${halls.map((h) => h.name).join(", ")}`);

await B.page.getByRole("button", { name: /Yeni etkinlik/ }).click();
await B.page.getByLabel("Etkinlik adı").fill("Verify Müzikali");
await B.page.locator(".form-card .select-btn").click();
await B.page.locator(".option", { hasText: kkm.name }).click();
await B.page.getByRole("button", { name: "Oluştur" }).click();
await B.page.waitForURL(/#\/events\/\d+$/);
ok(await toastHas(B.page, /oluşturuldu/), "event created toast");
const eventId = Number(B.page.url().match(/events\/(\d+)/)[1]);

await B.page.getByRole("link", { name: /Yeni gün/ }).click();
await B.page.locator(".price-editor").waitFor();
const hall = (await api(B.page, "GET", `/api/halls/${kkm.id}`)).body.hall;
const rows = hall.rows;
// paste a schema: back half 60, front half 90
const half = Math.floor(rows.length / 2);
const sorted = [...rows].sort();
const schema = `${sorted[0]}-${sorted[half - 1]}:90,${sorted[half]}-${sorted.at(-1)}:60`;
const schemaInput = B.page.getByLabel("Fiyat şeması");
await schemaInput.fill(schema);
await schemaInput.press("Enter");
// brush: paint the first row tile 120
await B.page.getByLabel("Fırça").fill("120");
await B.page.locator(`.pe-tile[data-row="${sorted[0]}"] .pe-letter`).click();
ok(await B.page.getByLabel(`${sorted[0].toUpperCase()} sırası fiyatı`).inputValue() === "120", "brush painted a row");
await B.page.getByRole("button", { name: "Günü oluştur" }).click();
await B.page.waitForURL(/#\/day\/\d+$/);
const dayId = Number(B.page.url().match(/day\/(\d+)/)[1]);
ok(await toastHas(B.page, /Gün oluşturuldu/), "day created toast");

step("seat map shape");
await B.page.locator(".seatmap").waitFor();
const seatRows = hall.seats.all.filter((d) => Object.keys(d)[0] !== "-").length;
const aisles = hall.seats.all.length - seatRows;
ok(await B.page.locator(".sm-row").count() === seatRows, `${seatRows} seat rows rendered`);
ok(await B.page.locator(".sm-aisle").count() === aisles, `${aisles} aisles rendered`);
const bands = await B.page.$$eval(".sm-row[data-tier]", (els) => [...new Set(els.map((e) => getComputedStyle(e).getPropertyValue("--h").trim()))]);
ok(bands.length === 3, `3 tier hues on the bands (${bands.join(", ")})`);
ok(await B.page.locator(".sm-stage", { hasText: "SAHNE" }).isVisible(), "SAHNE under the map");
// SAHNE centres on the seat columns (first..last cell); prices sit outside the band on both sides
const stageOff = await B.page.$eval(".seatmap", (m) => {
  const row = m.querySelector(".sm-row"), cells = row.querySelectorAll(".seat, .sm-gap");
  const a = cells[0].getBoundingClientRect(), b = cells[cells.length - 1].getBoundingClientRect();
  const s = m.querySelector(".sm-stage").getBoundingClientRect();
  return Math.abs((s.left + s.right) / 2 - (a.left + b.right) / 2);
});
const priceOut = await B.page.$eval(".sm-row", (r) => {
  const band = r.querySelector(".sm-band").getBoundingClientRect(), l = r.querySelector(".sm-price-l").getBoundingClientRect(), rr = r.querySelector(".sm-price-r").getBoundingClientRect();
  return l.right <= band.left + 0.5 && rr.left >= band.right - 0.5;
});
ok(priceOut, "row price sits outside the band on both sides");
ok(stageOff <= 1, `SAHNE centred on the seat columns (off by ${stageOff.toFixed(1)}px)`);
const seatCount = await B.page.locator("button.seat").count();
ok(seatCount === hall.seatCount, `${seatCount} seat buttons = hall seatCount ${hall.seatCount}`);

// ---------------------------------------------------------------- two sales points race for one seat
step("two sales points click the same seat");
const S1 = await context("mimarlik");
const S2 = await context("kutuphane");
await login(S1.page, "mimarlik", PW.sales);
await login(S2.page, "kutuphane", PW.sales);
await S1.page.goto(`${URL}/#/day/${dayId}`);
await S2.page.goto(`${URL}/#/day/${dayId}`);
await S1.page.locator(".seatmap").waitFor();
await S2.page.locator(".seatmap").waitFor();
const target = await S1.page.locator('button.seat[data-s="free"]').nth(30).getAttribute("data-seat");
await S1.page.locator(`button.seat[data-seat="${target}"]`).click();
await S1.page.locator(`button.seat[data-seat="${target}"][data-s="mine"]`).waitFor({ timeout: 10000 });
ok(true, `mimarlik holds ${target}`);
// S2 still shows it free (its poll may not have run yet): force the click on the stale view
const stale = await S2.page.locator(`button.seat[data-seat="${target}"]`).getAttribute("data-s");
await S2.page.locator(`button.seat[data-seat="${target}"]`).click();
ok(await toastHas(S2.page, new RegExp(`${target.replace("-", "\\-")}|başka|tutulmuş|alınmış`, "i")), `kutuphane gets a toast (view was ${stale})`);
await S2.page.locator(`button.seat[data-seat="${target}"][data-s="other"]`).waitFor({ timeout: 10000 });
ok(true, "kutuphane's map shows the seat as held by another");
// başkan sees the holder name after a poll
await B.page.locator(`button.seat[data-seat="${target}"][data-s="other"]`).waitFor({ timeout: 10000 });
ok((await B.page.locator(`button.seat[data-seat="${target}"]`).getAttribute("aria-label")).includes("mimarlik"), "başkan sees the holder name");

step("sell dialog");
const second = await S1.page.locator('button.seat[data-s="free"]').nth(31).getAttribute("data-seat");
await S1.page.locator(`button.seat[data-seat="${second}"]`).click();
await S1.page.locator(`button.seat[data-seat="${second}"][data-s="mine"]`).waitFor();
ok(await S1.page.locator(".hold-chip").count() === 2, "sell bar lists 2 held seats");
// a double-click on a hold chip releases the seat once (toggle isn't idempotent: a 2nd request would re-hold it)
const third = await S1.page.locator('button.seat[data-s="free"]').nth(32).getAttribute("data-seat");
await S1.page.locator(`button.seat[data-seat="${third}"]`).click();
await S1.page.locator(`button.seat[data-seat="${third}"][data-s="mine"]`).waitFor();
await S1.page.locator(".hold-chip", { has: S1.page.locator("b", { hasText: new RegExp(`^${third}$`) }) }).evaluate((el) => { el.click(); el.click(); });
await S1.page.locator(`button.seat[data-seat="${third}"][data-s="free"]`).waitFor();
await S1.page.waitForTimeout(800);
ok(await S1.page.locator(`button.seat[data-seat="${third}"]`).getAttribute("data-s") === "free" && await S1.page.locator(".hold-chip").count() === 2,
  "double-clicked hold chip releases the seat once (not re-held)");
await S1.page.getByRole("button", { name: "Satış Yap" }).click();
const dlg = S1.page.locator(".dialog-confirm");
await dlg.waitFor();
const dlgText = await dlg.innerText();
ok(dlgText.includes(target) && dlgText.includes(second) && /Toplam/.test(dlgText), "dialog lists the seats + total");
await shot(S1.page, "desktop-light-sell-dialog");
// long list: rows scroll, total + buttons stay inside the viewport
await dlg.locator(".sell-rows").evaluate((el) => { for (let i = 0; i < 40; i++) el.appendChild(el.firstElementChild.cloneNode(true)); });
{
  const vh = S1.page.viewportSize().height;
  const tb = await dlg.locator(".sell-total").boundingBox(), bb = await dlg.getByRole("button", { name: "Satış Yap" }).boundingBox();
  const sc = await dlg.locator(".sell-rows").evaluate((el) => el.scrollHeight > el.clientHeight);
  ok(sc && tb.y + tb.height <= vh && bb.y + bb.height <= vh, "sell dialog: 40 rows scroll, total + buttons stay visible");
}
await dlg.locator(".sell-rows").evaluate((el) => { while (el.children.length > 2) el.lastElementChild.remove(); });
await dlg.getByRole("button", { name: "Satış Yap" }).click();
ok(await toastHas(S1.page, /2 bilet satıldı · toplam/), "sold toast");
await S1.page.locator(`button.seat[data-seat="${target}"][data-s="sold"]`).waitFor();
ok(await S1.page.locator(".hold-chip").count() === 0, "sell bar empty after selling");

step("seat click timing (log only)");
const freeSeats = await S1.page.$$eval('button.seat[data-s="free"]', (els) => els.slice(60, 120).filter((_, i) => i % 6 === 0).map((e) => e.dataset.seat));
// measured in the page (el.click() -> MutationObserver sees data-s flip): server round trip + React commit, without
// Playwright's actionability waits. "commit" = response body read -> DOM flipped (the client-side render share).
const timed = (seat, to) => S1.page.evaluate(([seat, to]) => new Promise((done) => {
  const el = document.querySelector(`button.seat[data-seat="${seat}"]`);
  let tRes = 0;
  const origJson = Response.prototype.json;
  Response.prototype.json = function () { tRes = performance.now(); return origJson.call(this); };
  const t0 = performance.now();
  const mo = new MutationObserver(() => {
    if (el.dataset.s !== to) return;
    const t1 = performance.now();
    mo.disconnect(); Response.prototype.json = origJson;
    done({ total: Math.round(t1 - t0), commit: Math.round(t1 - (tRes || t1)) });
  });
  mo.observe(el, { attributes: true, attributeFilter: ["data-s"] });
  el.click();
}), [seat, to]);
const holdMs = [], dropMs = [];
for (const s of freeSeats.slice(0, 6)) holdMs.push(await timed(s, "mine"));
for (const s of freeSeats.slice(0, 6)) dropMs.push(await timed(s, "free"));
const med = (a, k) => a.map((x) => x[k]).sort((x, y) => x - y)[a.length >> 1];
const fmt = (a) => `median ${med(a, "total")} ms (render ${med(a, "commit")} ms) [${a.map((x) => `${x.total}/${x.commit}`).join(", ")}]`;
console.log(`  timing (total/render ms): click→held ${fmt(holdMs)} · click→free ${fmt(dropMs)} · ${seatCount} seats`);

step("başkan cancel: bad input, then a real cancel");
await B.page.locator(".cancel-card").waitFor({ timeout: 10000 });
await B.page.locator(".cancel-card textarea").fill("a32");
ok(await B.page.locator(".cancel-card .chip-bad").count() === 1, "preview flags 'a32'");
await B.page.locator(".cancel-card").getByRole("button", { name: "İptal et" }).click();
ok(await toastHas(B.page, /Anlaşılmayan/), "server error toast for 'a32'");
await B.page.locator(".cancel-card textarea").fill(second.toLowerCase());
await B.page.locator(".cancel-card").getByRole("button", { name: "İptal et" }).click();
const cdlg = B.page.locator(".dialog-confirm");
await cdlg.waitFor();
ok(await cdlg.locator(".btn-solid-danger", { hasText: "İptal et" }).isVisible(), "red 'İptal et' confirm");
await cdlg.locator(".btn-solid-danger").click();
ok(await toastHas(B.page, /1 satış iptal edildi/), "cancel toast");
ok(await B.page.locator(".stat", { hasText: "satılan" }).locator(".stat-n", { hasText: /^1$/ }).waitFor({ timeout: 10000 }).then(() => true, () => false), "sold count = 1 after cancel");

step("screenshots: desktop dark (başkan) + light (sales)");
await B.page.locator(`button.seat[data-seat="${target}"][data-s="sold"]`).waitFor();
await shot(B.page, "desktop-dark-day");
// a hold for the light shot
await S2.page.locator('button.seat[data-s="free"]').nth(5).click();
await S2.page.locator('button.seat[data-s="mine"]').first().waitFor();
await shot(S2.page, "desktop-light-day");

step("başkan releases another user's hold");
const s2Seat = await S2.page.locator('button.seat[data-s="mine"]').first().getAttribute("data-seat");
await B.page.locator(`button.seat[data-seat="${s2Seat}"][data-s="other"]`).waitFor({ timeout: 10000 });
await B.page.locator(`button.seat[data-seat="${s2Seat}"]`).click();
await B.page.locator(".pop .menu-item", { hasText: "Bırak" }).click();
ok(await toastHas(B.page, /bırakıldı/), "release toast");
await B.page.locator(`button.seat[data-seat="${s2Seat}"][data-s="free"]`).waitFor({ timeout: 10000 });
ok(true, `başkan freed ${s2Seat}`);
await S2.page.locator(`button.seat[data-seat="${s2Seat}"][data-s="free"]`).waitFor({ timeout: 10000 });
ok(true, "kutuphane's map shows it free after a poll");
for (const n of [7, 9]) {
  const s = await S2.page.locator('button.seat[data-s="free"]').nth(n).getAttribute("data-seat");
  await S2.page.locator(`button.seat[data-seat="${s}"]`).click();
  await S2.page.locator(`button.seat[data-seat="${s}"][data-s="mine"]`).waitFor();
}
const holderRow = B.page.locator('.holders li[data-holder="kutuphane"]', { hasText: "2 bilet" });
ok(await holderRow.waitFor({ timeout: 10000 }).then(() => true, () => false), "Tutulanlar lists kutuphane with 2 (after a poll)");
await holderRow.getByRole("button", { name: "Hepsini bırak" }).click();
ok(await toastHas(B.page, /kutuphane: 2 bilet bırakıldı/), "release-all toast");
await S2.page.locator('button.seat[data-s="mine"]').first().waitFor({ state: "detached", timeout: 10000 });
ok(true, "kutuphane has no holds left");

await S2.page.goto(`${URL}/#/events/${eventId}`);
await S2.page.locator(".day-card").waitFor();
await shot(S2.page, "desktop-light-event");

// ---------------------------------------------------------------- count hall
step("count hall + / −");
const ev2 = await api(B.page, "POST", "/api/events", { name: "Verify Mimarlık", hallId: mim.id });
const d2 = await api(B.page, "POST", `/api/events/${ev2.body.event.id}/days`, { date: "2026-11-02T20:00", price: 150, remember: false });
ok(d2.status === 201, "count-hall day created");
await S1.page.goto(`${URL}/#/day/${d2.body.day.id}`);
const plus = S1.page.getByRole("button", { name: "Bir bilet tut" });
await plus.waitFor();
await plus.click();
await S1.page.locator(".stepper-n", { hasText: "1" }).waitFor();
await plus.click();
await S1.page.locator(".stepper-n", { hasText: "2" }).waitFor();
await S1.page.getByRole("button", { name: "Bir bileti bırak" }).click();
await S1.page.locator(".stepper-n", { hasText: "1" }).waitFor();
ok(true, "+ + − = 1 held");
ok((await S1.page.locator(".sellbar-total b").innerText()).includes("150 ₺"), "count total 150 ₺");

step("phone");
const P = await context("phone", { phone: true });
await login(P.page, "carsi", PW.sales);
await P.page.goto(`${URL}/#/day/${dayId}`);
await P.page.locator(".seatmap").waitFor();
const scrolls = await P.page.$eval(".seatmap-box", (el) => el.scrollWidth > el.clientWidth);
ok(scrolls, "phone: map scrolls horizontally at real size");
await P.page.locator('button.seat[data-s="free"]').nth(10).tap();
await P.page.locator('button.seat[data-s="mine"]').first().waitFor();
await shot(P.page, "phone-light-day");
await P.page.getByRole("button", { name: "Sığdır" }).tap();
await P.page.waitForTimeout(300);
const fits = await P.page.$eval(".seatmap-box", (el) => el.querySelector(".seatmap").getBoundingClientRect().width <= el.clientWidth + 1 && el.scrollWidth <= el.clientWidth + 1);
ok(fits, "phone: Sığdır fits the map");
await shot(P.page, "phone-light-day-fit");

step("logs");
await B.page.goto(`${URL}/#/logs/${dayId}`);
await B.page.locator(".log-table").waitFor();
ok(await B.page.locator(".log-table tbody tr").count() === 3, "3 log rows (2 sales + 1 cancel)");
await B.page.getByLabel(/Koltuk ara/).fill("zz-1");
await B.page.getByRole("button", { name: "Ara" }).click();
ok(await B.page.locator(".form-error", { hasText: /Anlaşılmayan/ }).waitFor({ timeout: 10000 }).then(() => true, () => false), "bad seat search shows inline error");
ok(await B.page.locator(".log-table tbody tr").count() === 3, "list stays under the error");
await shot(B.page, "desktop-dark-logs");

step("Rapor shows the sale");
await B.page.goto(`${URL}/#/report`);
const repCard = B.page.locator(".report-card", { hasText: "Verify Müzikali" });
await repCard.waitFor();
const repText = await repCard.innerText();
ok(repText.includes("mimarlik") && /1 \/ \d+ satıldı/.test(repText), "report card: mimarlik sold 1");
ok(await B.page.locator('a[href^="/api/report.csv"]').count() === 1, "CSV link present");
const csv = await B.page.evaluate(async () => { const r = await fetch("/api/report.csv"); return { type: r.headers.get("content-type"), cd: r.headers.get("content-disposition"), first: (await r.arrayBuffer()).byteLength }; });
ok(/text\/csv/.test(csv.type) && /attachment/.test(csv.cd), `CSV download headers (${csv.cd})`);
await shot(B.page, "desktop-dark-report");

step("superuser: Hesaplar → new user signs in");
const A = await context("admin");
await login(A.page, "sina", process.env.ADMIN_PASSWORD);
ok(await A.page.locator(".nav-tabs .tab", { hasText: "Hesaplar" }).isVisible(), "Hesaplar tab for superuser");
ok(!(await S1.page.locator(".nav-tabs .tab", { hasText: "Hesaplar" }).count()), "no Hesaplar tab for sales");
await A.page.goto(`${URL}/#/accounts`);
await A.page.locator(".accounts-table").waitFor();
await A.page.locator(".new-user").getByLabel("Kullanıcı adı").fill("verify-kasa");
await A.page.locator(".new-user").getByRole("button", { name: "Hesap aç" }).click();
const pw = await A.page.locator(".pw-dialog .pw-value").innerText();
ok(pw.length >= 8, "generated password shown once");
ok(await toastHas(A.page, /verify-kasa hesabı açıldı/), "create toast"); // checked while the dialog is open: it can expire before "Tamam" on a slow run
await A.page.getByRole("button", { name: "Tamam" }).click();
ok(await A.page.locator('.accounts-table tr[data-user="verify-kasa"]').isVisible(), "new row in the table");
ok(await A.page.locator('.accounts-table tr[data-user="sina"] [role="switch"]').count() === 0, "no switch on your own row");
await shot(A.page, "desktop-light-accounts");
const N = await context("newuser");
await login(N.page, "verify-kasa", pw);
ok(await N.page.locator(".nav").isVisible(), "verify-kasa signs in with the generated password");
ok(!(await N.page.locator(".nav-tabs .tab", { hasText: "Rapor" }).count()), "verify-kasa (sales) has no Rapor tab");

step("superuser promotes verify-kasa to başkan (role select → in-app confirm)");
ok(await A.page.locator('.accounts-table [data-role-select="sina"]').count() === 0, "no role select on your own row");
await A.page.getByRole("button", { name: "verify-kasa rolü" }).click();
await A.page.getByRole("option", { name: "Başkan" }).click();
const roleDlg = A.page.locator(".dialog", { hasText: "verify-kasa rolü: Satış noktası → Başkan" });
await roleDlg.waitFor();
await roleDlg.getByRole("button", { name: "Rolü değiştir" }).click();
ok(await toastHas(A.page, /verify-kasa artık Başkan/), "role change toast");
ok((await A.page.getByRole("button", { name: "verify-kasa rolü" }).innerText()).includes("Başkan"), "row shows Başkan");
await N.page.reload();
ok(await N.page.locator(".nav-tabs .tab", { hasText: "Rapor" }).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "promoted user now sees Rapor");

step("backup: sales has no Yedek section (export is başkan+)");
await S1.page.goto(`${URL}/#/events/${eventId}`);
await S1.page.locator(`.nav button[aria-label="Ayarlar"]`).first().click();
await S1.page.locator(".drawer-head").waitFor();
ok(await S1.page.locator('[data-testid="backup"]').count() === 0, "sales sees no backup section");
// page.request shares the cookies but not the console (an in-page 403 fetch would trip "no page errors")
ok((await S1.page.request.get(`${URL}/api/backup/export`)).status() === 403, "sales export → 403");
await S1.page.keyboard.press("Escape");

step("backup: başkan downloads → renames the event → imports the earlier file (diff → typed İÇE AKTAR → result)");
const { stat, mkdtemp } = await import("node:fs/promises");
const { tmpdir } = await import("node:os");
const dlDir = await mkdtemp(`${tmpdir()}/ct-verify-dl-`);
await B.page.goto(`${URL}/#/events/${eventId}`);
await B.page.locator(`.nav button[aria-label="Ayarlar"]`).first().click();
const bk = B.page.locator('[data-testid="backup"]');
await bk.waitFor();
const [dl] = await Promise.all([B.page.waitForEvent("download"), bk.getByRole("button", { name: "Yedeği indir" }).click()]);
const dlPath = `${dlDir}/${dl.suggestedFilename()}`;
await dl.saveAs(dlPath);
const dlSize = (await stat(dlPath)).size;
ok(/^company-ticket-\d{8}-\d{4}\.db$/.test(dl.suggestedFilename()) && dlSize > 0, `backup downloaded (${dl.suggestedFilename()}, ${dlSize} bytes)`);
ok(await toastHas(B.page, /Yedek indirildi/), "download toast");
await shot(B.page, "desktop-dark-settings-backup");
const renamed = (await api(B.page, "PUT", `/api/events/${eventId}`, { name: "Verify Müzikali (yeni ad)" })).status === 200;
ok(renamed, "event renamed after the backup");
await bk.locator('[data-testid="backup-file"]').setInputFiles(dlPath);
ok(await toastHas(B.page, /ayrılmış koltuk var/), "open holds (mimarlik count hall, carsi phone) block the import preview");
await api(S1.page, "POST", `/api/days/${d2.body.day.id}/count/release`, {});
await P.page.locator('button.seat[data-s="mine"]').first().tap();
await P.page.locator('button.seat[data-s="mine"]').first().waitFor({ state: "detached", timeout: 10000 });
await bk.locator('[data-testid="backup-file"]').setInputFiles(dlPath);
const idlg = B.page.locator(".typed-dialog", { has: B.page.locator(".diff-table") });
await idlg.waitFor();
const evRow = await idlg.locator('tr[data-entity="events"]').innerText();
const evCell = (c) => idlg.locator(`tr[data-entity="events"] td[data-col="${c}"]`).innerText();
ok(await evCell("updated") === "0" && Number(await evCell("kept")) >= 1, `preview: the live rename is newer, so no event is updated (${evRow.replace(/\s+/g, " ")})`);
const commitBtn = idlg.locator('[data-act="import-commit"]');
await idlg.locator('[data-testid="typed"]').fill("yanlış");
ok(await commitBtn.isDisabled(), "İçe aktar disabled until İÇE AKTAR is typed");
await idlg.locator('[data-testid="typed"]').fill("İÇE AKTAR");
await commitBtn.click(); // the pre-import download is within 30 s of the first one → 429 → snapshot fallback toast
await B.page.locator(".typed-dialog", { hasText: "İçe aktarma sonucu" }).waitFor();
ok(await toastHas(B.page, /İçe aktarıldı/), "import result toast");
await B.page.locator('[data-act="import-done"]').click();
ok(await bk.locator(".snap-row").first().waitFor({ timeout: 10000 }).then(() => true, () => false), "snapshot listed after the import");
ok((await api(B.page, "GET", `/api/events/${eventId}`)).body.event.name === "Verify Müzikali (yeni ad)", "newer live name kept");
await B.page.keyboard.press("Escape");
await bk.waitFor({ state: "detached" });

step("day re-price click-through: sold seat → dialog → apply new price to sold");
await B.page.goto(`${URL}/#/day/${dayId}`);
const admin = B.page.locator(".day-admin");
await admin.waitFor();
ok((await admin.getByRole("button", { name: "Günü düzenle" }).getAttribute("aria-expanded")) === "false", "day-edit panel collapsed by default");
await admin.getByRole("button", { name: "Günü düzenle" }).click();
const tRow = rows.find((r) => r.toLowerCase() === target.match(/^[a-zA-Z]+/)[0].toLowerCase());
await admin.locator(`.pe-tile[data-row="${tRow}"] .pe-input`).fill("77");
await admin.getByRole("button", { name: "Fiyatları kaydet" }).click();
const rdlg = B.page.locator(".reprice-dialog");
await rdlg.waitFor();
await rdlg.locator('[data-group="sold"] [data-v="apply"]').click();
await rdlg.getByRole("button", { name: "Fiyatları kaydet" }).click();
ok(await toastHas(B.page, /biletin fiyatı güncellendi/), "re-price toast");
const soldNow = (await api(B.page, "GET", `/api/days/${dayId}`)).body;
ok(JSON.stringify(soldNow).includes("77"), "sold ticket carries the new price");

step("superuser deletes a day with the typed confirm (sold → explicit tick)");
const { istanbulLabel } = await import("./server/admin.js");
const dayDate = (await api(A.page, "GET", `/api/days/${dayId}`)).body.day.date;
await A.page.goto(`${URL}/#/day/${dayId}`);
await A.page.locator(".day-admin").getByRole("button", { name: "Günü düzenle" }).click();
await A.page.locator(".day-admin").getByRole("button", { name: "Sil" }).click();
const tdlg = A.page.locator(".typed-dialog");
await tdlg.waitFor();
const delBtn = tdlg.locator("button.btn-solid-danger");
await tdlg.locator("input").fill("yanlış");
ok(await delBtn.isDisabled(), "Sil disabled until the label matches");
await tdlg.locator("input").fill(istanbulLabel(dayDate));
await delBtn.click();
await tdlg.locator(".typed-warn").waitFor();
ok(await delBtn.isDisabled(), "1 sold ticket → Sil disabled until the tick");
await tdlg.locator('.typed-warn [role="checkbox"]').click();
await delBtn.click();
await A.page.waitForURL(new RegExp(`#/events/${eventId}$`));
ok(await toastHas(A.page, /silindi/), "deleted toast");
ok((await api(A.page, "GET", `/api/days/${dayId}`)).status === 404, "day is gone (404)");

step("primitives");
ok(dialogs.length === 0, "no native dialogs");
ok(errors.length === 0, `no page errors (${errors.length})`);

await browser.close();
console.log(`\n${failures ? `✗ ${failures} check(s) failed` : "✓ all checks passed"} · screenshots: ${SHOTS}`);
process.exit(failures ? 1 : 0);

async function shot(page, name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}
