"use strict";
/* RASTRO PayPal Resolver — utilidades comunes */

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"}[c]));
}

async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBytes(dataUrl) {
  return new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
}

function fmtTime(iso) {
  return new Date(iso).toISOString().slice(11, 19);
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleString("es-ES", {dateStyle: "short", timeStyle: "medium"})} (${d.toISOString().replace("T", " ").slice(0, 19)} UTC)`;
}

let toastTimer = null;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

async function copyText(text, message = "Copiado al portapapeles.") {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  toast(message);
}

/* ---------- Limitador de ritmo para peticiones a PayPal ---------- */
const RateLimiter = {
  last: 0,
  minGapMs: 1400,
  async wait() {
    const jitter = Math.floor(Math.random() * 500);
    const gap = this.last + this.minGapMs + jitter - Date.now();
    if (gap > 0) await sleep(gap);
    this.last = Date.now();
  }
};

/* ---------- Detección y normalización de identificadores ---------- */
const Ident = {
  detect(raw) {
    const value = clean(raw);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "email";
    if (/^\+?[\d\s().-]{7,20}$/.test(value) && value.replace(/\D/g, "").length >= 7) return "phone";
    return "username";
  },

  username(raw) {
    let value = clean(raw);
    const url = value.match(/paypal\.(?:me|com\/paypalme)\/([^/?#\s]+)/i);
    if (url) value = decodeURIComponent(url[1]);
    return value.replace(/^@/, "").replace(/\/+$/, "");
  },

  validUsername(value) {
    return /^[A-Za-z0-9._-]{1,50}$/.test(value);
  },

  email(raw) {
    return clean(raw).toLowerCase();
  },

  validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  },

  /** Normaliza a E.164 usando el prefijo por defecto si el número no lo trae. */
  phone(raw, defaultCc = "34") {
    let s = clean(raw).replace(/[^\d+]/g, "");
    if (s.startsWith("00")) s = "+" + s.slice(2);
    if (s.startsWith("+")) {
      const d = s.slice(1).replace(/\D/g, "");
      const cc = guessCc(d);
      return {e164: "+" + d, cc, national: d.slice(cc.length)};
    }
    let nat = s.replace(/\D/g, "");
    // Prefijo troncal nacional (0) en FR, UK, DE, NL, PT...; Italia lo conserva.
    if (defaultCc !== "39") nat = nat.replace(/^0+/, "");
    return {e164: `+${defaultCc}${nat}`, cc: defaultCc, national: nat};
  },

  validPhone(p) {
    return /^\+\d{8,15}$/.test(p.e164);
  },

  phoneFormats(p) {
    const n = p.national;
    const groups3 = n.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
    const set = new Set([
      p.e164, p.e164.slice(1), `00${p.e164.slice(1)}`, n, groups3,
      `+${p.cc} ${groups3}`, n.replace(/(\d{3})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4"),
      n.replace(/(\d{3})(\d{3})(\d+)$/, "$1-$2-$3")
    ]);
    return [...set].filter(Boolean);
  },

  /** Alias PayPal.Me plausibles a partir del correo (PayPal.Me admite letras y números). */
  emailCandidates(email) {
    const local = email.split("@")[0].replace(/\+.*$/, "").toLowerCase();
    const parts = local.split(/[._-]+/).filter((p) => p && !/^\d+$/.test(p));
    const set = new Set();
    const add = (v) => { v = (v || "").replace(/[^a-z0-9]/g, ""); if (v.length >= 3 && v.length <= 20) set.add(v); };
    add(local);
    add(local.replace(/\d+$/, ""));
    if (parts.length >= 2) {
      add(parts.join(""));
      add([...parts].reverse().join(""));
      add(parts[0] + parts[parts.length - 1]);
      add(parts[0][0] + parts.slice(1).join(""));
      add(parts[0] + parts[1][0]);
    }
    return [...set].slice(0, 7);
  },

  /** Variantes ligeras del alias para cubrir errores de transcripción habituales. */
  usernameVariants(username) {
    const base = username.toLowerCase();
    const set = new Set();
    const add = (v) => { if (v && v !== base && /^[a-z0-9]{2,20}$/.test(v)) set.add(v); };
    add(base.replace(/[^a-z0-9]/g, ""));
    add(base.replace(/\d+$/, ""));
    add(base.replace(/[^a-z0-9]/g, "").replace(/\d+$/, ""));
    return [...set].slice(0, 3);
  }
};

function guessCc(digits) {
  const known = ["1", "7", "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44", "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91", "92", "93", "94", "95", "98", "212", "213", "216", "218", "351", "352", "353", "354", "355", "356", "357", "358", "359", "370", "371", "372", "373", "374", "375", "376", "377", "378", "380", "381", "382", "385", "386", "387", "389", "420", "421", "423", "502", "503", "504", "505", "506", "507", "591", "592", "593", "595", "597", "598", "971", "972", "973", "974", "966"];
  for (const len of [3, 2, 1]) {
    const cc = digits.slice(0, len);
    if (known.includes(cc)) return cc;
  }
  return "";
}
