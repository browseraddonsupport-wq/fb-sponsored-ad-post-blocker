// See the note in content.js — Firefox provides `browser`, Chromium `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

// Keep in sync with the copy in content.js.
const DEFAULT_SETTINGS = {
  hideSponsored: true,
  hideSuggested: true,
  hideUnfollowed: true,
  hideAppBanner: true,
  hideUnlabeledAds: true,
  keepPages: "",
  adPages: "",
  showMarkers: true,
  placeholderMode: false,
};

const hideSponsoredEl = document.getElementById("hideSponsored");
const hideSuggestedEl = document.getElementById("hideSuggested");
const hideUnfollowedEl = document.getElementById("hideUnfollowed");
const hideAppBannerEl = document.getElementById("hideAppBanner");
const hideUnlabeledAdsEl = document.getElementById("hideUnlabeledAds");
const keepPagesEl = document.getElementById("keepPages");
const adPagesEl = document.getElementById("adPages");
const showMarkersEl = document.getElementById("showMarkers");
const placeholderModeEl = document.getElementById("placeholderMode");
const countEl = document.getElementById("count");
const notFacebookEl = document.getElementById("notFacebook");
const permissionPromptEl = document.getElementById("permissionPrompt");
const grantAccessEl = document.getElementById("grantAccess");
const titleEl = document.querySelector("header h1");
const diagnosticsEl = document.getElementById("diagnostics");
const diagnosticsBodyEl = document.getElementById("diagnosticsBody");
const copyDiagnosticsEl = document.getElementById("copyDiagnostics");

const FACEBOOK_ORIGINS = { origins: ["*://*.facebook.com/*"] };

// Each control writes ONLY its own key.
//
// This used to be one save() that wrote every setting from the form at once.
// The checkboxes start unticked until init() has loaded the real values, so
// anything that fired save() in that window wrote false over every hide option
// the user had. It was always possible, but 1.1.80 and 1.1.82 added text boxes -
// exactly where someone clicks and types the moment the popup opens - and a
// user came back with every option unticked, 0 posts hidden, and an ad sitting
// in the feed with its label in plain view.
//
// Writing one key per change means a control can only ever overwrite itself.
// Controls are also disabled until they hold real values, so there is nothing
// to click in the window where they do not.
const CHECKBOXES = {
  hideSponsored: hideSponsoredEl,
  hideSuggested: hideSuggestedEl,
  hideUnfollowed: hideUnfollowedEl,
  hideAppBanner: hideAppBannerEl,
  hideUnlabeledAds: hideUnlabeledAdsEl,
  showMarkers: showMarkersEl,
  placeholderMode: placeholderModeEl,
};
const TEXTAREAS = { keepPages: keepPagesEl, adPages: adPagesEl };
const ALL_CONTROLS = [...Object.values(CHECKBOXES), ...Object.values(TEXTAREAS)];

let populated = false;
ALL_CONTROLS.forEach((el) => { el.disabled = true; });

function saveKey(key, value) {
  if (!populated) return;
  browser.storage.local.set({ [key]: value });
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
  for (const [key, el] of Object.entries(CHECKBOXES)) el.checked = !!settings[key];
  for (const [key, el] of Object.entries(TEXTAREAS)) el.value = settings[key] || "";
  populated = true;
  ALL_CONTROLS.forEach((el) => { el.disabled = false; });

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const onFacebook = tab && tab.url && /^https?:\/\/([^/]+\.)?facebook\.com\//.test(tab.url);

  if (!onFacebook) {
    notFacebookEl.hidden = false;
    countEl.textContent = "—";
    return;
  }

  const resp = await browser.runtime.sendMessage({ type: "GET_COUNT", tabId: tab.id }).catch(() => null);
  countEl.textContent = resp ? String(resp.count) : "0";

  diagnosticsTabId = tab.id;
  if (await diagnosticsWanted()) await showDiagnostics(tab.id);
}

// Kept out of DEFAULT_SETTINGS deliberately: that object is mirrored in
// content.js and describes what the extension DOES. This only decides whether
// one panel is on screen, and the content script has no use for it.
const DIAGNOSTICS_KEY = "showDiagnostics";
let diagnosticsTabId = null;

async function diagnosticsWanted() {
  try {
    const stored = await browser.storage.local.get({ [DIAGNOSTICS_KEY]: false });
    return !!stored[DIAGNOSTICS_KEY];
  } catch {
    return false;
  }
}

// The panel exists for one person diagnosing one phone, not for everyone who
// installs this. It stays in the release build because Android has no devtools
// and the AMO release is what runs there - it is the only way to see what the
// extension is doing on a phone - but it should not greet ordinary users.
//
// Three taps on the title, which works with a mouse and with a thumb. The
// choice is remembered, so on a phone it is enabled once and stays.
const REVEAL_TAPS = 3;
const REVEAL_WINDOW_MS = 1500;
let taps = [];

titleEl.addEventListener("click", async () => {
  const now = Date.now();
  taps = taps.filter((t) => now - t < REVEAL_WINDOW_MS);
  taps.push(now);
  if (taps.length < REVEAL_TAPS) return;
  taps = [];

  const wanted = !(await diagnosticsWanted());
  await browser.storage.local.set({ [DIAGNOSTICS_KEY]: wanted });
  if (wanted) {
    if (diagnosticsTabId != null) await showDiagnostics(diagnosticsTabId);
  } else {
    diagnosticsEl.hidden = true;
  }
});

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
    `late-text ${d.lateText == null ? "?" : d.lateText}  rescued ${d.rescued == null ? "?" : d.rescued}  by-shape ${d.unlabeled == null ? "?" : d.unlabeled}`,
    `viewers released ${d.released == null ? "?" : d.released}  opened posts spared ${d.spared == null ? "?" : d.spared}`,
    `half-hidden posts ${d.partial == null ? "?" : d.partial}${d.partial ? "   <-- a post lost its picture but kept its name" : ""}`,
    `hidden posts remembered ${d.remembered == null ? "?" : d.remembered}  let go after leaving the page ${d.pruned == null ? "?" : d.pruned}`,
    `climb: ${d.thresholds}`,
    `feed: ${d.feed || "n/a"}`,
  ];

  // Anything other than "running" means startup never finished, and nothing
  // above it means much - the counts would all read zero for that reason alone.
  if (d.boot && d.boot !== "running") lines.splice(1, 0, `BOOT: ${d.boot}`);

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

  // The cards on screen we did NOT hide, and the small texts inside them. If an
  // ad is visible, its label is in one of these lines - whatever element it is.
  // The whole feed, not just the screen. "no unhidden ads" from a three-card
  // viewport sample was how several readings looked clean while the page was
  // full of them.
  if (d.survey) {
    lines.push(
      "",
      `feed posts hidden: ${d.survey.hidden}   still showing: ${d.survey.visible}`,
      `  of those showing: ${d.survey.dangling} have a DANGLING byline ref, ${d.survey.resolving} resolve cleanly`
    );
  }

  // The shape rule's own receipts. Everything else in this panel reports a
  // label that was read; this reports a judgement that was made, which is the
  // only part worth double-checking by eye.
  if (d.shapeHides && d.shapeHides.length) {
    lines.push("", `HIDDEN BY SHAPE (${d.unlabeled}, showing ${d.shapeHides.length}):`);
    lines.push("  a page you follow here: paste its name into the keep list");
    d.shapeHides.forEach((h) => {
      if (typeof h === "string") { lines.push(`  - ${h}`); return; }
      lines.push(`  - ${h.who}   [${h.why}]`);
      if (h.links && h.links.length) lines.push(`      ${h.links.join(" ")}`);
    });
  }

  if (d.unhidden && d.unhidden.length) {
    lines.push("", `NOT HIDDEN (showing ${d.unhidden.length} of ${d.survey ? d.survey.visible : "?"}):`);
    d.unhidden.forEach((u, i) => {
      lines.push(`  #${i + 1} ${u.size} cls=${u.cls || "-"}`);
      lines.push(`     article=${u.role} posinset=${u.posinset} pagelet=${u.pagelet}`);
      if (u.shape) lines.push(`     ${u.shape}`);
      lines.push(`     ${u.labels.join(" ") || "(no short texts)"}`);
      if (u.evidence && u.evidence.length) lines.push(`     ${u.evidence.join(" ")}`);
    });
  }

  if (!d.samples.length) {
    lines.push("", "no posts hidden yet — nothing to sample");
  } else {
    // Each sample prints the hidden element first, then its ancestors. The
    // number that matters is h: if the chosen node is short and the one above
    // it is tall, the wrapper kept the space and the feed shows a gap.
    d.samples.forEach((s, i) => {
      lines.push("", `#${i + 1} ${s.reason}${s.via ? " via " + s.via : ""}`);
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

for (const [key, el] of Object.entries(CHECKBOXES)) {
  el.addEventListener("change", () => saveKey(key, el.checked));
}
// "input" rather than "change": a textarea only fires change on blur, and a
// popup is routinely dismissed without ever blurring the field.
for (const [key, el] of Object.entries(TEXTAREAS)) {
  el.addEventListener("input", () => saveKey(key, el.value));
}

init();
