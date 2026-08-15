# Store release notes — 1.1.39

Covers 1.1.39 only. 1.1.38 is already published on AMO, so everything before
this is live. Written for the listing pages, not for developers; the technical
record is in CHANGELOG.md.

---

## Who this release is actually for

Worth deciding before submitting anywhere: **1.1.39 changes nothing on
desktop.** It makes the extension work on Facebook's mobile web layout, which
is a separate app served on the strength of the browser's user agent. Desktop
behaviour is explicitly unchanged and was re-verified against a live feed.

That means:

- **Firefox (AMO) — worth submitting.** Firefox for Android installs
  extensions from AMO, so those users go from "hides nothing at all" to
  working. Desktop Firefox users get nothing new.
- **Chrome Web Store — arguably not worth submitting.** Chrome on Android
  does not support extensions, and desktop Chrome is served the desktop
  layout, so no Chrome user can reach the code path this release fixes.
  Submitting means a review cycle for a change none of them will observe.
  Notes are drafted below anyway, in case you would rather keep the two
  stores on the same version.

---

## Firefox (AMO) — "Release Notes" field

Now works on Facebook's mobile site.

- If you use this extension in Firefox for Android, it should now hide
  sponsored posts, ads, and posts from Pages you don't follow on your phone,
  the same as it does on a computer. Previously it installed and looked fine
  there but never hid anything.
- Nothing changes on desktop. If you only use Firefox on a computer, this
  update makes no difference to what you see.

Facebook serves phones a completely different version of the site — different
enough that the extension had no way to tell where one post ended and the next
began. That is what this release adds.

Known limitation: ads in the right-hand column on desktop are detected but not
yet hidden. English-language labels only.

---

## Chrome Web Store — "What's new" (short field)

Adds support for Facebook's mobile web layout. This has no effect in Chrome on
a computer, where Facebook serves the desktop layout and behaviour is
unchanged — it is included so both browsers ship from the same source. No
changes to what is hidden, to your settings, or to permissions.

---

## Chrome Web Store — permission justifications

Unchanged from 1.1.33 and re-verified against the 1.1.39 source: no
fetch/XMLHttpRequest/WebSocket/sendBeacon, no eval or new Function, no
importScripts, no remote scripts or stylesheets, and the only external URL
anywhere is the facebook.com link on the setup page. Permissions are still
`storage` plus the single host permission.

### Single purpose

Hides sponsored posts, "Suggested for you" posts, and posts from Pages and
Groups the user does not follow, from the Facebook news feed.

### storage

Stores the user's four on/off preferences (which categories to hide, and
whether hidden posts collapse to a placeholder or are removed) using
storage.local on the user's own device. Nothing else is stored, and nothing is
synced or transmitted. Without it the extension could not remember the user's
choices between page loads.

### Host permission (*://*.facebook.com/*)

The extension works by reading the rendered Facebook feed to identify which
posts are sponsored or come from Pages the user does not follow, then hiding
those elements. That requires running a content script on facebook.com, which
is the only site requested. It reads page structure only, in the tab the user
already has open; it does not read or transmit page content, account data, or
messages.

### Remote code

No. All code is contained in the extension package. The extension does not
fetch, evaluate, or inject any code from a remote source — there are no
network requests of any kind, and no use of eval() or new Function().

### Data usage disclosures

Certify that the extension does NOT collect or transmit any of the listed
categories. It makes no network requests. The only data written anywhere is
the four preference booleans, held in local extension storage on the device.

### Not requested, and why it matters if asked

- "tabs" is not requested. The popup reads the active tab's URL through the
  facebook.com host permission it already has, and tabs.reload() needs no
  permission of its own.
- "scripting" is not requested; the content script is declared statically in
  the manifest.
- No optional or broad host permissions such as <all_urls>.

---

## Chrome Web Store — listing description (if refreshing it)

Hides sponsored posts, ads, "Suggested for you" posts, and posts from Pages
and Groups you don't follow, from your Facebook feed.

Each of the four behaviours is a checkbox in the toolbar popup, and changes
apply immediately without reloading the page. The toolbar badge shows how many
posts have been hidden on the current tab.

Requires only permission to store your settings and to run on facebook.com. It
does not block network requests, collect anything, or send data anywhere.
