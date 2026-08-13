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

## Chrome Web Store — listing description (if refreshing it)

Hides sponsored posts, ads, "Suggested for you" posts, and posts from Pages
and Groups you don't follow, from your Facebook feed.

Each of the four behaviours is a checkbox in the toolbar popup, and changes
apply immediately without reloading the page. The toolbar badge shows how many
posts have been hidden on the current tab.

Requires only permission to store your settings and to run on facebook.com. It
does not block network requests, collect anything, or send data anywhere.
