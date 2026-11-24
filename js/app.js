"use strict";
/* RASTRO PayPal Resolver — controlador de la consola */

const KEYS = {
  prefs: "rastroPaypalPrefsV2",
  current: "rastroPaypalCurrentV2",
  sessions: "rastroPaypalSessionsV2",
  sourceTab: "rastroPaypalSourceTabV1"
};
const MAX_BATCH = 25;
const MAX_SESSIONS = 30;

let session = null;
let currentType = "username";
let running = false;

const HINTS = {
  username: "Consulta directa de paypal.me/alias sin iniciar sesión. Extrae nombre, fotografía, localidad, verificación e identificadores embebidos en la página pública.",
  email: "Sin cuenta: Gravatar por hash SHA-256 y alias derivados del correo comprobados en PayPal.Me. Con cuenta de trabajo: usa la captura asistida (panel 02).",
  phone: "PayPal no publica el titular de un teléfono sin sesión. Se normaliza a E.164, se generan pivotes y puedes capturar el resultado del buscador de destinatarios (panel 02).",
  batch: "Un identificador por línea; el tipo se detecta automáticamente. Las peticiones se espacian ~1,5 s para no saturar el servicio."
};
const PLACEHOLDERS = {username: "alias o paypal.me/alias", email: "correo@dominio.com", phone: "600 000 000 / +34600000000"};

document.addEventListener("DOMContentLoaded", init);

/* ======================= Inicialización ======================= */
async function init() {
  const stored = await chrome.storage.local.get([KEYS.prefs, KEYS.current, KEYS.sessions]);
  const prefs = stored[KEYS.prefs] || {};
  $("caseId").value = prefs.caseId || "";
  $("investigator").value = prefs.investigator || "";
  $("target").value = prefs.target || "";
  if (prefs.phoneCountry) $("phoneCountry").value = prefs.phoneCountry;
  for (const id of ["optVariants", "optGravatar", "optPhoneSlug", "optTabFallback"]) {
    if (typeof prefs[id] === "boolean") $(id).checked = prefs[id];
  }
  session = stored[KEYS.current] || newSession();
  setType(prefs.type || "username");
  bindEvents();
  renderAll();
  renderHistory(stored[KEYS.sessions] || []);
  refreshPayPalTabs();
  tickClock(); setInterval(tickClock, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshPayPalTabs(); });
}

function newSession() {
  return {id: uid(), caseId: $("caseId").value.trim(), investigator: $("investigator").value.trim(), startedAt: new Date().toISOString(), queries: [], hits: [], log: []};
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setType(b.dataset.type)));
  $("run").addEventListener("click", run);
  $("target").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); if (e.key === "Escape") closeViewer(); });
  $("target").addEventListener("input", () => { validateInput(false); savePrefs(); });
  $("batchTargets").addEventListener("input", () => validateInput(true));
  $("pasteTarget").addEventListener("click", async () => { $("target").value = (await navigator.clipboard.readText()).trim(); validateInput(false); savePrefs(); });
  ["caseId", "investigator"].forEach((id) => $(id).addEventListener("input", () => { session[id] = $(id).value.trim(); savePrefs(); persistCurrent(); }));
  ["optVariants", "optGravatar", "optPhoneSlug", "optTabFallback", "phoneCountry"].forEach((id) => $(id).addEventListener("change", savePrefs));

  $("refreshTabs").addEventListener("click", refreshPayPalTabs);
  $("sourceTabSelect").addEventListener("change", () => chrome.storage.local.set({[KEYS.sourceTab]: Number($("sourceTabSelect").value)}).then(refreshPayPalTabs));
  $("openRecipientSearch").addEventListener("click", openRecipientSearch);
  $("captureTab").addEventListener("click", captureTab);
  $("screenshotTab").addEventListener("click", takeScreenshot);
  $("copyLog").addEventListener("click", () => copyText(session.log.map((l) => `${l.at}  ${l.msg}`).join("\n"), "Registro copiado."));

  $("exportReport").addEventListener("click", exportReport);
  $("exportJson").addEventListener("click", () => exportFile("json"));
  $("exportCsv").addEventListener("click", () => exportFile("csv"));
  $("exportTxt").addEventListener("click", () => exportFile("txt"));
  $("saveSession").addEventListener("click", saveSession);
  $("clearResults").addEventListener("click", () => {
    if (!confirm("¿Vaciar los resultados de la sesión actual? (Guarda antes si quieres conservarlos)")) return;
    session = newSession(); persistCurrent(); renderAll();
  });
  $("clearHistory").addEventListener("click", async () => {
    if (!confirm("¿Borrar todas las sesiones guardadas en este navegador?")) return;
    await chrome.storage.local.remove(KEYS.sessions); renderHistory([]); toast("Historial eliminado.");
  });
  $("viewerClose").addEventListener("click", closeViewer);
  $("viewer").addEventListener("click", (e) => { if (e.target === $("viewer")) closeViewer(); });
}

function tickClock() { $("clock").textContent = new Date().toISOString().slice(11, 19); }

function setType(type) {
  currentType = type;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.type === type));
  $("singleInput").classList.toggle("hidden", type === "batch");
  $("batchInput").classList.toggle("hidden", type !== "batch");
  $("phoneCountry").classList.toggle("hidden", type !== "phone");
  document.querySelectorAll("#options .check").forEach((l) => l.classList.toggle("hidden", !l.dataset.for.split(" ").includes(type)));
  $("target").placeholder = PLACEHOLDERS[type] || "";
  $("flowHint").textContent = HINTS[type];
  validateInput(false);
  savePrefs();
}

function savePrefs() {
  chrome.storage.local.set({[KEYS.prefs]: {
    caseId: $("caseId").value.trim(), investigator: $("investigator").value.trim(), target: $("target").value.trim(), type: currentType,
    phoneCountry: $("phoneCountry").value, optVariants: $("optVariants").checked, optGravatar: $("optGravatar").checked,
    optPhoneSlug: $("optPhoneSlug").checked, optTabFallback: $("optTabFallback").checked
  }});
}

function persistCurrent() {
  const slim = {...session, hits: session.hits.map(({rawHtml, rawJson, tabId, ...h}) => h)};
  chrome.storage.local.set({[KEYS.current]: slim}).catch(() => {});
}

/* ======================= Registro de actuaciones ======================= */
function log(msg, level = "info") {
  const entry = {at: new Date().toISOString(), msg, level};
  session.log.push(entry);
  renderLogEntry(entry);
  persistCurrent();
}

function renderLogEntry(entry) {
  const li = document.createElement("li");
  li.className = entry.level;
  const t = document.createElement("time"); t.textContent = fmtTime(entry.at);
  const s = document.createElement("span"); s.textContent = entry.msg;
  li.append(t, s);
  $("log").append(li);
  $("log").scrollTop = $("log").scrollHeight;
}

/* ======================= Validación ======================= */
function validateInput(show = true) {
  const v = $("validation");
  const raw = $("target").value.trim();
  let msg = "", ok = "";
  if (currentType === "batch") {
    const n = $("batchTargets").value.split(/\r?\n/).map(clean).filter(Boolean).length;
    if (show && !n) msg = "Introduce al menos un identificador.";
    else if (n > MAX_BATCH) msg = `Máximo ${MAX_BATCH} identificadores por lote (hay ${n}).`;
    else if (show) ok = `${n} identificadores en cola.`;
  } else if (!raw) {
    if (show) msg = "Introduce un identificador.";
  } else if (currentType === "username" && !Ident.validUsername(Ident.username(raw))) {
    msg = "Alias no válido: letras, números, punto, guion o guion bajo.";
  } else if (currentType === "email" && !Ident.validEmail(Ident.email(raw))) {
    msg = "Formato de correo no válido.";
  } else if (currentType === "phone") {
    const p = Ident.phone(raw, $("phoneCountry").value);
    if (!Ident.validPhone(p)) msg = "Número no válido: entre 8 y 15 dígitos con prefijo.";
    else ok = `Normalizado: ${p.e164}`;
  }
  v.textContent = msg || ok;
  v.className = "validation " + (msg ? "error" : ok ? "ok" : "");
  return !msg;
}

/* ======================= Ejecución ======================= */
function buildJobs(type, raw, jobs, seen) {
  const addPpme = (username, query) => {
    const key = username.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    jobs.push({kind: "ppme", username, query});
  };
  if (type === "username") {
    const u = Ident.username(raw);
    if (!Ident.validUsername(u)) return log(`Alias descartado por formato: ${raw}`, "warn");
    session.queries.push({type: "username", value: u});
    addPpme(u, {type: "username", value: u});
    if ($("optVariants").checked) Ident.usernameVariants(u).forEach((v) => addPpme(v, {type: "username", value: v, derivedFrom: u}));
  } else if (type === "email") {
    const e = Ident.email(raw);
    if (!Ident.validEmail(e)) return log(`Correo descartado por formato: ${raw}`, "warn");
    session.queries.push({type: "email", value: e});
    if ($("optGravatar").checked) jobs.push({kind: "gravatar", email: e, query: {type: "email", value: e}});
    if ($("optVariants").checked) Ident.emailCandidates(e).forEach((c) => addPpme(c, {type: "username", value: c, derivedFrom: e}));
  } else if (type === "phone") {
    const p = Ident.phone(raw, $("phoneCountry").value);
    if (!Ident.validPhone(p)) return log(`Teléfono descartado por formato: ${raw}`, "warn");
    session.queries.push({type: "phone", value: p.e164});
    log(`Teléfono normalizado ${p.e164} · formatos: ${Ident.phoneFormats(p).join(" | ")}`);
    if ($("optPhoneSlug").checked) [p.national, p.e164.slice(1)].forEach((d) => addPpme(d, {type: "username", value: d, derivedFrom: p.e164}));
  }
}

async function run() {
  if (running || !validateInput(true)) return;
  running = true;
  $("run").disabled = true;
  $("progress").classList.remove("hidden");
  setProgress(0);
  session.caseId = $("caseId").value.trim();
  session.investigator = $("investigator").value.trim();

  const jobs = [];
  const seen = new Set(session.hits.filter((h) => h.source === "PayPal.Me" && h.status !== "blocked").map((h) => (h.query?.value || "").toLowerCase()));
  let pivotType = currentType, pivotValue = $("target").value.trim();
  if (currentType === "batch") {
    const lines = $("batchTargets").value.split(/\r?\n/).map(clean).filter(Boolean).slice(0, MAX_BATCH);
    log(`Lote iniciado con ${lines.length} identificadores.`);
    lines.forEach((line) => buildJobs(Ident.detect(line), line, jobs, seen));
    pivotType = null;
  } else {
    buildJobs(currentType, pivotValue, jobs, seen);
  }
  if (pivotType) renderIdentifierPivots(pivotType, pivotValue);

  const opts = {tabFallback: $("optTabFallback").checked, log};
  let done = 0;
  try {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (job.kind === "ppme") {
        log(`Consultando PayPal.Me/${job.username}${job.query.derivedFrom ? ` (derivado de ${job.query.derivedFrom})` : ""}…`);
        const hit = await resolvePayPalMe(job.username, job.query, opts);
        addHit(hit);
      } else if (job.kind === "gravatar") {
        log(`Consultando Gravatar para ${job.email}…`);
        const {hit, derived} = await resolveGravatar(job.email, job.query, opts);
        addHit(hit);
        derived.forEach((u) => {
          const key = u.toLowerCase();
          if (!seen.has(key) && Ident.validUsername(u)) {
            seen.add(key);
            jobs.push({kind: "ppme", username: u, query: {type: "username", value: u, derivedFrom: `Gravatar de ${job.email}`}});
            log(`Gravatar aporta el alias «${u}»: se añade a la cola de PayPal.Me.`, "ok");
          }
        });
      }
      done++;
      setProgress(done / jobs.length);
    }
    if (!jobs.length && currentType === "phone") {
      log("Sin consultas automáticas para teléfono. Usa los pivotes o la captura asistida.", "warn");
    }
    log(`Resolución finalizada: ${jobs.length} consultas.`, "ok");
  } catch (error) {
    log(`Error inesperado: ${error.message}`, "err");
  } finally {
    running = false;
    $("run").disabled = false;
    setTimeout(() => $("progress").classList.add("hidden"), 800);
    persistCurrent();
  }
}

function setProgress(ratio) { $("progressBar").style.width = `${Math.round(ratio * 100)}%`; }

function addHit(hit) {
  session.hits.push(hit);
  const who = hit.fields?.name || hit.fields?.username || "";
  const target = hit.query?.value || hit.url;
  log(`${hit.source} · ${target} → ${STATUS_LABEL[hit.status]}${who ? `: ${who}` : ""} (confianza ${hit.confidence})${hit.evidenceSha256 ? ` · SHA-256 ${hit.evidenceSha256.slice(0, 16)}…` : ""}`,
    hit.status === "positive" ? "ok" : hit.status === "negative" ? "info" : "warn");
  renderAll();
}

/* ======================= Renderizado ======================= */
function renderAll() {
  const counts = countStatuses(session.hits);
  $("kpiQueries").textContent = session.hits.length;
  $("kpiPositive").textContent = counts.positive;
  $("kpiReview").textContent = counts.review + counts.blocked;
  $("kpiNegative").textContent = counts.negative;
  const has = session.hits.length > 0;
  ["exportReport", "exportJson", "exportCsv", "exportTxt", "saveSession", "clearResults"].forEach((id) => { $(id).disabled = !has && id !== "clearResults"; });
  $("clearResults").disabled = !has && !session.log.length;
  $("emptyState").classList.toggle("hidden", has);
  const container = $("results");
  container.replaceChildren(...sortedHits(session.hits).map(renderCard));
  $("log").replaceChildren();
  session.log.forEach(renderLogEntry);
}

function renderCard(hit) {
  const node = $("cardTpl").content.firstElementChild.cloneNode(true);
  node.classList.add(hit.status);
  node.dataset.id = hit.id;
  node.querySelector(".card-stamp").textContent = `${STATUS_LABEL[hit.status]} · ${hit.confidence}%`;

  const nameInput = node.querySelector(".name-input");
  nameInput.value = hit.fields?.name || "";
  nameInput.addEventListener("change", () => { hit.fields.name = nameInput.value.trim(); persistCurrent(); });
  if (hit.fields?.verified === "Sí") node.querySelector(".verified").classList.remove("hidden");

  const username = hit.fields?.username || (hit.query?.type === "username" ? hit.query.value : "");
  node.querySelector(".handle").textContent = username ? `@${username}` : queryLabel(hit.query);
  node.querySelector(".method").textContent = `${hit.source} · ${hit.method}`;

  // Foto
  const photoBtn = node.querySelector(".photo-btn");
  const img = photoBtn.querySelector("img");
  const src = hit.photoData || hit.fields?.photo || "";
  if (src) {
    img.onload = () => photoBtn.classList.add("has");
    img.onerror = () => photoBtn.classList.add("err");
    img.src = src;
  }
  photoBtn.addEventListener("click", () => src && openViewer(hit));

  // Campos
  const dl = node.querySelector(".fields");
  const addRow = (label, value, href) => {
    const dt = document.createElement("dt"); dt.textContent = label;
    const dd = document.createElement("dd");
    const span = document.createElement("span");
    if (href) { const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noreferrer"; a.textContent = value; span.append(a); }
    else span.textContent = value;
    span.title = value;
    const cp = document.createElement("button"); cp.className = "cp"; cp.textContent = "⧉"; cp.title = "Copiar";
    cp.addEventListener("click", () => copyText(value));
    dd.append(span, cp);
    dl.append(dt, dd);
  };
  addRow("Consulta", queryLabel(hit.query));
  FIELD_LABELS.forEach(([k, label]) => {
    if (["name", "photo"].includes(k) || !hit.fields?.[k]) return;
    addRow(label, String(hit.fields[k]), k === "website" ? hit.fields[k] : null);
  });
  addRow("Fuente", hit.url, hit.url);
  addRow("Captura", fmtDateTime(hit.fetchedAt));
  if (hit.evidenceSha256) addRow("SHA-256 fuente", hit.evidenceSha256);
  if (hit.photoSha256) addRow("SHA-256 imagen", hit.photoSha256);
  if (hit.screenshotSha256) addRow("SHA-256 captura", hit.screenshotSha256);

  // Pivotes
  const grid = node.querySelector(".pivot-grid");
  buildPivots(hit).forEach(({label, url, action, chain}) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (chain) b.className = "chain";
    b.addEventListener("click", () => action ? action() : chrome.tabs.create({url, active: false}));
    grid.append(b);
  });
  if (!grid.children.length) node.querySelector(".pivots").classList.add("hidden");

  // Evidencia
  const {keysFound, ...ev} = hit.evidence || {};
  node.querySelector(".evidence pre").textContent = JSON.stringify({...ev, keysFound}, null, 2);

  // Notas
  const notes = node.querySelector(".notes");
  notes.value = hit.notes || "";
  notes.addEventListener("input", () => { hit.notes = notes.value; persistCurrent(); });

  // Acciones
  node.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => cardAction(b.dataset.act, hit)));
  if (hit.source !== "PayPal.Me") node.querySelector('[data-act="retryTab"]').disabled = true;
  if (!src) node.querySelectorAll('[data-act="dlPhoto"],[data-act="revImg"]').forEach((b) => (b.disabled = true));
  return node;
}

function buildPivots(hit) {
  const f = hit.fields || {};
  const g = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const out = [];
  if (f.name) {
    out.push({label: "Google · nombre", url: g(`"${f.name}"`)});
    if (f.location) out.push({label: "Google · nombre + localidad", url: g(`"${f.name}" "${f.location.split(",")[0]}"`)});
    out.push({label: "LinkedIn", url: g(`site:linkedin.com/in "${f.name}"`)});
    out.push({label: "Facebook", url: `https://www.facebook.com/search/people/?q=${encodeURIComponent(f.name)}`});
    out.push({label: "Instagram (Google)", url: g(`site:instagram.com "${f.name}"`)});
    out.push({label: "BOE / boletines", url: g(`site:boe.es OR site:borme.es "${f.name}"`)});
  }
  const u = f.username;
  if (u) {
    out.push({label: "Google · alias", url: g(`"${u}" OR "@${u}"`)});
    out.push({label: "WhatsMyName", url: `https://whatsmyname.app/?q=${encodeURIComponent(u)}`});
    out.push({label: "Instagram", url: `https://www.instagram.com/${encodeURIComponent(u)}/`});
    out.push({label: "TikTok", url: `https://www.tiktok.com/@${encodeURIComponent(u)}`});
    out.push({label: "X", url: `https://x.com/${encodeURIComponent(u)}`});
    out.push({label: "Telegram", url: `https://t.me/${encodeURIComponent(u)}`});
    out.push({label: "GitHub", url: `https://github.com/${encodeURIComponent(u)}`});
    if (hit.source !== "PayPal.Me" && Ident.validUsername(u)) {
      out.push({label: `▶ PayPal.Me/${u}`, chain: true, action: () => runSingleUsername(u, `${hit.source}`)});
    }
  }
  if (f.payerId) out.push({label: "Google · ID payer", url: g(`"${f.payerId}"`)});
  if (f.email) out.push({label: "Google · correo", url: g(`"${f.email}"`)});
  const photo = f.photo && /^https:/i.test(f.photo) ? f.photo : "";
  if (photo) {
    out.push({label: "Lens · foto", url: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(photo)}`});
    out.push({label: "Yandex · foto", url: `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(photo)}`});
    out.push({label: "Bing · foto", url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encodeURIComponent(photo)}`});
  }
  return out;
}

async function runSingleUsername(u, from) {
  if (running) return toast("Espera a que termine la resolución en curso.");
  running = true;
  try {
    log(`Pivote encadenado: PayPal.Me/${u} (desde ${from})…`);
    addHit(await resolvePayPalMe(u, {type: "username", value: u, derivedFrom: from}, {tabFallback: $("optTabFallback").checked, log}));
  } finally { running = false; }
}

async function cardAction(act, hit) {
  if (act === "open") return chrome.tabs.create({url: hit.url});
  if (act === "copy") return copyText(hitAsText(hit), "Ficha copiada.");
  if (act === "remove") {
    session.hits = session.hits.filter((h) => h.id !== hit.id);
    log(`Ficha descartada por el investigador: ${hit.query?.value || hit.url}`, "warn");
    return renderAll();
  }
  if (act === "dlPhoto") {
    const url = hit.photoData || hit.fields.photo;
    const ext = (url.match(/^data:image\/(\w+)/)?.[1] || "jpg").replace("jpeg", "jpg");
    await chrome.downloads.download({url, filename: `${caseFolder()}/foto_${safeName(hit.fields.username || hit.fields.name || "perfil")}.${ext}`, conflictAction: "uniquify"});
    return log(`Fotografía descargada (${hit.fields.username || hit.fields.name})${hit.photoSha256 ? ` · SHA-256 ${hit.photoSha256}` : ""}`, "ok");
  }
  if (act === "revImg") {
    const photo = hit.fields.photo;
    if (!/^https:/i.test(photo || "")) return toast("La imagen no tiene URL pública para búsqueda inversa; descárgala y súbela manualmente.");
    chrome.tabs.create({url: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(photo)}`, active: false});
    chrome.tabs.create({url: `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(photo)}`, active: false});
    return toast("Búsqueda inversa abierta en Google Lens y Yandex.");
  }
  if (act === "retryTab") {
    if (running) return toast("Espera a que termine la resolución en curso.");
    const u = hit.query?.type === "username" ? hit.query.value : hit.fields.username;
    if (!u) return;
    running = true;
    try {
      log(`Reintento en pestaña: PayPal.Me/${u}`);
      const fresh = await resolvePayPalMeViaTab(u, hit.query, {log});
      session.hits = session.hits.filter((h) => h.id !== hit.id);
      addHit(fresh);
    } finally { running = false; }
  }
}

function hitAsText(h) {
  return [`[${STATUS_LABEL[h.status]} · ${h.confidence}%] ${h.source}`, `Consulta: ${queryLabel(h.query)}`,
    ...FIELD_LABELS.filter(([k]) => h.fields?.[k]).map(([k, l]) => `${l}: ${h.fields[k]}`),
    `Fuente: ${h.url}`, `Fecha: ${h.fetchedAt}`, h.evidenceSha256 && `SHA-256: ${h.evidenceSha256}`].filter(Boolean).join("\n");
}

/* ---------- Pivotes del identificador consultado ---------- */
function renderIdentifierPivots(type, raw) {
  const box = $("idPivots");
  const grid = $("idPivotGrid");
  grid.replaceChildren();
  const g = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const items = [];
  let title = "";
  if (type === "username") {
    const u = Ident.username(raw); title = `@${u}`;
    items.push(["PayPal.Me", `https://www.paypal.com/paypalme/${encodeURIComponent(u)}`], ["Google", g(`"${u}" OR "@${u}"`)], ["WhatsMyName", `https://whatsmyname.app/?q=${encodeURIComponent(u)}`],
      ["Instagram", `https://www.instagram.com/${encodeURIComponent(u)}/`], ["TikTok", `https://www.tiktok.com/@${encodeURIComponent(u)}`], ["X", `https://x.com/${encodeURIComponent(u)}`], ["Telegram", `https://t.me/${encodeURIComponent(u)}`]);
  } else if (type === "email") {
    const e = Ident.email(raw); title = e;
    items.push(["Google · correo", g(`"${e}"`)], ["Google · usuario del correo", g(`"${e.split("@")[0]}"`)], ["Have I Been Pwned", "https://haveibeenpwned.com/"],
      ["Gravatar", null, async () => chrome.tabs.create({url: `https://gravatar.com/${await sha256Hex(e)}`, active: false})],
      ["Copiar y abrir PayPal", null, () => openRecipientSearch()]);
  } else if (type === "phone") {
    const p = Ident.phone(raw, $("phoneCountry").value); title = p.e164;
    const formats = Ident.phoneFormats(p);
    items.push(["Google · formatos", g(formats.slice(0, 6).map((f) => `"${f}"`).join(" OR "))], ["WhatsApp", `https://wa.me/${p.e164.slice(1)}`],
      ["Telegram", `https://t.me/${p.e164}`], ["Copiar y abrir PayPal", null, () => openRecipientSearch()],
      ...formats.map((f) => [`⧉ ${f}`, null, () => copyText(f)]));
  }
  $("idPivotTitle").textContent = title;
  items.forEach(([label, url, action]) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => action ? action() : chrome.tabs.create({url, active: false}));
    grid.append(b);
  });
  box.classList.toggle("hidden", !items.length);
}

/* ======================= Visor ======================= */
function openViewer(hit) {
  $("viewerImg").src = hit.photoData || hit.fields.photo;
  $("viewerTitle").textContent = hit.fields.name || hit.fields.username || "Fotografía";
  $("viewerHash").textContent = hit.photoSha256 ? `SHA-256 ${hit.photoSha256}` : "Sin copia local verificada";
  $("viewerOpen").onclick = () => hit.fields.photo && chrome.tabs.create({url: hit.fields.photo});
  $("viewer").classList.remove("hidden");
}
function closeViewer() { $("viewer").classList.add("hidden"); }

/* ======================= Pestañas PayPal ======================= */
function isPayPalUrl(value) {
  const host = safeHost(value).toLowerCase();
  return host === "paypal.com" || host.endsWith(".paypal.com") || host === "paypal.me" || host.endsWith(".paypal.me");
}

async function refreshPayPalTabs() {
  const tabs = (await chrome.tabs.query({})).filter((t) => t.id && isPayPalUrl(t.url || ""));
  const stored = await chrome.storage.local.get(KEYS.sourceTab);
  const sel = $("sourceTabSelect");
  sel.replaceChildren();
  if (!tabs.length) {
    sel.append(new Option("No hay pestañas de PayPal abiertas", ""));
    $("sourceBadge").textContent = "SIN PESTAÑA"; $("sourceBadge").className = "tag tag-muted";
    $("captureTab").disabled = $("screenshotTab").disabled = true;
    return;
  }
  tabs.forEach((t) => sel.append(new Option(`${(t.title || "PayPal").slice(0, 40)} — ${new URL(t.url).pathname.slice(0, 40)}`, String(t.id))));
  const chosen = tabs.find((t) => t.id === stored[KEYS.sourceTab]) || tabs[tabs.length - 1];
  sel.value = String(chosen.id);
  $("sourceBadge").textContent = `${tabs.length} PESTAÑA${tabs.length > 1 ? "S" : ""}`; $("sourceBadge").className = "tag tag-ok";
  $("captureTab").disabled = $("screenshotTab").disabled = false;
}

async function selectedTab() {
  const id = Number($("sourceTabSelect").value);
  if (!id) return null;
  try { const t = await chrome.tabs.get(id); return isPayPalUrl(t.url || "") ? t : null; } catch { return null; }
}

async function openRecipientSearch() {
  let value = $("target").value.trim();
  if (currentType === "phone") value = Ident.phone(value, $("phoneCountry").value).e164;
  if (currentType === "email") value = Ident.email(value);
  if (value) await navigator.clipboard.writeText(value);
  const tab = await chrome.tabs.create({url: "https://www.paypal.com/myaccount/transfer/homepage/pay"});
  await chrome.storage.local.set({[KEYS.sourceTab]: tab.id});
  log(`Abierto buscador de destinatarios PayPal (sesión del investigador). Identificador copiado: ${value || "—"}`);
  toast("Identificador copiado. Pégalo en PayPal, espera al destinatario y vuelve para «Analizar pestaña».");
}

async function captureTab() {
  const tab = await selectedTab();
  if (!tab) return toast("Selecciona una pestaña de PayPal válida.");
  $("captureTab").disabled = true;
  try {
    log(`Captura de pestaña: ${tab.url}`);
    addHit(await captureSelectedTab(tab, {type: "tab", value: tab.url}));
  } catch (error) {
    log(`No se pudo analizar la pestaña: ${error.message}`, "err");
  } finally { $("captureTab").disabled = false; }
}

async function takeScreenshot() {
  const tab = await selectedTab();
  if (!tab) return toast("Selecciona una pestaña de PayPal válida.");
  const consoleTab = await chrome.tabs.getCurrent();
  try {
    const shot = await screenshotTab(tab);
    if (consoleTab) { await chrome.tabs.update(consoleTab.id, {active: true}); await chrome.windows.update(consoleTab.windowId, {focused: true}); }
    const base = (u) => u.split(/[?#]/)[0].toLowerCase();
    let hit = [...session.hits].reverse().find((h) => base(h.url) === base(shot.url) || (h.evidence?.finalUrl && base(h.evidence.finalUrl) === base(shot.url)));
    if (!hit) {
      hit = await captureSelectedTab(tab, {type: "tab", value: tab.url});
      session.hits.push(hit);
    }
    hit.screenshot = shot.dataUrl;
    hit.screenshotSha256 = shot.sha256;
    log(`Captura de pantalla de ${shot.url} · SHA-256 ${shot.sha256}`, "ok");
    renderAll();
  } catch (error) {
    if (consoleTab) chrome.tabs.update(consoleTab.id, {active: true});
    log(`No se pudo capturar la pantalla: ${error.message}. Pulsa el icono de RASTRO estando en esa pestaña de PayPal y repite.`, "err");
  }
}

/* ======================= Exportación ======================= */
function safeName(v) { return String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "sin-expediente"; }
function caseFolder() { return `RASTRO-PayPal/${safeName(session.caseId || "sin-expediente")}`; }
function stamp() { return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); }

async function exportReport() {
  const html = await buildReportHtml(session);
  const file = `${caseFolder()}/Informe_${safeName(session.caseId)}_${stamp()}.html`;
  const hash = await downloadText(html, file, "text/html");
  await downloadText(`${hash}  ${file.split("/").pop()}\n`, `${file}.sha256`, "text/plain");
  const url = URL.createObjectURL(new Blob([html], {type: "text/html"}));
  chrome.tabs.create({url});
  log(`Informe policial exportado: ${file} · SHA-256 ${hash}`, "ok");
  toast("Informe generado. Se abre una vista previa para imprimir o guardar en PDF.");
}

async function exportFile(format) {
  const map = {
    json: [() => JSON.stringify(sessionForExport(session), null, 2), "application/json"],
    csv: [() => buildCsv(session), "text/csv"],
    txt: [() => buildTxt(session), "text/plain"]
  };
  const [build, mime] = map[format];
  const file = `${caseFolder()}/RASTRO_${safeName(session.caseId)}_${stamp()}.${format}`;
  const hash = await downloadText(build(), file, mime);
  log(`Exportación ${format.toUpperCase()}: ${file} · SHA-256 ${hash}`, "ok");
}

/* ======================= Historial ======================= */
async function saveSession() {
  const stored = await chrome.storage.local.get(KEYS.sessions);
  const list = (stored[KEYS.sessions] || []).filter((s) => s.id !== session.id);
  const slim = {...session, savedAt: new Date().toISOString(), hits: session.hits.map(({rawHtml, rawJson, tabId, ...h}) => h)};
  list.unshift(slim);
  await chrome.storage.local.set({[KEYS.sessions]: list.slice(0, MAX_SESSIONS)});
  renderHistory(list.slice(0, MAX_SESSIONS));
  log("Sesión guardada en el historial local.", "ok");
}

function renderHistory(list) {
  const box = $("history");
  box.replaceChildren();
  list.forEach((s) => {
    const c = countStatuses(s.hits);
    const row = document.createElement("div"); row.className = "history-row";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${s.caseId || "Sin expediente"} · ${s.queries.map((q) => q.value).slice(0, 3).join(", ")}${s.queries.length > 3 ? "…" : ""}`;
    const meta = document.createElement("small");
    meta.textContent = `${new Date(s.savedAt || s.startedAt).toLocaleString("es-ES")} · ${s.hits.length} fichas · ${c.positive} positivos · ${s.investigator || "—"}`;
    info.append(title, meta);
    const open = document.createElement("button"); open.className = "btn"; open.textContent = "Abrir";
    open.addEventListener("click", () => {
      if (session.hits.length && session.id !== s.id && !confirm("Se sustituirá la sesión actual en pantalla. ¿Continuar?")) return;
      session = structuredClone(s);
      $("caseId").value = session.caseId || ""; $("investigator").value = session.investigator || "";
      persistCurrent(); renderAll(); toast("Sesión recuperada.");
    });
    const del = document.createElement("button"); del.className = "btn btn-ghost"; del.textContent = "✕"; del.title = "Eliminar";
    del.addEventListener("click", async () => {
      const rest = list.filter((x) => x.id !== s.id);
      await chrome.storage.local.set({[KEYS.sessions]: rest}); renderHistory(rest);
    });
    row.append(info, open, del);
    box.append(row);
  });
}
