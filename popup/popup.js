// See the note in content.js — Firefox provides `browser`, Chromium `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

// Keep in sync with the copy in content.js.
const DEFAULT_SETTINGS = {
  hideSponsored: true,
  hideSuggested: true,
  hideUnfollowed: true,
  hideAppBanner: true,
  placeholderMode: false,
};

const hideSponsoredEl = document.getElementById("hideSponsored");
const hideSuggestedEl = document.getElementById("hideSuggested");
const hideUnfollowedEl = document.getElementById("hideUnfollowed");
const hideAppBannerEl = document.getElementById("hideAppBanner");
const placeholderModeEl = document.getElementById("placeholderMode");
const countEl = document.getElementById("count");
const notFacebookEl = document.getElementById("notFacebook");
const permissionPromptEl = document.getElementById("permissionPrompt");
const grantAccessEl = document.getElementById("grantAccess");
const diagnosticsEl = document.getElementById("diagnostics");
const diagnosticsBodyEl = document.getElementById("diagnosticsBody");
const copyDiagnosticsEl = document.getElementById("copyDiagnostics");

const FACEBOOK_ORIGINS = { origins: ["*://*.facebook.com/*"] };

function save() {
  browser.storage.local.set({
    hideSponsored: hideSponsoredEl.checked,
    hideSuggested: hideSuggestedEl.checked,
    hideUnfollowed: hideUnfollowedEl.checked,
    hideAppBanner: hideAppBannerEl.checked,
    placeholderMode: placeholderModeEl.checked,
  });
}

// Firefox MV3 treats host permissions as opt-in, so a fresh install runs no
// content script at all and appears to be doing nothing. Chromium grants them
// at install, where this check simply passes and the prompt never shows.
// Treat an error as "granted": failing open shows the normal popup rather
// than nagging for permission the extension may already have.
async function hasFacebookAccess() {
  try {
    return await browser.permissions.contains(FACEBOOK_ORIGINS);
  } catch {
    return true;
  }
}

async function refreshPermissionState() {
  const granted = await hasFacebookAccess();
  permissionPromptEl.hidden = granted;
  return granted;
}

// Must be called straight from the click: permissions.request() requires a
// user gesture, and awaiting anything first loses it.
grantAccessEl.addEventListener("click", () => {
  browser.permissions.request(FACEBOOK_ORIGINS).then(async (granted) => {
    if (!granted) return;
    permissionPromptEl.hidden = true;
    // The content script isn't retro-injected into tabs that were already
    // open, so reload the Facebook tab rather than leaving the user looking
    // at a page that still isn't being filtered.
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https?:\/\/([^/]+\.)?facebook\.com\//.test(tab.url)) {
      browser.tabs.reload(tab.id);
    }
  }).catch(() => {});
});

async function init() {
  await refreshPermissionState();

  const settings = await browser.storage.local.get(DEFAULT_SETTINGS);
  hideSponsoredEl.checked = settings.hideSponsored;
  hideSuggestedEl.checked = settings.hideSuggested;
  hideUnfollowedEl.checked = settings.hideUnfollowed;
  hideAppBannerEl.checked = settings.hideAppBanner;
  placeholderModeEl.checked = settings.placeholderMode;

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const onFacebook = tab && tab.url && /^https?:\/\/([^/]+\.)?facebook\.com\//.test(tab.url);

  if (!onFacebook) {
    notFacebookEl.hidden = false;
    countEl.textContent = "—";
    return;
  }

  const resp = await browser.runtime.sendMessage({ type: "GET_COUNT", tabId: tab.id }).catch(() => null);
  countEl.textContent = resp ? String(resp.count) : "0";

  await showDiagnostics(tab.id);
}

// Asks the content script directly rather than the background: only the content
// script knows what the page looked like. A missing reply means it isn't running
// in that tab, which is itself the answer, so leave the section hidden.
async function showDiagnostics(tabId) {
  const d = await browser.tabs
    .sendMessage(tabId, { type: "GET_DIAGNOSTICS" })
    .catch(() => null);
  if (!d) return;

  const lines = [
    `v${d.version}  ${d.layout}  viewport ${d.viewport}`,
    `body: ${d.bodyClass || "(none)"}`,
    `matched ${d.classified}  anchored ${d.anchored}  hidden ${d.hidden}`,
    `deferred ${d.deferred == null ? "?" : d.deferred}  waiting ${d.pending}  reveals ${d.reveals == null ? "?" : d.reveals}`,
    `climb: ${d.thresholds}`,
    `feed: ${d.feed || "n/a"}`,
  ];

  // The three costs that can make a page feel slow, kept apart because they
  // fail for different reasons and 1.1.35 proved a healthy scan figure says
  // nothing about the other two. The share of wall-clock time is the number
  // worth reading: milliseconds alone mean little without knowing over how long.
  const t = d.timing;
  if (t) {
    const pct = (ms) => (t.uptimeMs > 0 ? ((ms / t.uptimeMs) * 100).toFixed(1) : "?");
    lines.push(
      "",
      `over ${(t.uptimeMs / 1000).toFixed(0)}s on page:`,
      `  scan     ${t.scanMs.toFixed(0)}ms  ${pct(t.scanMs)}%  (${t.scans} scans, ${t.elements} els)`,
      `  observer ${t.observerMs.toFixed(0)}ms  ${pct(t.observerMs)}%  (${t.observerCalls} calls)`,
      `  retry    ${t.retryMs.toFixed(0)}ms  ${pct(t.retryMs)}%  (${t.retryTicks} ticks)`
    );
  }

  if (!d.samples.length) {
    lines.push("", "no posts hidden yet — nothing to sample");
  } else {
    // Each sample prints the hidden element first, then its ancestors. The
    // number that matters is h: if the chosen node is short and the one above
    // it is tall, the wrapper kept the space and the feed shows a gap.
    d.samples.forEach((s, i) => {
      lines.push("", `#${i + 1} ${s.reason}`);
      s.chain.forEach((n, depth) => {
        if (!n) return;
        lines.push(
          `  ${depth === 0 ? "->" : "  "} ${n.tag}.${n.cls || "-"}  k=${n.kids}  ${n.w}x${n.h}`
        );
      });
    });
  }

  diagnosticsBodyEl.textContent = lines.join("\n");
  diagnosticsEl.hidden = false;
}

// Selecting text in a popup on a phone is fiddly, and this output exists to be
// relayed somewhere else.
copyDiagnosticsEl.addEventListener("click", () => {
  navigator.clipboard.writeText(diagnosticsBodyEl.textContent).then(
    () => { copyDiagnosticsEl.textContent = "Copied"; },
    () => { copyDiagnosticsEl.textContent = "Copy failed"; }
  );
});

[hideSponsoredEl, hideSuggestedEl, hideUnfollowedEl, hideAppBannerEl, placeholderModeEl].forEach((el) =>
  el.addEventListener("change", save)
);

init();
