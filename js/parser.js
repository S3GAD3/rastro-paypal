"use strict";
/* RASTRO PayPal Resolver — analizador de páginas públicas PayPal.Me
 *
 * PayPal.Me es una aplicación que incrusta el estado inicial del perfil
 * (nombre, foto, localidad, verificación...) en el HTML servido. Este módulo
 * localiza esos datos de forma tolerante a cambios de estructura:
 *   1. Barrido de pares "clave": valor en el HTML en bruto, en su versión
 *      con entidades HTML decodificadas y en su versión JS-escapada.
 *   2. Recorrido de bloques JSON (application/json, ld+json, __NEXT_DATA__...).
 *   3. Metadatos OpenGraph / Twitter / título.
 * Después prioriza los valores por campo y clasifica el resultado.
 */

const PP_KEYMAP = {
  name: ["displayName", "fullName", "payeeName", "recipientName", "ownerName"],
  altName: ["alternateFullName", "alternateName", "nickName", "nickname"],
  businessName: ["businessName", "dbaName", "merchantName", "companyName", "legalBusinessName"],
  givenName: ["givenName", "firstName", "first_name"],
  familyName: ["familyName", "lastName", "surname", "last_name"],
  username: ["slug", "paypalMeSlug", "paypalMeId", "vanityName", "userName", "username", "profileHandle"],
  photo: ["profilePhotoUrl", "profilePictureUrl", "profileImageUrl", "photoUrl", "avatarUrl", "profilePhoto", "avatar"],
  location: ["displayAddress", "formattedAddress", "locationText"],
  city: ["city", "locality", "addressLocality", "adminArea2"],
  region: ["addressRegion", "adminArea1", "province"],
  country: ["countryCode", "primaryCountry", "country", "addressCountry", "countryName"],
  verified: ["isVerified", "verified", "isIdentityVerified", "verifiedStatus"],
  accountType: ["accountType", "profileType", "userType", "partyType"],
  isBusiness: ["isBusiness", "isMerchant", "isBusinessAccount"],
  payerId: ["payerId", "encryptedAccountNumber", "encryptedPayerId", "accountId", "partyId"],
  merchantId: ["merchantId", "encryptedMerchantId"],
  currency: ["preferredCurrency", "currencyCode", "defaultCurrency"],
  bio: ["about", "bio", "profileDescription", "aboutMe", "tagline"],
  website: ["websiteUrl", "website", "businessUrl"],
  email: ["publicEmail", "businessEmail", "contactEmail", "email"],
  phone: ["publicPhone", "businessPhone", "contactPhone"],
  active: ["isProfileStatusActive", "profileStatus", "isActive", "isProfileActive"],
  createdAt: ["memberSince", "createdDate", "createdAt", "accountCreated"]
};

const PP_ALL_KEYS = [...new Set(Object.values(PP_KEYMAP).flat())];
const PP_KEY_RE = new RegExp(`"(${PP_ALL_KEYS.join("|")})"\\s*:\\s*("(?:[^"\\\\]|\\\\.){0,600}"|true|false|-?\\d{1,15}(?:\\.\\d+)?)`, "g");

const GENERIC_NAME = /^(paypal(\.me)?|paypalme|send money|enviar dinero|pay|pagar|payment|log ?in|iniciar sesi[oó]n|sign up|crear cuenta|undefined|null|n\/a|profile|perfil|user|usuario|\{\{.*\}\})$/i;
const GENERIC_IMAGE = /logo|favicon|sprite|brandmark|pp-?mark|paypal.?mark|paypal.?logo|webstatic\/(?:icon|mktg|logo)|default[-_]?avatar|placeholder|blank\.gif|og[-_]image|social[-_]share|paypalme\/(?:img|images)\//i;

function decodeEntities(text) {
  return text.replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/&#x2F;|&#47;/gi, "/").replace(/&#39;|&#x27;/gi, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

const PP_PHOTO_KEYS = new Set(PP_KEYMAP.photo);
const PP_NEAR_LIMIT = 6000; // distancia máxima (caracteres) a un ancla del perfil

/**
 * Devuelve {clave: [{value, dist}]} ordenado por cercanía a las "anclas" del
 * perfil (apariciones del alias consultado y claves de fotografía). Así se
 * evita tomar, por ejemplo, el displayName de una moneda o de un idioma.
 */
function collectKeyValues(html, requested = "") {
  const found = {};
  const variants = [html];
  if (html.includes("&quot;")) variants.push(decodeEntities(html));
  if (html.includes('\\"')) variants.push(html.replace(/\\\\"/g, '"').replace(/\\"/g, '"'));
  const reqRe = requested ? new RegExp(`["/]${requested.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["/?]`, "gi") : null;
  for (const text of variants) {
    const matches = [...text.matchAll(PP_KEY_RE)];
    const anchors = [];
    if (reqRe) for (const a of text.matchAll(reqRe)) anchors.push(a.index);
    matches.forEach((m) => { if (PP_PHOTO_KEYS.has(m[1]) && /https:/i.test(m[2])) anchors.push(m.index); });
    for (const m of matches) {
      let value;
      try { value = JSON.parse(m[2]); } catch { value = m[2].replace(/^"|"$/g, ""); }
      if (typeof value === "string") value = clean(value.replace(/\\u002F/gi, "/").replace(/\\\//g, "/"));
      if (value === "" || value === null) continue;
      const dist = anchors.length ? Math.min(...anchors.map((a) => Math.abs(a - m.index))) : Infinity;
      const list = (found[m[1]] ||= []);
      const prev = list.find((item) => item.value === value);
      if (prev) prev.dist = Math.min(prev.dist, dist);
      else list.push({value, dist, anchored: anchors.length > 0});
    }
  }
  for (const list of Object.values(found)) list.sort((a, b) => a.dist - b.dist);
  return found;
}

function walkJson(node, visit, depth = 0) {
  if (!node || typeof node !== "object" || depth > 40) return;
  if (Array.isArray(node)) { node.forEach((n) => walkJson(n, visit, depth + 1)); return; }
  for (const [k, v] of Object.entries(node)) {
    visit(k, v, node);
    if (v && typeof v === "object") walkJson(v, visit, depth + 1);
  }
}

function isUsablePhoto(url) {
  if (typeof url !== "string") return false;
  if (!/^https:\/\//i.test(url) && !/^data:image\//i.test(url)) return false;
  return !GENERIC_IMAGE.test(url);
}

function stripTitleNoise(text) {
  return clean(text)
    .replace(/^(?:paga\s+a|pagar\s+a|pay|pay\s+to|send\s+money\s+to|enviar\s+dinero\s+a|envía\s+dinero\s+a|payer|zahlen\s+an|payer\s+à|paga)\s+/i, "")
    .replace(/\s+(?:con|with|mit|avec|using|usando|a\s+través\s+de)\s+paypal(?:\.me)?.*$/i, "")
    .replace(/\s*[|·–—-]\s*paypal(?:\.me)?.*$/i, "")
    .replace(/\s*\(@?[A-Za-z0-9._-]+\)\s*$/, "")
    .trim();
}

/**
 * @param {string} html       HTML devuelto por PayPal.Me
 * @param {object} ctx        {requestedUsername, finalUrl, httpStatus, visible?}
 */
function parsePayPalMeHtml(html, ctx = {}) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = (key) => clean(doc.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.getAttribute("content"));
  const kv = collectKeyValues(html, ctx.requestedUsername || "");

  // Bloques JSON explícitos (solo ld+json aporta Person/Organization fiables)
  const ld = {};
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      walkJson(JSON.parse(s.textContent), (k, v, parent) => {
        if (k === "@type" && /Person|Organization|ProfilePage/i.test(String(v)) && !Object.keys(ld).length) Object.assign(ld, parent);
      });
    } catch {}
  });

  // Campos de contexto: deben estar cerca del alias/foto si existen anclas.
  const NEAR_FIELDS = new Set(["name", "givenName", "familyName", "altName", "businessName", "location", "city", "region", "country", "verified", "accountType", "isBusiness", "payerId", "merchantId", "bio", "website", "email", "phone", "createdAt"]);
  const pick = (field, accept = (v) => v !== "" && v != null) => {
    for (const key of PP_KEYMAP[field]) {
      for (const item of kv[key] || []) {
        if (NEAR_FIELDS.has(field) && item.anchored && item.dist > PP_NEAR_LIMIT) continue;
        if (accept(item.value)) return {value: item.value, key};
      }
    }
    return {value: "", key: ""};
  };
  const textOk = (v) => typeof v === "string" && v.length >= 2 && v.length <= 140 && !GENERIC_NAME.test(v) && !/^https?:/i.test(v) && !/[{}<>]/.test(v);

  const ogTitle = meta("og:title") || meta("twitter:title");
  const ogImage = meta("og:image") || meta("twitter:image");
  const ogDesc = meta("og:description") || meta("description");
  const title = clean(doc.title);

  const requested = (ctx.requestedUsername || "").toLowerCase();
  const finalUrl = ctx.finalUrl || "";
  const pathSlug = (finalUrl.match(/\/paypalme\/([^/?#]+)/i)?.[1] || (/paypal\.me$/i.test(safeHost(finalUrl)) ? new URL(finalUrl).pathname.split("/").filter(Boolean)[0] : "") || "");
  const decodedSlug = safeDecode(pathSlug);

  const name = pick("name", textOk);
  const givenName = pick("givenName", textOk);
  const familyName = pick("familyName", textOk);
  const businessName = pick("businessName", textOk);
  const altName = pick("altName", textOk);
  const photo = pick("photo", isUsablePhoto);
  const usernameKv = pick("username", (v) => typeof v === "string" && /^[A-Za-z0-9._-]{2,50}$/.test(v) && !/^(paypalme|paypal|my|home|landing)$/i.test(v));
  const locationKv = pick("location", textOk);
  const city = pick("city", textOk);
  const region = pick("region", textOk);
  const country = pick("country", (v) => typeof v === "string" && /^[A-Za-z .'-]{2,40}$/.test(v));
  const verified = pick("verified", (v) => typeof v === "boolean" || /^(true|false|verified|unverified)$/i.test(String(v)));
  const accountType = pick("accountType", textOk);
  const isBusiness = pick("isBusiness", (v) => typeof v === "boolean");
  const payerId = pick("payerId", (v) => typeof v === "string" && /^[A-Z0-9]{8,20}$/.test(v));
  const merchantId = pick("merchantId", (v) => typeof v === "string" && /^[A-Z0-9]{8,20}$/.test(v));
  const currency = pick("currency", (v) => typeof v === "string" && /^[A-Z]{3}$/.test(v));
  const bio = pick("bio", (v) => typeof v === "string" && v.length >= 3 && v.length <= 400);
  const website = pick("website", (v) => typeof v === "string" && /^https?:\/\//i.test(v) && !/paypal\.(com|me)/i.test(v));
  const email = pick("email", (v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && !/@paypal\./i.test(v));
  const phone = pick("phone", (v) => typeof v === "string" && /^\+?[\d\s().-]{7,20}$/.test(v));
  const active = pick("active", (v) => typeof v === "boolean" || typeof v === "string");
  const createdAt = pick("createdAt", (v) => typeof v === "string" && /\d{4}/.test(v));

  const ogName = stripTitleNoise(ogTitle);
  const ldName = typeof ld.name === "string" ? clean(ld.name) : "";
  const composed = clean(`${givenName.value} ${familyName.value}`);
  const visible = ctx.visible || {};

  let finalName = name.value || composed || businessName.value || ldName || (textOk(ogName) ? ogName : "") || visible.name || "";
  let nameSource = name.key || (composed ? "givenName+familyName" : businessName.key || (ldName ? "ld+json" : (finalName === ogName ? "og:title" : (visible.name ? "DOM visible" : ""))));
  if (!finalName || GENERIC_NAME.test(finalName)) { finalName = ""; nameSource = ""; }

  const ldImage = typeof ld.image === "string" ? ld.image : (ld.image?.url || ld.image?.contentUrl || "");
  const finalPhoto = photo.value || (isUsablePhoto(ldImage) ? ldImage : "") || (isUsablePhoto(ogImage) ? ogImage : "") || (isUsablePhoto(visible.image) ? visible.image : "");

  const ldAddr = ld.address || {};
  const locParts = [city.value || ldAddr.addressLocality, region.value || ldAddr.addressRegion].map(clean).filter(Boolean);
  const finalLocation = locationKv.value || locParts.join(", ") || visible.locationHint || "";

  const finalUsername = usernameKv.value || decodedSlug || visible.username || ctx.requestedUsername || "";

  const lowerText = clean(doc.body?.textContent || "").toLowerCase().slice(0, 20000);
  const lowerHtml = html.slice(0, 60000).toLowerCase();
  const notFoundSignals = ["page not found", "página no encontrada", "no hemos encontrado", "we can't find", "we couldn't find", "doesn't exist", "does not exist", "no existe", "isn't available", "no está disponible", "profile is not available", "perfil no disponible", "this paypal.me link isn"];
  const challengeSignals = ["captcha", "validatecaptcha", "ads-challenge", "security challenge", "comprobación de seguridad", "are you a robot", "verify you are human", "unusual activity", "akamai", "access denied"];

  const explicitNotFound = notFoundSignals.some((t) => lowerText.includes(t) || title.toLowerCase().includes(t));
  const challenge = [403, 429, 503].includes(ctx.httpStatus) || challengeSignals.some((t) => lowerHtml.includes(t) && !finalName);
  const redirectedAway = Boolean(requested) && finalUrl && !finalUrl.toLowerCase().includes(`/${requested.toLowerCase()}`) && !decodedSlug;
  const slugMatches = Boolean(requested) && finalUsername.toLowerCase() === requested;

  let status = "review";
  if (challenge && !finalName && !finalPhoto) status = "blocked";
  else if (finalName || (finalPhoto && slugMatches)) status = "positive";
  else if (ctx.httpStatus === 404 || explicitNotFound || redirectedAway) status = "negative";

  let confidence = 0;
  if (finalName) confidence += name.key ? 45 : 30;
  if (finalPhoto) confidence += 20;
  if (slugMatches) confidence += 15;
  if (finalLocation) confidence += 8;
  if (payerId.value || merchantId.value) confidence += 7;
  if (verified.value !== "") confidence += 5;
  if (status !== "positive") confidence = Math.min(confidence, 25);

  const isBiz = isBusiness.value === true || /business|merchant|empresa/i.test(String(accountType.value));
  const verifiedFlag = verified.value === true || /^(true|verified)$/i.test(String(verified.value));

  return {
    status,
    confidence: Math.min(100, confidence),
    fields: {
      name: finalName,
      givenName: givenName.value,
      familyName: familyName.value,
      altName: altName.value,
      businessName: businessName.value,
      username: finalUsername,
      photo: finalPhoto,
      location: finalLocation,
      country: country.value || clean(ldAddr.addressCountry),
      verified: verified.value === "" ? "" : (verifiedFlag ? "Sí" : "No"),
      accountType: accountType.value || (isBusiness.value === "" ? "" : (isBiz ? "Empresa" : "Personal")),
      payerId: payerId.value,
      merchantId: merchantId.value,
      currency: currency.value,
      bio: bio.value,
      website: website.value,
      email: email.value,
      phone: phone.value,
      active: active.value === "" ? "" : String(active.value),
      createdAt: createdAt.value
    },
    evidence: {
      httpStatus: ctx.httpStatus ?? null,
      finalUrl,
      pageTitle: title,
      ogTitle, ogImage, ogDescription: ogDesc,
      nameSource,
      photoSource: photo.key || (finalPhoto === ogImage ? "og:image" : finalPhoto ? "ld+json/DOM" : ""),
      explicitNotFound, challenge, redirectedAway, slugMatches,
      keysFound: Object.fromEntries(Object.entries(kv).map(([k, v]) => [k, v.slice(0, 4).map((i) => i.value)])),
      htmlBytes: html.length
    }
  };
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}
