"use strict";

const CONSOLE_PAGE = "console.html";
const SOURCE_TAB_KEY = "rastroPaypalSourceTabV1";
const CONSOLE_TAB_KEY = "rastroPaypalConsoleTabV1";

function isPayPalUrl(value) {
  try {
    const host = new URL(value || "").hostname.toLowerCase();
    return host === "paypal.com" || host.endsWith(".paypal.com") || host === "paypal.me" || host.endsWith(".paypal.me");
  } catch { return false; }
}

async function getExistingConsoleTab() {
  const stored = await chrome.storage.local.get(CONSOLE_TAB_KEY);
  const id = stored[CONSOLE_TAB_KEY];
  if (!Number.isInteger(id)) return null;
  try {
    const tab = await chrome.tabs.get(id);
    return tab.url?.startsWith(chrome.runtime.getURL(CONSOLE_PAGE)) ? tab : null;
  } catch { return null; }
}

chrome.action.onClicked.addListener(async (sourceTab) => {
  if (sourceTab?.id && isPayPalUrl(sourceTab.url)) {
    await chrome.storage.local.set({[SOURCE_TAB_KEY]: sourceTab.id});
  }

  const existing = await getExistingConsoleTab();
  if (existing?.id) {
    await chrome.tabs.update(existing.id, {active: true});
    if (existing.windowId) await chrome.windows.update(existing.windowId, {focused: true});
    return;
  }

  const created = await chrome.tabs.create({url: chrome.runtime.getURL(CONSOLE_PAGE), active: true});
  if (created.id) await chrome.storage.local.set({[CONSOLE_TAB_KEY]: created.id});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const stored = await chrome.storage.local.get([CONSOLE_TAB_KEY, SOURCE_TAB_KEY]);
  const changes = {};
  if (stored[CONSOLE_TAB_KEY] === tabId) changes[CONSOLE_TAB_KEY] = null;
  if (stored[SOURCE_TAB_KEY] === tabId) changes[SOURCE_TAB_KEY] = null;
  if (Object.keys(changes).length) await chrome.storage.local.set(changes);
});
