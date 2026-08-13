// See the note in content.js — Firefox provides `browser`, Chromium `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

const FACEBOOK_ORIGINS = { origins: ["*://*.facebook.com/*"] };

const needsAccessEl = document.getElementById("needsAccess");
const allSetEl = document.getElementById("allSet");
const grantAccessEl = document.getElementById("grantAccess");

// Fail open, as the popup does: if the check throws, show the "all set" state
// rather than demanding a permission the extension may already hold. A user
// who is genuinely missing access still has the popup prompt and about:addons.
async function hasFacebookAccess() {
  try {
    return await browser.permissions.contains(FACEBOOK_ORIGINS);
  } catch {
    return true;
  }
}

function show(granted) {
  needsAccessEl.hidden = granted;
  allSetEl.hidden = !granted;
}

// Called straight from the click — permissions.request() needs a user
// gesture, and awaiting anything beforehand discards it.
grantAccessEl.addEventListener("click", () => {
  browser.permissions
    .request(FACEBOOK_ORIGINS)
    .then((granted) => {
      if (granted) show(true);
    })
    .catch(() => {});
});

hasFacebookAccess().then(show);
