# Store release notes — 1.1.65

Covers 1.1.51 through 1.1.65. Written for the listing pages, not for
developers; the technical record is in CHANGELOG.md, and the detection
investigation is in DESKTOP-AD-LABELS.md.

---

## Who this span is actually for

**This one is mostly desktop**, unlike 1.1.39-1.1.50 which was all mobile.

- **Firefox (AMO) — worth submitting.** It fixes a startup fault that could
  leave the extension doing nothing at all on a page load, and catches several
  ad formats that were getting through. Both affect desktop and mobile users.
- **Chrome Web Store — same code, same benefit.** The startup fix and the
  detection work apply there too, so unlike the previous span this one is worth
  shipping to both.

### The honest short version

Some ads still get through, and will continue to. Facebook has begun rendering
the "Ad" label so it appears on screen while existing nowhere in the page's
text — not obfuscated, absent. Eleven detection mechanisms were tried and
measured against it; `DESKTOP-AD-LABELS.md` records each one and why it failed,
so the next attempt starts from evidence rather than from scratch.

The remaining option is a shape heuristic (advertiser domain + call-to-action +
a byline link with no path). It is deliberately not implemented: it would also
match a friend sharing a news article, and hiding a real post is worse than
missing an ad.

Do not claim in any listing that ads are fully blocked.

## Firefox (AMO) — "Release Notes" field

Fixes a bug that could stop the extension working entirely, and catches several
kinds of ad it previously missed.

- **The extension sometimes did nothing at all.** On some page loads it started
  before Facebook's page was ready, stopped with an error you would never see,
  and then sat there looking perfectly healthy — settings on, permission
  granted, nothing hidden. This is fixed, and it is the most important change
  here.
- **More ads are caught.** Facebook labels ads in several different ways, and
  some of them were slipping past: labels drawn as graphics, labels sitting
  next to an icon, labels that vanish a fraction of a second after the page
  uses them, and ad posts with no structure the extension could attach to.
- **Nothing changes on desktop for what you have chosen to hide.** The
  settings, the placeholder option and the badge all behave as before.

Known limitations: some ads are still not hidden. Facebook has begun rendering
the "Ad" label so that it appears on screen without existing in the page's text
at all, and there is currently no reliable way to detect those without also
risking hiding ordinary posts — which would be worse. Ads in the right-hand
column are detected but not hidden. English-language labels only. On phones,
hidden posts leave a blank space; collapsing it stops the feed loading.

---


## Chrome Web Store — "What's new" (short field)

Improves filtering on Facebook's mobile web layout, and adds a Diagnostics
section to the toolbar popup. Neither has any effect in Chrome on a computer,
where Facebook serves the desktop layout and behaviour is unchanged — they are
included so both browsers ship from the same source. No changes to what is
hidden on desktop, or to permissions.

---

## Chrome Web Store — permission justifications

Unchanged since 1.1.33 and re-verified against the 1.1.50 source: no
fetch/XMLHttpRequest/WebSocket/sendBeacon, no eval or new Function, no
importScripts, no remote scripts or stylesheets, and the only external URL
anywhere is the facebook.com link on the setup page. Permissions are still
`storage` plus the single host permission.

### Single purpose

Hides sponsored posts, "Suggested for you" posts, and posts from Pages and
Groups the user does not follow, from the Facebook news feed.

### storage

Stores the user's five on/off preferences (which categories to hide, whether to
hide the mobile "Open app" bar, and whether hidden posts collapse to a
placeholder or are removed) using storage.local on the user's own device.
Nothing else is stored, and nothing is synced or transmitted. Without it the
extension could not remember the user's choices between page loads.

### Host permission (*://*.facebook.com/*)

The extension works by reading the rendered Facebook feed to identify which
posts are sponsored or come from Pages the user does not follow, then hiding
those elements. That requires running a content script on facebook.com, which
is the only site requested. It reads page structure only, in the tab the user
already has open; it does not read or transmit page content, account data, or
messages.

### Remote code

No. All code is contained in the extension package. The extension does not
fetch, evaluate, or inject any code from a remote source — there are no network
requests of any kind, and no use of eval() or new Function().

### Data usage disclosures

Certify that the extension does NOT collect or transmit any of the listed
categories. It makes no network requests. The only data written anywhere is the
five preference booleans, held in local extension storage on the device.

Note on the Diagnostics section added in 1.1.43: it reports counts, element tag
names and pixel dimensions from the page the user is already viewing, rendered
in the extension's own popup. It is never stored or transmitted, and it is
discarded when the page is closed. The extension may also write a diagnostic
warning to the browser console when Facebook's markup changes in a way that
stops detection working — console only, not collected.

### Not requested, and why it matters if asked

- "tabs" is not requested. The popup reads the active tab's URL and messages
  the content script through the facebook.com host permission it already has,
  and tabs.reload() needs no permission of its own.
- "scripting" is not requested; the content script is declared statically in
  the manifest.
- No optional or broad host permissions such as <all_urls>.

---

## Chrome Web Store — listing description (if refreshing it)

Hides sponsored posts, ads, "Suggested for you" posts, and posts from Pages and
Groups you don't follow, from your Facebook feed.

Each of the five behaviours is a checkbox in the toolbar popup, and changes
apply immediately without reloading the page. The toolbar badge shows how many
posts have been hidden on the current tab.

Requires only permission to store your settings and to run on facebook.com. It
does not block network requests, collect anything, or send data anywhere.
