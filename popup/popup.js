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

function save() {
  browser.storage.local.set({
    hideSponsored: hideSponsoredEl.checked,
    hideSuggested: hideSuggestedEl.checked,
    hideUnfollowed: hideUnfollowedEl.checked,
    placeholderMode: placeholderModeEl.checked,
  });
}

async function init() {
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
