# Store release notes — 1.1.33

Covers everything since 1.1.21, the last published version. Written for the
listing pages, not for developers; the technical record is in CHANGELOG.md.

---

## Firefox (AMO) — "Release Notes" field

NOTE: the "Sponsored"-as-a-graphic change has NOT been observed in Firefox —
checked in Waterfox 140 against a live feed, which had no sprite labels at
all. That fix matters for Chromium browsers, where it was breaking detection
outright. It is included here so Firefox keeps working if the change reaches
it later, but it must not be the headline: Firefox ad detection was fixed in
1.1.21, which is already published, so leading with "sponsored posts are
hidden again" would describe a bug Firefox users never had.

Mostly settings and speed in this release.

- "Suggested for you" and "Posts from Pages/Groups you don't follow" are now
  ON by default, alongside "Sponsored". All three remain optional — if your
  feed looks too sparse, "Pages/Groups you don't follow" is the broadest and
  the first one to turn off.
- Hidden posts are now removed completely by default. If you would rather see
  a small "Post hidden — Show" bar in their place, turn on the placeholder
  option in the toolbar popup.
- Posts are hidden faster, especially in the first moments after a page load.
- Added handling for a new way Facebook labels sponsored posts — drawing the
  label as a graphic rather than text. This is already live in Chrome and
  other Chromium browsers; including it now means detection keeps working if
  it reaches Firefox.
- Now works in Chrome, Edge, Brave and Opera as well as Firefox.

Known limitation: ads in the right-hand column are detected but not yet
hidden. English-language labels only.

If you have turned one of the three options off, posts of that type may flash
briefly on screen during page load before being hidden again.

---

## Chrome Web Store — "What's new" (short field)

Sponsored posts are hidden again. Facebook now draws the "Sponsored" label as
a graphic rather than text, so the old detection had nothing to match — this
version follows the label's underlying reference instead. Posts from people
and Pages you follow are unaffected. Also: all three hide options are now on
by default, hidden posts are removed completely rather than leaving a
placeholder, and posts are hidden faster on page load.

---

## Chrome Web Store — permission justifications

Paste each into the matching field on the "Privacy practices" tab. Verified
against the shipped source: no fetch/XMLHttpRequest/WebSocket, no eval or
new Function, no importScripts, and the only external URL anywhere is the
facebook.com link on the setup page.

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
