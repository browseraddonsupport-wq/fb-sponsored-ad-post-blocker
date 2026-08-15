# Store release notes — 1.1.42

Covers 1.1.39 through 1.1.42. 1.1.38 is the last version published on AMO, so
everything up to and including it is live. Written for the listing pages, not
for developers; the technical record is in CHANGELOG.md.

---

## Who this release is actually for

Worth deciding before submitting anywhere: **nothing here changes desktop
behaviour.** The whole span is mobile work plus one diagnostic. Desktop was
explicitly unchanged in 1.1.39 and re-verified against a live feed.

That means:

- **Firefox (AMO) — worth submitting.** Firefox for Android installs
  extensions from AMO, so those users go from "hides nothing at all" to
  working, and gain a setting for the "Open app" bar. Desktop Firefox users
  get nothing they will notice.
- **Chrome Web Store — arguably not worth submitting.** Chrome on Android does
  not support extensions, and desktop Chrome is served the desktop layout, so
  no Chrome user can reach the code paths these releases add. Submitting means
  a review cycle for changes none of them will observe. Notes are drafted below
  anyway, in case you would rather keep the two stores on the same version.

What is in the span, from a user's point of view:

- **1.1.39** — works on Facebook's mobile web layout at all.
- **1.1.40** — new setting: hide the mobile "Open app" bar. **This is the only
  user-visible addition**, and it takes the popup from four checkboxes to five.
- **1.1.41** — declares a Firefox for Android minimum of 120. No behaviour
  change; it stops the extension being offered to Android versions where the
  permission request it relies on does not exist.
- **1.1.42** — logs a warning when Facebook changes its markup in a way that
  breaks detection. Invisible unless you open the browser console.

---

## Firefox (AMO) — "Release Notes" field

Now works on Facebook's mobile site, and adds a setting for the "Open app" bar.

- If you use this extension in Firefox for Android, it should now hide
  sponsored posts, ads, and posts from Pages you don't follow on your phone,
  the same as it does on a computer. Previously it installed and looked fine
  there but never hid anything.
- New setting: **Hide the mobile "Open app" bar** — the bar Facebook pins to
  the bottom of the screen on phones, pushing you into its app. On by default.
  It has no effect on a computer, where the bar doesn't exist.
- Nothing else changes on desktop. If you only use Firefox on a computer, this
  update makes no visible difference.

Facebook serves phones a completely different version of the site — different
enough that the extension had no way to tell where one post ended and the next
began. That is what these releases add.

Known limitation: ads in the right-hand column on desktop are detected but not
yet hidden. English-language labels only.

---

## Chrome Web Store — "What's new" (short field)

Adds support for Facebook's mobile web layout, and a setting to hide the mobile
"Open app" bar. Both have no effect in Chrome on a computer, where Facebook
serves the desktop layout and behaviour is unchanged — they are included so
both browsers ship from the same source. No changes to what is hidden on
desktop, or to permissions.

---

## Chrome Web Store — permission justifications

Unchanged since 1.1.33 and re-verified against the 1.1.42 source: no
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

Note for 1.1.42: the extension may write a diagnostic warning to the browser
console when Facebook's markup changes in a way that stops detection working.
It is written to the console only — not collected, stored, or transmitted.

### Not requested, and why it matters if asked

- "tabs" is not requested. The popup reads the active tab's URL through the
  facebook.com host permission it already has, and tabs.reload() needs no
  permission of its own.
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
