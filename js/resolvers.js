"use strict";
/* RASTRO PayPal Resolver — resolutores
 *
 * Todas las consultas se hacen sin credenciales (credentials: "omit"), a
 * páginas y servicios públicos, una a una y con pausa entre peticiones.
 * No se utilizan endpoints de inicio de sesión, registro ni recuperación de
 * contraseña, ni se intenta eludir captchas: si PayPal presenta un reto, la
 * pestaña se entrega al investigador para que lo resuelva manualmente.
 */

function newHit(partial) {
  return {
    id: uid(),
    status: "review",
    confidence: 0,
    fields: {},
    evidence: {},
    evidenceSha256: "",
    photoData: "",
    photoSha256: "",
    screenshot: "",
    screenshotSha256: "",
    notes: "",
    fetchedAt: new Date().toISOString(),
    ...partial
  };
}

/* ---------------- PayPal.Me: consulta HTTP directa ---------------- */
async function resolvePayPalMe(username, query, opts = {}) {
  const url = `https://www.paypal.com/paypalme/${encodeURIComponent(username)}`;
  await RateLimiter.wait();
  let res, html = "";
  try {
    res = await fetch(url, {
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      headers: {"Accept": "text/html,application/xhtml+xml", "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"}
    });
    html = await res.text();
  } catch (error) {
    opts.log?.(`Error de red en PayPal.Me/${username}: ${error.message}`, "err");
    if (opts.tabFallback) return resolvePayPalMeViaTab(username, query, opts);
    return newHit({query, source: "PayPal.Me", method: "HTTP directo", url, status: "blocked", evidence: {error: error.message}});
  }

  const parsed = parsePayPalMeHtml(html, {requestedUsername: username, finalUrl: res.url, httpStatus: res.status});
  const hit = newHit({
    query, source: "PayPal.Me", method: "HTTP directo (sin sesión)", url,
    status: parsed.status, confidence: parsed.confidence, fields: parsed.fields,
    evidence: parsed.evidence, evidenceSha256: await sha256Hex(html)
  });
  hit.rawHtml = html;

  if ((parsed.status === "blocked" || parsed.status === "review") && opts.tabFallback) {
    opts.log?.(`PayPal.Me/${username}: respuesta ${parsed.status === "blocked" ? "con reto de seguridad" : "sin datos embebidos"} (HTTP ${res.status}). Reintentando en pestaña.`, "warn");
    const viaTab = await resolvePayPalMeViaTab(username, query, opts);
    if (viaTab.status !== "review") return viaTab;
  }
  await attachPhoto(hit);
  return hit;
}

/* ---------------- PayPal.Me: pestaña automatizada ---------------- */
async function resolvePayPalMeViaTab(username, query, opts = {}) {
  const url = `https://www.paypal.com/paypalme/${encodeURIComponent(username)}`;
  await RateLimiter.wait();
  const tab = await chrome.tabs.create({url, active: false});
  try {
    await waitForTabComplete(tab.id, 30000);
    const data = await extractFromTab(tab.id, {waitForContent: true});
    const parsed = parsePayPalMeHtml(data.html, {requestedUsername: username, finalUrl: data.url, httpStatus: 200, visible: data.visible});
    const hit = newHit({
      query, source: "PayPal.Me", method: "Pestaña automatizada", url: data.url || url,
      status: parsed.status, confidence: parsed.confidence, fields: parsed.fields,
      evidence: {...parsed.evidence, visibleExcerpt: data.visible.excerpt, imageCandidates: data.visible.imageCandidates},
      evidenceSha256: await sha256Hex(data.html)
    });
    hit.rawHtml = data.html;
    if (parsed.status === "blocked") {
      hit.tabId = tab.id;
      await chrome.tabs.update(tab.id, {active: true});
      opts.log?.(`PayPal presenta un reto de seguridad para ${username}. Resuélvelo en la pestaña abierta y usa «Analizar pestaña».`, "warn");
      return hit;
    }
    await attachPhoto(hit);
    if (!opts.keepTabs) chrome.tabs.remove(tab.id).catch(() => {});
    return hit;
  } catch (error) {
    opts.log?.(`Fallo en pestaña automatizada (${username}): ${error.message}`, "err");
    return newHit({query, source: "PayPal.Me", method: "Pestaña automatizada", url, status: "review", evidence: {error: error.message}, tabId: tab.id});
  }
}

function waitForTabComplete(tabId, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("Tiempo de carga agotado")); }, timeout);
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") listener(tabId, {status: "complete"}); }).catch(() => {});
  });
}

async function extractFromTab(tabId, {waitForContent = false} = {}) {
  if (waitForContent) {
    // Espera a que la aplicación pinte el perfil (hasta ~8 s).
    for (let i = 0; i < 16; i++) {
      const [{result} = {}] = await chrome.scripting.executeScript({
        target: {tabId},
        func: () => Boolean(document.querySelector("main h1, h1, [data-testid*='name' i], img[alt]")) && document.body.innerText.length > 200
      });
      if (result) break;
      await sleep(500);
    }
    await sleep(600);
  }
  const [{result} = {}] = await chrome.scripting.executeScript({target: {tabId}, func: extractVisiblePayPalData});
  if (!result) throw new Error("La pestaña no devolvió contenido");
  return result;
}

/* Se inyecta en la pestaña de PayPal: debe ser autocontenida. */
function extractVisiblePayPalData() {
  const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
  const visible = (n) => {
    if (!n) return false;
    const s = getComputedStyle(n);
    return s.display !== "none" && s.visibility !== "hidden" && n.getClientRects().length > 0;
  };
  const firstText = (selectors) => {
    for (const sel of selectors) {
      for (const n of document.querySelectorAll(sel)) {
        const t = clean(n.innerText || n.textContent);
        if (visible(n) && t.length >= 2 && t.length <= 120) return t;
      }
    }
    return "";
  };
  const genericImage = (u, l = "") => /logo|favicon|sprite|brandmark|paypal.?mark|paypal.?logo|webstatic\/(icon|mktg)/i.test(`${u} ${l}`);
  const cands = [];
  const addPhoto = (u, n, source) => {
    const src = clean(u).replace(/^['"]|['"]$/g, "");
    if (!src || (!src.startsWith("https://") && !src.startsWith("data:image/")) || !visible(n)) return;
    const r = n.getBoundingClientRect();
    if (r.width < 36 || r.height < 36) return;
    const label = clean(`${n.getAttribute?.("alt") || ""} ${n.getAttribute?.("aria-label") || ""} ${typeof n.className === "string" ? n.className : ""}`);
    const st = getComputedStyle(n);
    const ratio = r.width / r.height;
    let score = 0;
    if (Math.abs(ratio - 1) < .2) score += 65; else if (Math.abs(ratio - 1) < .38) score += 30;
    if (r.width >= 48 && r.width <= 260 && r.height >= 48 && r.height <= 260) score += 35;
    if (r.width > 380 || r.height > 380) score -= 25;
    const rad = parseFloat(st.borderTopLeftRadius) || 0;
    if (st.borderRadius.includes("50%") || rad >= Math.min(r.width, r.height) * .3) score += 70;
    if (/avatar|profile|perfil|portrait|photo|foto/i.test(label)) score += 45;
    if (/cover|banner|hero|cabecera/i.test(label)) score -= 35;
    if (genericImage(src, label)) score -= 250;
    cands.push({url: src, score, width: Math.round(r.width), height: Math.round(r.height), source});
  };
  document.querySelectorAll("img").forEach((n) => addPhoto(n.currentSrc || n.src, n, "img"));
  Array.from((document.querySelector("main") || document.body).querySelectorAll("*")).slice(0, 2500).forEach((n) => {
    const bg = getComputedStyle(n).backgroundImage;
    const m = bg && bg !== "none" ? bg.match(/url\(["']?(.*?)["']?\)/i) : null;
    if (m?.[1]) addPhoto(m[1], n, "background");
  });
  cands.sort((a, b) => b.score - a.score);

  const rawText = String(document.body?.innerText || "");
  const lines = rawText.split(/\r?\n/).map(clean).filter(Boolean);
  const generic = /^(paypal|send money|enviar dinero|pagar|payment|iniciar sesión|log in|sign up|crear cuenta|enviar|send|request|solicitar)$/i;
  const rawName = firstText([
    '[data-testid*="recipient-name" i]', '[data-testid*="profile-name" i]', '[data-testid*="payee-name" i]',
    '[class*="recipientName" i]', '[class*="profileName" i]', '[class*="payeeName" i]',
    '[class*="profile" i] h1', "main h1", "main h2", "h1"
  ]);
  const name = clean(rawName.replace(/^(?:paga\s+a|pay|send\s+money\s+to|enviar\s+dinero\s+a)\s+/i, "").replace(/\s+(?:con|with)\s+paypal(?:\.me)?$/i, ""));
  const handle = rawText.match(/(?:^|\s)@([A-Za-z0-9._-]{2,50})\b/m)?.[1] || "";
  const hl = handle ? lines.findIndex((l) => l.toLowerCase() === `@${handle.toLowerCase()}`) : -1;
  const loc = hl >= 0 ? lines.slice(hl + 1, hl + 5).find((l) => /^[\p{L}\d .'-]{2,50},\s*[\p{L}\d .'-]{2,30}$/u.test(l) && !/paypal|enviar|send|informar|report/i.test(l)) : "";
  const emailShown = rawText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] || "";
  return {
    url: location.href,
    title: document.title,
    html: document.documentElement.outerHTML.slice(0, 4000000),
    visible: {
      name: generic.test(name) ? "" : name,
      username: handle,
      locationHint: loc || "",
      emailShown,
      image: cands.find((c) => c.score > 20)?.url || "",
      imageCandidates: cands.slice(0, 5),
      excerpt: clean(rawText).slice(0, 1200)
    }
  };
}

/* ---------------- Captura de una pestaña PayPal elegida ---------------- */
async function captureSelectedTab(tab, query) {
  const data = await extractFromTab(tab.id);
  const isPayPalMe = /\/paypalme\/[^/?#]+/i.test(data.url) || /(^|\.)paypal\.me$/i.test(safeHost(data.url));
  let hit;
  if (isPayPalMe) {
    const slug = safeDecode(data.url.match(/\/paypalme\/([^/?#]+)/i)?.[1] || new URL(data.url).pathname.split("/").filter(Boolean)[0] || "");
    const parsed = parsePayPalMeHtml(data.html, {requestedUsername: slug, finalUrl: data.url, httpStatus: 200, visible: data.visible});
    hit = newHit({query, source: "PayPal.Me", method: "Captura de pestaña", url: data.url, status: parsed.status, confidence: parsed.confidence, fields: parsed.fields, evidence: {...parsed.evidence, visibleExcerpt: data.visible.excerpt}});
  } else {
    // Flujos con sesión (buscador de destinatarios): solo se usa lo VISIBLE,
    // nunca el estado interno, que contiene datos de la cuenta del propio investigador.
    const v = data.visible;
    const status = v.name || v.image ? "positive" : "review";
    hit = newHit({
      query, source: "PayPal (sesión del investigador)", method: "Captura de pestaña", url: data.url, status,
      confidence: status === "positive" ? 55 : 10,
      fields: {name: v.name, username: v.username, location: v.locationHint, photo: v.image},
      evidence: {pageTitle: data.title, visibleExcerpt: v.excerpt, imageCandidates: v.imageCandidates}
    });
  }
  hit.evidenceSha256 = await sha256Hex(data.html);
  hit.rawHtml = data.html;
  await attachPhoto(hit);
  return hit;
}

/* ---------------- Gravatar (correo → perfil público) ---------------- */
async function resolveGravatar(email, query, opts = {}) {
  const hash = await sha256Hex(email.trim().toLowerCase());
  const profileUrl = `https://api.gravatar.com/v3/profiles/${hash}`;
  const avatarUrl = `https://gravatar.com/avatar/${hash}?s=400&d=404`;
  const hit = newHit({query, source: "Gravatar", method: "API pública (hash SHA-256)", url: `https://gravatar.com/${hash}`, evidence: {sha256: hash}});
  const derived = [];
  try {
    const res = await fetch(profileUrl, {credentials: "omit", cache: "no-store"});
    hit.evidence.httpStatus = res.status;
    if (res.ok) {
      const p = await res.json();
      hit.status = "positive";
      hit.confidence = 70;
      hit.url = p.profile_url || hit.url;
      hit.fields = {
        name: p.display_name || "",
        username: (p.profile_url || "").split("/").filter(Boolean).pop() || "",
        location: p.location || "",
        photo: p.avatar_url ? `${p.avatar_url.split("?")[0]}?s=400` : "",
        bio: p.description || "",
        website: p.profile_url || "",
        accountType: [p.job_title, p.company].filter(Boolean).join(" · "),
        pronouns: p.pronouns || ""
      };
      const accounts = (p.verified_accounts || []).map((a) => ({service: a.service_label || a.service_type, url: a.url}));
      hit.evidence.verifiedAccounts = accounts;
      hit.fields.linkedAccounts = accounts.map((a) => `${a.service}: ${a.url}`).join(" | ");
      accounts.forEach((a) => {
        const handle = String(a.url || "").replace(/\/+$/, "").split("/").pop()?.replace(/^@/, "");
        if (handle && /^[A-Za-z0-9._-]{3,30}$/.test(handle)) derived.push(handle);
      });
      if (hit.fields.username) derived.unshift(hit.fields.username);
      hit.evidenceSha256 = await sha256Hex(JSON.stringify(p));
      hit.rawJson = p;
    } else if (res.status === 404) {
      const av = await fetch(avatarUrl, {credentials: "omit", cache: "no-store"});
      if (av.ok) {
        hit.status = "review";
        hit.confidence = 35;
        hit.fields = {photo: avatarUrl.replace("&d=404", "")};
        hit.evidence.note = "Sin perfil público, pero el correo tiene avatar Gravatar asociado.";
      } else {
        hit.status = "negative";
        hit.evidence.note = "Sin perfil ni avatar Gravatar para este correo.";
      }
    } else {
      hit.status = res.status === 429 ? "blocked" : "review";
      hit.evidence.note = `Respuesta HTTP ${res.status}`;
    }
  } catch (error) {
    hit.status = "review";
    hit.evidence.error = error.message;
    opts.log?.(`Gravatar no disponible: ${error.message}`, "err");
  }
  await attachPhoto(hit);
  return {hit, derived: [...new Set(derived)]};
}

/* ---------------- Fotografía: copia local + hash ---------------- */
async function attachPhoto(hit) {
  const url = hit.fields?.photo;
  if (!url || hit.photoData) return;
  try {
    if (url.startsWith("data:image/")) {
      hit.photoData = url;
    } else {
      const res = await fetch(url, {credentials: "omit", cache: "no-store"});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error(`tipo ${blob.type}`);
      hit.photoData = await blobToDataUrl(blob);
      hit.photoSha256 = await sha256Hex(await blob.arrayBuffer());
      hit.evidence.photoBytes = blob.size;
      hit.evidence.photoMime = blob.type;
      return;
    }
    hit.photoSha256 = await sha256Hex(await dataUrlToBytes(hit.photoData));
  } catch (error) {
    hit.evidence.photoError = `No se pudo conservar copia local de la imagen (${error.message}).`;
  }
}

/* ---------------- Captura de pantalla de la fuente ---------------- */
async function screenshotTab(tab) {
  await chrome.tabs.update(tab.id, {active: true});
  await chrome.windows.update(tab.windowId, {focused: true});
  await sleep(450);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {format: "png"});
  return {dataUrl, sha256: await sha256Hex(await dataUrlToBytes(dataUrl)), url: tab.url, at: new Date().toISOString()};
}
