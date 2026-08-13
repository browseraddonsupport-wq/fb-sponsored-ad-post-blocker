// See the note in content.js — Firefox provides `browser`, Chromium `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

// Keep in sync with the copy in content.js.
const DEFAULT_SETTINGS = {
  hideSponsored: true,
  hideSuggested: true,
  hideUnfollowed: true,
  placeholderMode: false,
};

const hideSponsoredEl = document.getElementById("hideSponsored");
const hideSuggestedEl = document.getElementById("hideSuggested");
const hideUnfollowedEl = document.getElementById("hideUnfollowed");
const placeholderModeEl = document.getElementById("placeholderMode");
const countEl = document.getElementById("count");
const notFacebookEl = document.getElementById("notFacebook");
const permissionPromptEl = document.getElementById("permissionPrompt");
const grantAccessEl = document.getElementById("grantAccess");

const FACEBOOK_ORIGINS = { origins: ["*://*.facebook.com/*"] };

function save() {
  browser.storage.local.set({
    hideSponsored: hideSponsoredEl.checked,
    hideSuggested: hideSuggestedEl.checked,
    hideUnfollowed: hideUnfollowedEl.checked,
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
}

[hideSponsoredEl, hideSuggestedEl, hideUnfollowedEl, placeholderModeEl].forEach((el) =>
  el.addEventListener("change", save)
);

init();
