# Store release notes — 1.1.50

Covers 1.1.39 through 1.1.50. 1.1.38 was the last version published before this
span began. AMO is current at 1.1.50; the Chrome Web Store is behind, with a
submission awaiting review. Written for the listing pages, not for developers;
the technical record is in CHANGELOG.md.

---

## Who this span is actually for

**Nothing here changes desktop behaviour.** All of it is mobile work plus
diagnostics. Desktop was explicitly unchanged in 1.1.39 and re-verified against
a live feed, and every mobile code path since is gated on the mobile layout.

- **Firefox (AMO) — the whole point.** Firefox for Android installs extensions
  from AMO, and those users go from "hides nothing at all" to a working
  filtered feed. Desktop Firefox users get nothing they will notice.
- **Chrome Web Store — nothing observable for its users.** Chrome on Android
  does not support extensions, and desktop Chrome is served the desktop layout,
  so no Chrome user can reach the code paths this span adds. Worth submitting
  only to keep the two stores on the same version. Notes are drafted below for
  when the pending review clears.

### The honest short version

Mobile support was announced in 1.1.39 and **did not actually work until
1.1.50.** Four releases claimed it, because each was validated against a
desktop browser pretending to be a phone — which serves the same page but does
not behave the same way. It was fixed only after testing on a real device.

Worth remembering before writing "now works on mobile" anywhere again.

---

## Firefox (AMO) — "Release Notes" field

Filtering now works properly on Facebook's mobile site.

- **On a phone, posts are now actually hidden as you scroll.** Earlier versions
  installed and looked fine on Android but filtered little or nothing beyond
  the first screenful. Sponsored posts, ads, "Suggested for you" and posts from
  Pages you don't follow are now hidden throughout the feed.
- **Hidden posts leave a blank space on phones.** This is deliberate. Facebook
  loads its mobile feed in batches, and it stops loading more if the page
  shrinks underneath it — so a hidden post keeps its space and simply shows
  nothing. Removing that space stops your feed loading, which is worse.
- **Hide the mobile "Open app" bar** — a setting for the bar Facebook pins to
  the bottom of the screen pushing you into its app. On by default, and it has
  no effect on a computer.
- **A Diagnostics section in the popup**, collapsed by default. It reports what
  the extension is seeing and doing on the current page. Only useful if
  something looks wrong — phones have no developer console, and this is the
  only way to see what happened.
- **Nothing changes on desktop.** If you only use Firefox on a computer, this
  update makes no visible difference.

Known limitations: ads in the right-hand column on desktop are detected but not
yet hidden. English-language labels only. On phones, hidden posts leave blank
space, as above.

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
