"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  type: $("inputType"), target: $("target"), validation: $("validation"), flowHint: $("flowHint"),
  openPublic: $("openPublic"), openManual: $("openManual"), copyTarget: $("copyTarget"),
  capture: $("capture"), captureMessage: $("captureMessage"), pageBadge: $("pageBadge"),
  sourceSelect: $("sourceTabSelect"), sourceUrl: $("sourceUrl"), sourceBadge: $("sourceBadge"),
  resultPanel: $("resultPanel"), resultStatus: $("resultStatus"), name: $("resultName"),
  username: $("resultUsername"), location: $("resultLocation"), profileType: $("resultProfileType"),
  image: $("resultImage"), notes: $("resultNotes"), evidence: $("evidence"), history: $("history"),
  photoPanel: $("photoPanel"), photoThumb: $("photoThumb"), photoMessage: $("photoMessage"),
  photoModal: $("photoModal"), photoLarge: $("photoLarge"), photoLargeError: $("photoLargeError")
};

let currentCapture = null;
const HISTORY_KEY = "rastroPaypalHistoryV1";
const CONTEXT_KEY = "rastroPaypalContextV1";
const SOURCE_TAB_KEY = "rastroPaypalSourceTabV1";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  const saved = await chrome.storage.local.get([CONTEXT_KEY, HISTORY_KEY]);
  if (saved[CONTEXT_KEY]) {
    els.type.value = saved[CONTEXT_KEY].type || "username";
    els.target.value = saved[CONTEXT_KEY].target || "";
  }
  updateFlow();
  renderHistory(saved[HISTORY_KEY] || []);
  await refreshPayPalTabs();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshPayPalTabs(); });
}

function bindEvents() {
  els.type.addEventListener("change", updateFlow);
  els.target.addEventListener("input", () => { validateTarget(false); persistContext(); });
  els.copyTarget.addEventListener("click", copyTarget);
  els.openPublic.addEventListener("click", openPayPalMe);
  els.openManual.addEventListener("click", openManualSearch);
  els.capture.addEventListener("click", captureVisiblePage);
  $("saveResult").addEventListener("click", saveCurrentResult);
  $("exportTxt").addEventListener("click", () => exportCurrent("txt"));
  $("exportHtml").addEventListener("click", () => exportCurrent("html"));
  $("clearHistory").addEventListener("click", clearHistory);
  $("refreshTabs").addEventListener("click", refreshPayPalTabs);
  $("focusSource").addEventListener("click", focusSourceTab);
  els.sourceSelect.addEventListener("change", selectSourceTab);
  els.image.addEventListener("input", updatePhotoPreview);
  $("photoPreviewButton").addEventListener("click", showPhotoModal);
  $("viewPhoto").addEventListener("click", showPhotoModal);
  $("closePhoto").addEventListener("click", hidePhotoModal);
  els.photoModal.addEventListener("click", (event) => { if (event.target === els.photoModal) hidePhotoModal(); });
  $("openPhotoTab").addEventListener("click", openPhotoInTab);
  $("downloadPhoto").addEventListener("click", downloadPhoto);
  $("downloadPhotoModal").addEventListener("click", downloadPhoto);
  $("copyPhotoUrl").addEventListener("click", copyPhotoUrl);
  $("pivotName").addEventListener("click", pivotName);
  $("pivotUsername").addEventListener("click", pivotUsername);
  $("pivotGithub").addEventListener("click", pivotGithub);
  $("copyIdentity").addEventListener("click", copyIdentity);
  els.name.addEventListener("input", updatePivotButtons);
  els.username.addEventListener("input", updatePivotButtons);
}

function updateFlow() {
  const type = els.type.value;
  const config = {
    username: ["usuario", "Abrir PayPal.Me", "Abrir búsqueda manual", "Construye el perfil público PayPal.Me. La coincidencia del alias no demuestra por sí sola la identidad."],
    email: ["correo@ejemplo.com", "PayPal.Me no aplicable", "Copiar email y abrir PayPal", "El correo se copia para introducirlo en el buscador legítimo de destinatarios. La visibilidad depende de la privacidad de la cuenta."],
    phone: ["+34 600 000 000", "PayPal.Me no aplicable", "Copiar teléfono y abrir PayPal", "El teléfono se copia para introducirlo en el buscador legítimo de destinatarios. Normaliza el prefijo internacional antes de probar."]
  }[type];
  els.target.placeholder = config[0];
  els.openPublic.textContent = config[1];
  els.openManual.textContent = config[2];
  els.openPublic.disabled = type !== "username";
  els.flowHint.textContent = config[3];
  validateTarget(false);
  persistContext();
}

function normalizedTarget() {
  const raw = els.target.value.trim();
  if (els.type.value === "username") return raw.replace(/^@/, "");
  if (els.type.value === "email") return raw.toLowerCase();
  return raw.replace(/[^+\d]/g, "");
}

function validateTarget(showSuccess = true) {
  const value = normalizedTarget();
  let message = "";
  if (!value) message = "Introduce un identificador.";
  else if (els.type.value === "username" && !/^[A-Za-z0-9._-]{2,50}$/.test(value)) message = "Username no válido: usa letras, números, punto, guion o guion bajo.";
  else if (els.type.value === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) message = "Formato de correo no válido.";
  else if (els.type.value === "phone" && !/^\+?\d{7,15}$/.test(value)) message = "Usa entre 7 y 15 dígitos; se recomienda prefijo internacional.";
  els.validation.textContent = message || (showSuccess ? "Identificador preparado." : "");
  els.validation.className = "validation " + (message ? "error" : (showSuccess ? "ok" : ""));
  return !message;
}

async function persistContext() {
  await chrome.storage.local.set({[CONTEXT_KEY]: {type: els.type.value, target: els.target.value.trim()}});
}

async function copyTarget() {
  if (!validateTarget()) return;
  await navigator.clipboard.writeText(normalizedTarget());
  flashMessage("Dato copiado. Pégalo únicamente en el buscador de destinatarios de PayPal.");
}

async function openPayPalMe() {
  if (!validateTarget()) return;
  await persistContext();
  const username = normalizedTarget();
  const tab = await chrome.tabs.create({url: `https://www.paypal.me/${encodeURIComponent(username)}`});
  if (tab.id) await chrome.storage.local.set({[SOURCE_TAB_KEY]: tab.id});
}

async function openManualSearch() {
  if (!validateTarget()) return;
  await persistContext();
  await navigator.clipboard.writeText(normalizedTarget());
  const tab = await chrome.tabs.create({url: "https://www.paypal.com/myaccount/transfer/homepage"});
  if (tab.id) await chrome.storage.local.set({[SOURCE_TAB_KEY]: tab.id});
}

function isPayPalUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "paypal.com" || host.endsWith(".paypal.com") || host === "paypal.me" || host.endsWith(".paypal.me");
  } catch { return false; }
}

async function getSourceTab() {
  const selectedId = Number(els.sourceSelect.value);
  const stored = await chrome.storage.local.get(SOURCE_TAB_KEY);
  const tabId = Number.isInteger(selectedId) && selectedId > 0 ? selectedId : stored[SOURCE_TAB_KEY];
  if (!Number.isInteger(tabId)) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return isPayPalUrl(tab.url || "") ? tab : null;
  } catch { return null; }
}

async function refreshPayPalTabs() {
  const allTabs = await chrome.tabs.query({});
  const paypalTabs = allTabs.filter((tab) => tab.id && isPayPalUrl(tab.url || ""));
  const stored = await chrome.storage.local.get(SOURCE_TAB_KEY);
  const preferredId = stored[SOURCE_TAB_KEY];
  els.sourceSelect.replaceChildren();

  if (!paypalTabs.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No hay pestañas de PayPal abiertas";
    els.sourceSelect.append(option);
    updateSourceUi(null);
    return;
  }

  paypalTabs.forEach((tab) => {
    const option = document.createElement("option");
    option.value = String(tab.id);
    option.textContent = `${tab.title || "PayPal"} — ${new URL(tab.url).pathname}`;
    els.sourceSelect.append(option);
  });
  const selected = paypalTabs.find((tab) => tab.id === preferredId) || paypalTabs[0];
  els.sourceSelect.value = String(selected.id);
  await chrome.storage.local.set({[SOURCE_TAB_KEY]: selected.id});
  updateSourceUi(selected);
}

async function selectSourceTab() {
  const tab = await getSourceTab();
  if (tab?.id) await chrome.storage.local.set({[SOURCE_TAB_KEY]: tab.id});
  updateSourceUi(tab);
}

function updateSourceUi(tab) {
  const valid = Boolean(tab && isPayPalUrl(tab.url || ""));
  els.sourceBadge.textContent = valid ? "PAYPAL LISTO" : "SIN PESTAÑA";
  els.sourceBadge.className = `badge ${valid ? "located" : "neutral"}`;
  els.pageBadge.textContent = valid ? "FUENTE SELECCIONADA" : "SIN COMPROBAR";
  els.pageBadge.className = `badge ${valid ? "located" : "neutral"}`;
  els.sourceUrl.textContent = valid ? tab.url : "Abre PayPal o PayPal.Me para seleccionar una fuente.";
  els.capture.disabled = !valid;
  $("focusSource").disabled = !valid;
  if (!valid) els.captureMessage.textContent = "Abre primero PayPal o PayPal.Me y actualiza la lista de pestañas.";
}

async function focusSourceTab() {
  const tab = await getSourceTab();
  if (!tab?.id) return;
  await chrome.tabs.update(tab.id, {active: true});
  if (tab.windowId) await chrome.windows.update(tab.windowId, {focused: true});
}

async function captureVisiblePage() {
  els.capture.disabled = true;
  els.captureMessage.textContent = "Analizando metadatos y contenido visible…";
  try {
    const tab = await getSourceTab();
    if (!tab || !isPayPalUrl(tab.url || "")) throw new Error("No hay una pestaña válida de PayPal seleccionada.");
    const injected = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: extractVisiblePayPalData});
    const data = injected?.[0]?.result;
    if (!data) throw new Error("No se recibió contenido de la pestaña.");
    currentCapture = {
      ...data,
      investigationInput: normalizedTarget(),
      investigationInputType: els.type.value,
      capturedAt: new Date().toISOString()
    };
    renderCapture(currentCapture);
    els.captureMessage.textContent = data.status === "located" ? "Se localizaron indicios visibles. Revísalos antes de guardar." : "La página requiere revisión manual; no interpretes la ausencia como inexistencia de cuenta.";
  } catch (error) {
    els.captureMessage.textContent = `No se pudo capturar: ${error.message}`;
  } finally {
    els.capture.disabled = !(await getSourceTab());
  }
}

function extractVisiblePayPalData() {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const meta = (key) => clean(document.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.content);
  const visible = (node) => {
    if (!node) return false;
    const style = getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
  };
  const firstText = (selectors) => {
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        const text = clean(node.innerText || node.textContent);
        if (visible(node) && text.length >= 2 && text.length <= 120) return text;
      }
    }
    return "";
  };
  const genericImage = (url, label = "") => /logo|favicon|sprite|brandmark|paypal.?mark|paypal.?logo/i.test(`${url} ${label}`);
  const photoCandidates = [];
  const addPhoto = (url, node, source) => {
    const src = clean(url).replace(/^['"]|['"]$/g, "");
    if (!src || (!src.startsWith("https://") && !src.startsWith("data:image/")) || !node || !visible(node)) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 36 || rect.height < 36) return;
    const label = clean(`${node.getAttribute?.("alt") || ""} ${node.getAttribute?.("aria-label") || ""} ${node.className || ""}`);
    const style = getComputedStyle(node);
    const ratio = rect.width / rect.height;
    let score = 0;
    if (Math.abs(ratio - 1) < .2) score += 65;
    else if (Math.abs(ratio - 1) < .38) score += 30;
    if (rect.width >= 48 && rect.width <= 220 && rect.height >= 48 && rect.height <= 220) score += 35;
    if (rect.width > 350 || rect.height > 350) score -= 25;
    const radius = parseFloat(style.borderTopLeftRadius) || 0;
    if (style.borderRadius.includes("50%") || radius >= Math.min(rect.width, rect.height) * .3) score += 70;
    if (/avatar|profile|perfil|portrait|retrato|photo|foto/i.test(label)) score += 45;
    if (/cover|banner|hero|cabecera/i.test(label)) score -= 35;
    if (genericImage(src, label)) score -= 250;
    photoCandidates.push({url: src, score, width: Math.round(rect.width), height: Math.round(rect.height), source});
  };
  document.querySelectorAll("img").forEach((node) => addPhoto(node.currentSrc || node.src, node, "img"));
  const scanRoot = document.querySelector("main") || document.body;
  Array.from(scanRoot?.querySelectorAll("*") || []).slice(0, 1800).forEach((node) => {
    if (!visible(node)) return;
    const background = getComputedStyle(node).backgroundImage;
    const match = background?.match(/url\(["']?(.*?)["']?\)/i);
    if (match?.[1]) addPhoto(match[1], node, "background");
  });
  photoCandidates.sort((a, b) => b.score - a.score);
  const hostname = location.hostname.toLowerCase();
  const paypalMePath = location.pathname.match(/\/paypalme\/([^/?#]+)/i);
  const directPayPalMePath = (hostname === "paypal.me" || hostname.endsWith(".paypal.me")) ? location.pathname.split("/").filter(Boolean)[0] : "";
  const isPayPalMe = Boolean(paypalMePath || directPayPalMePath);
  const rawPageText = String(document.body?.innerText || "");
  const textLines = rawPageText.split(/\r?\n/).map(clean).filter(Boolean);
  const pageText = clean(rawPageText).slice(0, 6000);
  const pageTextLower = pageText.toLowerCase();
  const title = clean(document.title);
  const ogTitle = meta("og:title");
  const description = meta("og:description") || meta("description");
  const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
  let structured = {};
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const item = list.find((entry) => entry && typeof entry === "object" && (entry.name || entry.image || entry.address));
      if (item) { structured = item; break; }
    } catch {}
  }
  const generic = /^(paypal|send money|enviar dinero|pagar|payment|iniciar sesión|log in|sign up|crear cuenta)$/i;
  const rawName = firstText([
    '[data-testid*="recipient-name" i]', '[data-testid*="profile-name" i]',
    '[class*="recipientName" i]', '[class*="profileName" i]',
    '[class*="profile" i] h1', "main h1", "main h2", "h1"
  ]) || clean(structured.name) || ogTitle.split(/[|·–—-]/)[0].trim();
  const cleanedName = rawName
    .replace(/^(?:paga\s+a|pay\s+to|pay|send\s+money\s+to|enviar\s+dinero\s+a)\s+/i, "")
    .replace(/\s+(?:con|with)\s+paypal(?:\.me)?$/i, "")
    .trim();
  const name = generic.test(cleanedName) ? "" : cleanedName;
  const visibleHandle = rawPageText.match(/(?:^|\s)@([A-Za-z0-9._-]{2,50})\b/m)?.[1] || "";
  const pathHandle = paypalMePath?.[1] || directPayPalMePath || "";
  const username = clean(visibleHandle || decodeURIComponent(pathHandle)).replace(/^@/, "");
  const structuredImage = typeof structured.image === "string" ? structured.image : (structured.image?.url || structured.image?.contentUrl || "");
  const ogImage = meta("og:image");
  const bestDomPhoto = photoCandidates.find((candidate) => candidate.score > 20)?.url || "";
  const safeStructuredImage = genericImage(structuredImage) ? "" : structuredImage;
  const safeOgImage = genericImage(ogImage) || /paypalobjects\.com\/webstatic\/paypalme/i.test(ogImage) ? "" : ogImage;
  const image = clean(bestDomPhoto || safeStructuredImage || safeOgImage);
  const address = structured.address || {};
  const structuredLocation = [address.addressLocality, address.addressRegion].map(clean).filter(Boolean).join(", ");
  const handleLine = username ? textLines.findIndex((line) => line.toLowerCase() === `@${username.toLowerCase()}`) : -1;
  const nearbyLocation = handleLine >= 0 ? textLines.slice(handleLine + 1, handleLine + 5).find((line) => /^[\p{L}\d .'-]{2,50},\s*[\p{L}\d .'-]{2,30}$/u.test(line) && !/paypal|enviar|send|informar|report/i.test(line)) : "";
  const locationHint = clean(structuredLocation || nearbyLocation || "");
  const profileType = isPayPalMe ? "PayPal.Me público" : clean(structured["@type"] || "Destinatario PayPal");
  const notFoundSignals = ["page not found", "página no encontrada", "no hemos encontrado", "doesn't exist", "does not exist"];
  const challengeSignals = ["captcha", "security challenge", "comprobación de seguridad", "inicia sesión", "log in to your paypal account"];
  const explicitNotFound = notFoundSignals.some((term) => pageTextLower.includes(term) || title.toLowerCase().includes(term));
  const challenge = challengeSignals.some((term) => pageTextLower.includes(term));
  let status = "manual";
  if (explicitNotFound) status = "not_found_public";
  else if ((name || username || image) && !challenge) status = "located";
  return {
    status, name, username, locationHint, profileType, image,
    sourceUrl: location.href, canonicalUrl: canonical, pageTitle: title,
    evidence: {
      ogTitle, description, structuredType: clean(structured["@type"]), explicitNotFound, challenge,
      imageCandidates: photoCandidates.slice(0, 5), visibleExcerpt: pageText.slice(0, 900)
    }
  };
}

function renderCapture(data) {
  els.resultPanel.classList.remove("hidden");
  $("emptyResult").classList.add("hidden");
  const labels = {located: ["LOCALIZADO", "located"], manual: ["REVISIÓN MANUAL", "manual"], not_found_public: ["NO LOCALIZADO PÚBLICAMENTE", "not-found"]};
  const [label, cls] = labels[data.status] || labels.manual;
  els.resultStatus.textContent = label;
  els.resultStatus.className = `badge ${cls}`;
  els.name.value = data.name || "";
  els.username.value = data.username || "";
  els.location.value = data.locationHint || "";
  els.profileType.value = data.profileType || "";
  els.image.value = data.image || "";
  els.notes.value = "";
  updatePhotoPreview();
  updatePivotButtons();
  els.evidence.textContent = JSON.stringify({sourceUrl: data.sourceUrl, pageTitle: data.pageTitle, ...data.evidence}, null, 2);
}

function usablePhotoUrl() {
  const value = els.image.value.trim();
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch { return ""; }
}

function updatePhotoPreview() {
  const url = usablePhotoUrl();
  els.photoPanel.classList.toggle("hidden", !url);
  if (!url) {
    els.photoThumb.removeAttribute("src");
    els.photoLarge.removeAttribute("src");
    return;
  }
  els.photoMessage.textContent = "Pulsa la imagen para ampliarla.";
  els.photoThumb.onload = () => { els.photoMessage.textContent = "Imagen cargada desde la fuente visible."; };
  els.photoThumb.onerror = () => { els.photoMessage.textContent = "La URL existe, pero PayPal impide previsualizarla directamente."; };
  els.photoThumb.src = url;
}

function showPhotoModal() {
  const url = usablePhotoUrl();
  if (!url) return;
  els.photoLargeError.classList.add("hidden");
  els.photoLarge.onload = () => els.photoLargeError.classList.add("hidden");
  els.photoLarge.onerror = () => els.photoLargeError.classList.remove("hidden");
  els.photoLarge.src = url;
  els.photoModal.classList.remove("hidden");
}

function hidePhotoModal() {
  els.photoModal.classList.add("hidden");
}

async function openPhotoInTab() {
  const url = usablePhotoUrl();
  if (url) await chrome.tabs.create({url});
}

function safePhotoFilename(url) {
  let extension = ".jpg";
  try {
    const match = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i);
    if (match) extension = `.${match[1].toLowerCase()}`;
  } catch {}
  const identity = (els.username.value.trim() || els.name.value.trim() || "perfil")
    .replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 50) || "perfil";
  return `RASTRO-PayPal-foto-${identity}${extension}`;
}

async function downloadPhoto() {
  const url = usablePhotoUrl();
  if (!url) return;
  try {
    await chrome.downloads.download({url, filename: safePhotoFilename(url), saveAs: true});
    els.photoMessage.textContent = "Descarga iniciada.";
  } catch (error) {
    els.photoMessage.textContent = `No se pudo descargar directamente: ${error.message}`;
  }
}

async function copyPhotoUrl() {
  const url = usablePhotoUrl();
  if (!url) return;
  await navigator.clipboard.writeText(url);
  els.photoMessage.textContent = "URL de imagen copiada.";
}

function updatePivotButtons() {
  $("pivotName").disabled = !els.name.value.trim();
  const username = els.username.value.trim() || (els.type.value === "username" ? normalizedTarget() : "");
  $("pivotUsername").disabled = !username;
  $("pivotGithub").disabled = !username;
}

function openGoogleQuery(query) {
  chrome.tabs.create({url: `https://www.google.com/search?q=${encodeURIComponent(query)}`});
}

function pivotName() {
  const name = els.name.value.trim();
  if (name) openGoogleQuery(`"${name}"`);
}

function pivotUsername() {
  const username = els.username.value.trim() || (els.type.value === "username" ? normalizedTarget() : "");
  if (username) openGoogleQuery(`"${username}" OR "@${username}"`);
}

async function pivotGithub() {
  const username = els.username.value.trim() || (els.type.value === "username" ? normalizedTarget() : "");
  if (username) await chrome.tabs.create({url: `https://github.com/${encodeURIComponent(username)}`});
}

async function copyIdentity() {
  const lines = [
    els.name.value.trim() && `Nombre: ${els.name.value.trim()}`,
    els.username.value.trim() && `Username: ${els.username.value.trim()}`,
    els.location.value.trim() && `Localidad/pista: ${els.location.value.trim()}`,
    currentCapture?.sourceUrl && `Fuente: ${currentCapture.sourceUrl}`
  ].filter(Boolean);
  if (!lines.length) return;
  await navigator.clipboard.writeText(lines.join("\n"));
  flashMessage("Identidad copiada para pivotar en otros módulos.");
}

function collectEditedResult() {
  if (!currentCapture) return null;
  return {
    ...currentCapture,
    name: els.name.value.trim(), username: els.username.value.trim(),
    locationHint: els.location.value.trim(), profileType: els.profileType.value.trim(),
    image: usablePhotoUrl(), investigatorNotes: els.notes.value.trim()
  };
}

async function saveCurrentResult() {
  const result = collectEditedResult();
  if (!result) return;
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history = [result, ...(stored[HISTORY_KEY] || [])].slice(0, 50);
  await chrome.storage.local.set({[HISTORY_KEY]: history});
  renderHistory(history);
  flashMessage("Resultado guardado localmente en el navegador.");
}

function renderHistory(history) {
  els.history.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "Sin capturas guardadas."; els.history.append(empty); return;
  }
  history.forEach((item) => {
    const row = document.createElement("div"); row.className = "history-item";
    const title = document.createElement("strong"); title.textContent = item.name || item.username || item.investigationInput || "Captura sin nombre";
    const meta = document.createElement("span"); meta.textContent = `${new Date(item.capturedAt).toLocaleString("es-ES")} · ${item.status}`;
    row.append(title, meta); els.history.append(row);
  });
}

async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
  renderHistory([]);
  flashMessage("Historial local eliminado.");
}

function resultAsText(item) {
  return [
    "RASTRO — PAYPAL RESOLVER", "", `Estado: ${item.status}`, `Entrada: ${item.investigationInputType} · ${item.investigationInput}`,
    `Nombre visible: ${item.name || "—"}`, `Username: ${item.username || "—"}`, `Localidad/pista: ${item.locationHint || "—"}`,
    `Tipo de perfil: ${item.profileType || "—"}`, `Imagen: ${item.image || "—"}`, `Fuente: ${item.sourceUrl}`,
    `Fecha UTC: ${item.capturedAt}`, `Notas: ${item.investigatorNotes || "—"}`, "", "ADVERTENCIA",
    "Resultado orientativo basado en información visible. Debe corroborarse con otras fuentes. Un resultado negativo no demuestra que la cuenta no exista.", "", "EVIDENCIA TÉCNICA", JSON.stringify(item.evidence, null, 2)
  ].join("\n");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
}

function resultAsHtml(item) {
  const rows = [["Estado",item.status],["Tipo de entrada",item.investigationInputType],["Entrada",item.investigationInput],["Nombre visible",item.name],["Username",item.username],["Localidad / pista",item.locationHint],["Tipo de perfil",item.profileType],["Imagen",item.image],["Fuente",item.sourceUrl],["Fecha UTC",item.capturedAt],["Notas",item.investigatorNotes]];
  const photo = item.image ? `<figure><img src="${escapeHtml(item.image)}" alt="Fotografía visible del perfil" referrerpolicy="no-referrer"><figcaption>Fotografía referenciada por la página de PayPal en el momento de la captura.</figcaption></figure>` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe RASTRO PayPal</title><style>body{font:14px Arial;color:#172b3b;max-width:900px;margin:35px auto;padding:0 20px}h1{color:#0b2a43;border-bottom:4px solid #2678b5;padding-bottom:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #c7d2db;padding:9px;text-align:left;vertical-align:top}th{width:190px;background:#edf3f7}figure{margin:18px 0;padding:14px;background:#edf3f7;border:1px solid #c7d2db}figure img{display:block;max-width:420px;max-height:420px;object-fit:contain;background:#142331}figcaption{margin-top:8px;color:#526878;font-size:12px}.warning{margin-top:18px;padding:12px;border-left:4px solid #b67a18;background:#fff4df}pre{white-space:pre-wrap;background:#f3f6f8;padding:12px}</style></head><body><h1>RASTRO — PayPal Resolver</h1>${photo}<table>${rows.map(([k,v])=>`<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v || "—")}</td></tr>`).join("")}</table><div class="warning"><strong>Advertencia metodológica.</strong> Resultado orientativo basado en información visible. Debe corroborarse con otras fuentes. Un resultado negativo no demuestra que la cuenta no exista.</div><h2>Evidencia técnica</h2><pre>${escapeHtml(JSON.stringify(item.evidence,null,2))}</pre></body></html>`;
}

async function exportCurrent(format) {
  const item = collectEditedResult();
  if (!item) return;
  const content = format === "html" ? resultAsHtml(item) : resultAsText(item);
  const mime = format === "html" ? "text/html" : "text/plain";
  const blob = new Blob([content], {type: `${mime};charset=utf-8`});
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await chrome.downloads.download({url, filename: `RASTRO-PayPal-${stamp}.${format}`, saveAs: true});
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function flashMessage(message) {
  els.validation.textContent = message;
  els.validation.className = "validation ok";
}
