"use strict";
/* RASTRO PayPal Resolver — informes y exportaciones */

const STATUS_LABEL = {
  positive: "POSITIVO",
  review: "REVISIÓN",
  negative: "NEGATIVO",
  blocked: "BLOQUEADO"
};

const FIELD_LABELS = [
  ["name", "Nombre visible"], ["givenName", "Nombre de pila"], ["familyName", "Apellidos"],
  ["altName", "Nombre alternativo"], ["businessName", "Razón social"], ["username", "Username / alias"],
  ["location", "Localidad"], ["country", "País"], ["verified", "Verificado"], ["accountType", "Tipo de cuenta"],
  ["payerId", "ID interno (payer)"], ["merchantId", "ID comerciante"], ["currency", "Divisa"],
  ["email", "Correo visible"], ["phone", "Teléfono visible"], ["website", "Web"], ["bio", "Descripción"],
  ["linkedAccounts", "Cuentas vinculadas"], ["pronouns", "Pronombres"], ["active", "Perfil activo"],
  ["createdAt", "Alta"], ["photo", "URL fotografía"]
];

const STATUS_ORDER = {positive: 0, review: 1, blocked: 2, negative: 3};

function sortedHits(hits) {
  return [...hits].sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (b.confidence - a.confidence));
}

function queryLabel(q) {
  if (!q) return "—";
  const t = {username: "Username", email: "Email", phone: "Teléfono", tab: "Pestaña"}[q.type] || q.type;
  return `${t}: ${q.value}${q.derivedFrom ? ` (derivado de ${q.derivedFrom})` : ""}`;
}

async function assetDataUrl(path) {
  try { return await blobToDataUrl(await (await fetch(chrome.runtime.getURL(path))).blob()); } catch { return ""; }
}

async function buildReportHtml(session) {
  const emblem = await assetDataUrl("assets/emblem.png");
  const hits = sortedHits(session.hits);
  const counts = countStatuses(hits);
  const generated = new Date().toISOString();

  const card = (h, i) => {
    const rows = FIELD_LABELS.filter(([k]) => h.fields?.[k] && !(k === "photo" && String(h.fields[k]).startsWith("data:"))).map(([k, label]) =>
      `<tr><th>${escapeHtml(label)}</th><td>${k === "photo" || k === "website" ? `<a href="${escapeHtml(h.fields[k])}">${escapeHtml(h.fields[k])}</a>` : escapeHtml(h.fields[k])}</td></tr>`).join("");
    const photo = h.photoData || h.fields?.photo;
    return `<section class="ficha ${h.status}">
      <header><span class="num">FICHA ${String(i + 1).padStart(2, "0")}</span><span class="src">${escapeHtml(h.source)} · ${escapeHtml(h.method)}</span><span class="stamp">${STATUS_LABEL[h.status]}</span></header>
      <div class="body">
        <figure>${photo ? `<img src="${escapeHtml(photo)}" alt="Fotografía">` : `<div class="nophoto">SIN FOTOGRAFÍA</div>`}
          ${h.photoSha256 ? `<figcaption>SHA-256 imagen<br><code>${h.photoSha256}</code></figcaption>` : ""}</figure>
        <div>
          <h3>${escapeHtml(h.fields?.name || h.fields?.username || "Sin nombre visible")}</h3>
          <table>
            <tr><th>Consulta</th><td>${escapeHtml(queryLabel(h.query))}</td></tr>
            <tr><th>Confianza</th><td><div class="bar"><i style="width:${h.confidence}%"></i></div> ${h.confidence}/100</td></tr>
            ${rows}
            <tr><th>Fuente</th><td><a href="${escapeHtml(h.url)}">${escapeHtml(h.url)}</a></td></tr>
            <tr><th>Fecha captura</th><td>${escapeHtml(fmtDateTime(h.fetchedAt))}</td></tr>
            ${h.evidenceSha256 ? `<tr><th>SHA-256 fuente</th><td><code>${h.evidenceSha256}</code></td></tr>` : ""}
            ${h.notes ? `<tr><th>Notas</th><td>${escapeHtml(h.notes)}</td></tr>` : ""}
          </table>
        </div>
      </div>
      ${h.screenshot ? `<figure class="shot"><img src="${h.screenshot}" alt="Captura de pantalla"><figcaption>Captura de pantalla de la fuente · SHA-256 <code>${h.screenshotSha256}</code></figcaption></figure>` : ""}
    </section>`;
  };

  const detailed = hits.filter((h) => h.status !== "negative");
  const negatives = hits.filter((h) => h.status === "negative");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe RASTRO PayPal ${escapeHtml(session.caseId || "")}</title>
<style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}body{margin:0;font:12px/1.45 "Segoe UI",Arial,sans-serif;color:#0d1b3d;background:#e8edf7}
.page{max-width:900px;margin:0 auto;background:#fff;box-shadow:0 0 30px #0002}
.band{display:flex;align-items:center;gap:16px;padding:18px 26px;background:#020a33;color:#fff;border-bottom:4px solid #14e9f5}
.band img{width:64px;height:64px;border-radius:6px}.band h1{margin:0;font-size:20px;letter-spacing:3px}.band p{margin:2px 0 0;color:#14e9f5;font-weight:700;letter-spacing:2px;font-size:11px}
.band .cls{margin-left:auto;padding:6px 10px;border:2px solid #ff5468;color:#ff8a98;font:800 11px Consolas,monospace;letter-spacing:2px}
.content{padding:22px 26px}
h2{margin:22px 0 8px;padding-bottom:4px;border-bottom:2px solid #0d3cb5;color:#0d3cb5;font-size:13px;letter-spacing:1.5px;text-transform:uppercase}
table{width:100%;border-collapse:collapse}th,td{padding:5px 8px;border:1px solid #c9d3e6;text-align:left;vertical-align:top;word-break:break-word}th{width:170px;background:#eef2fa;color:#3a4b70;font-size:11px}
code{font:10.5px Consolas,monospace;word-break:break-all}
.kpis{display:flex;gap:10px}.kpis div{flex:1;padding:8px 10px;border:1px solid #c9d3e6;border-top:3px solid #2f7cf6}.kpis b{display:block;font-size:20px}
.kpis .p{border-top-color:#18a862}.kpis .r{border-top-color:#d9951c}.kpis .n{border-top-color:#d93c50}
.ficha{margin:14px 0;border:1px solid #b9c6e0;border-left:5px solid #8090b0;page-break-inside:avoid}
.ficha.positive{border-left-color:#18a862}.ficha.review{border-left-color:#d9951c}.ficha.blocked{border-left-color:#8a5ad6}
.ficha header{display:flex;align-items:center;gap:10px;padding:6px 10px;background:#eef2fa;border-bottom:1px solid #c9d3e6}
.ficha .num{font:800 11px Consolas,monospace;color:#0d3cb5}.ficha .src{color:#58698f;font-size:11px}
.ficha .stamp{margin-left:auto;padding:2px 8px;border:2px solid currentColor;font:900 11px Consolas,monospace;letter-spacing:2px;transform:rotate(-3deg)}
.ficha.positive .stamp{color:#18a862}.ficha.review .stamp{color:#d9951c}.ficha.blocked .stamp{color:#8a5ad6}
.ficha .body{display:grid;grid-template-columns:170px 1fr;gap:14px;padding:12px}
.ficha h3{margin:0 0 8px;font-size:17px}
figure{margin:0}figure img{display:block;width:170px;height:170px;object-fit:cover;border:1px solid #b9c6e0;background:#f2f4f9}
figcaption{margin-top:4px;color:#58698f;font-size:9.5px}.nophoto{display:grid;place-items:center;width:170px;height:170px;border:1px dashed #b9c6e0;color:#9aa6c0;font:800 11px Consolas,monospace}
.shot{padding:0 12px 12px}.shot img{width:100%;height:auto;max-height:520px;object-fit:contain}
.bar{display:inline-block;width:120px;height:8px;background:#e2e8f4;vertical-align:middle}.bar i{display:block;height:100%;background:linear-gradient(90deg,#2f7cf6,#14e9f5)}
.log{font:10.5px Consolas,monospace}.log td:first-child{width:90px;white-space:nowrap}
.warn{margin-top:18px;padding:10px 12px;border-left:4px solid #d9951c;background:#fff6e5}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:30px}.sign div{height:80px;border:1px solid #c9d3e6;padding:6px 8px;color:#58698f;font-size:10.5px}
footer{padding:10px 26px 18px;color:#7a88a8;font-size:10px;border-top:1px solid #dfe5f1}
@media print{body{background:#fff}.page{box-shadow:none}a{color:inherit;text-decoration:none}}
</style></head><body><div class="page">
<div class="band">${emblem ? `<img src="${emblem}" alt="">` : ""}<div><h1>RASTRO · PAYPAL RESOLVER</h1><p>INFORME DE INVESTIGACIÓN EN FUENTES ABIERTAS</p></div><span class="cls">USO RESTRINGIDO</span></div>
<div class="content">
<h2>1. Datos de la diligencia</h2>
<table>
<tr><th>Expediente / Diligencias</th><td>${escapeHtml(session.caseId || "—")}</td></tr>
<tr><th>Investigador / TIP</th><td>${escapeHtml(session.investigator || "—")}</td></tr>
<tr><th>Inicio de la sesión</th><td>${escapeHtml(fmtDateTime(session.startedAt))}</td></tr>
<tr><th>Generación del informe</th><td>${escapeHtml(fmtDateTime(generated))}</td></tr>
<tr><th>Herramienta</th><td>RASTRO PayPal Resolver v${chrome.runtime.getManifest().version} · navegador ${escapeHtml(navigator.userAgent.match(/(Chrome|Edg|OPR|Brave)\/[\d.]+/g)?.join(" ") || "")}</td></tr>
<tr><th>Identificadores consultados</th><td>${session.queries.map((q) => escapeHtml(queryLabel(q))).join("<br>") || "—"}</td></tr>
</table>
<h2>2. Resumen</h2>
<div class="kpis"><div><span>Fichas</span><b>${hits.length}</b></div><div class="p"><span>Positivos</span><b>${counts.positive}</b></div><div class="r"><span>Revisión / bloqueo</span><b>${counts.review + counts.blocked}</b></div><div class="n"><span>Negativos</span><b>${counts.negative}</b></div></div>
<h2>3. Resultados</h2>
${detailed.map(card).join("") || "<p>No se obtuvieron resultados positivos ni pendientes de revisión.</p>"}
${negatives.length ? `<h2>4. Comprobaciones negativas</h2><table><tr><th>Consulta</th><th>Fuente</th><th>Fecha</th></tr>${negatives.map((h) => `<tr><td>${escapeHtml(queryLabel(h.query))}</td><td><a href="${escapeHtml(h.url)}">${escapeHtml(h.url)}</a></td><td>${escapeHtml(fmtDateTime(h.fetchedAt))}</td></tr>`).join("")}</table>` : ""}
<h2>${negatives.length ? 5 : 4}. Registro de actuaciones</h2>
<table class="log">${session.log.map((l) => `<tr><td>${escapeHtml(l.at.replace("T", " ").slice(0, 19))}</td><td>${escapeHtml(l.msg)}</td></tr>`).join("")}</table>
<div class="warn"><strong>Advertencia metodológica.</strong> La información procede de fuentes abiertas consultadas sin credenciales o mostrada en la sesión del investigador. Constituye un indicio que debe corroborarse con fuentes independientes. La coincidencia de un alias no acredita por sí sola la identidad. Un resultado negativo significa «sin perfil PayPal públicamente localizable mediante este identificador en el momento de la comprobación» y no demuestra que la cuenta no exista.</div>
<div class="sign"><div>Firma del investigador</div><div>Visto bueno / supervisor</div></div>
</div>
<footer>Generado por RASTRO PayPal Resolver · S3GAD3. La integridad de este fichero se acredita con el hash SHA-256 del fichero .sha256 que lo acompaña.</footer>
</div></body></html>`;
}

function countStatuses(hits) {
  return hits.reduce((acc, h) => { acc[h.status] = (acc[h.status] || 0) + 1; return acc; }, {positive: 0, review: 0, negative: 0, blocked: 0});
}

function buildTxt(session) {
  const lines = [
    "RASTRO — PAYPAL RESOLVER · INFORME OSINT", "=".repeat(48),
    `Expediente: ${session.caseId || "—"}`, `Investigador: ${session.investigator || "—"}`,
    `Inicio: ${session.startedAt}`, `Generado: ${new Date().toISOString()}`, ""
  ];
  sortedHits(session.hits).forEach((h, i) => {
    lines.push(`--- FICHA ${i + 1} · ${STATUS_LABEL[h.status]} · confianza ${h.confidence}/100`);
    lines.push(`Consulta: ${queryLabel(h.query)}`, `Fuente: ${h.source} · ${h.method}`, `URL: ${h.url}`, `Fecha: ${h.fetchedAt}`);
    FIELD_LABELS.forEach(([k, label]) => { if (h.fields?.[k]) lines.push(`${label}: ${h.fields[k]}`); });
    if (h.evidenceSha256) lines.push(`SHA-256 fuente: ${h.evidenceSha256}`);
    if (h.photoSha256) lines.push(`SHA-256 imagen: ${h.photoSha256}`);
    if (h.screenshotSha256) lines.push(`SHA-256 captura: ${h.screenshotSha256}`);
    if (h.notes) lines.push(`Notas: ${h.notes}`);
    lines.push("");
  });
  lines.push("REGISTRO DE ACTUACIONES", ...session.log.map((l) => `${l.at}  ${l.msg}`), "");
  lines.push("ADVERTENCIA: indicios procedentes de fuentes abiertas; requieren corroboración. Un negativo no demuestra que la cuenta no exista.");
  return lines.join("\n");
}

function sessionForExport(session) {
  return {
    tool: `RASTRO PayPal Resolver v${chrome.runtime.getManifest().version}`,
    exportedAt: new Date().toISOString(),
    caseId: session.caseId, investigator: session.investigator, startedAt: session.startedAt,
    queries: session.queries,
    hits: sortedHits(session.hits).map(({rawHtml, rawJson, photoData, screenshot, tabId, ...rest}) => rest),
    log: session.log
  };
}

function buildCsv(session) {
  const cols = ["status", "confidence", "query", "source", "method", "url", "fetchedAt", ...FIELD_LABELS.map(([k]) => k), "evidenceSha256", "photoSha256", "notes"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = sortedHits(session.hits).map((h) => cols.map((c) => {
    if (c === "query") return esc(queryLabel(h.query));
    if (c in (h.fields || {})) return esc(h.fields[c]);
    return esc(h[c]);
  }).join(";"));
  return "﻿" + [cols.join(";"), ...rows].join("\r\n");
}

async function downloadText(content, filename, mime) {
  const blob = new Blob([content], {type: `${mime};charset=utf-8`});
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({url, filename, saveAs: false, conflictAction: "uniquify"});
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return sha256Hex(await blob.arrayBuffer());
}
