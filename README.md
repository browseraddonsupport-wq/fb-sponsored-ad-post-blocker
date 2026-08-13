# F.B. Sponsored/Ad Post Blocker

A small browser extension that hides "Sponsored" (and optionally "Suggested
for you", and posts from Pages/Groups you don't follow) from your Facebook
feed and the right-hand sidebar.

Runs on Firefox/Waterfox and on Chromium browsers (Chrome, Edge, Brave,
Opera) from a single source tree — see "Building" below. Note that Facebook
does not serve both the same markup: as of 1.1.35 Chromium gets sponsored
labels drawn as SVG sprites while Firefox still gets scrambled text, and the
extension handles both. Test a detection change on both before believing it.

## Install

- **Firefox / Waterfox** — install from addons.mozilla.org (search for
  "F.B. Sponsored/Ad Post Blocker").
- **Chrome / Edge / Brave / Opera** — install from the Chrome Web Store.

On Firefox you will be asked to allow the extension to run on facebook.com.
It cannot hide anything until you do: Firefox does not grant that access at
install, and without it the extension is inert. A setup page opens on first
install to ask, and the toolbar popup will keep offering if you dismiss it.

The instructions further down for loading an unpacked or temporary copy are
for working on the extension. A temporary add-on is removed when Firefox
restarts and never updates itself, so it is the wrong way to install this for
normal use.

## How it works

Facebook's DOM class names are obfuscated and change constantly, but a
couple of things have stayed stable enough to key off of:

- The visible "Sponsored" / "Ad" / "Suggested for you" text label on feed
  posts, or a bare "Follow"/"Join" button next to the poster's name
  (Facebook's own signal for a Page/Group you don't follow yet — distinct
  from "Following"/"Joined", which only show once you already do).
  Facebook renders this text as one `<span>` per character, scrambled two
  ways at once: every character carries an invisible Unicode joiner/
  combining mark so plain `textContent` never spells the label even once
  concatenated (`INVISIBLE_CHARS_RE` strips those), and the real characters
  are interspersed with decoy character-spans and placed in randomized DOM
  order, repositioned to the correct visual spot purely via CSS flexbox
  `order`. `collectOrderedLeaves()` walks the label once, sorting by computed
  `order` and dropping spans that don't render.

  Decoys are distinguishable by class-list length, but **the direction of
  that signal is not stable**. It has been observed both ways round: decoys
  once carried the longer list, and in the markup this was last checked
  against the *real* characters do (~22 classes including a long shared
  randomized suffix, versus ~7 on the decoys). Betting on either direction
  breaks silently whenever Facebook flips it — detection simply stops. So
  `labelVariants()` assembles every plausible partition (all spans,
  high-class-count only, low-class-count only) and matches against any of
  them. The targets are a handful of short known strings, so a decoy
  partition matching one by accident isn't a realistic risk.
- The `aria-label` on an ad's "..." menu button, which reads
  `"Open menu for <name> sponsored content"`. Note this covers **sidebar ads
  only** — feed post menus read `"Actions for this post by <name>"`, with no
  mention of sponsorship, so `SPONSORED_ARIA_RE` never fires on the feed.
- **A sprite reference.** This is how feed ads label themselves now, and it is
  the path that matters most. Facebook draws the byline as vector art rather
  than text: `<svg><use xlink:href="#SvgT31"></svg>`, pointing at a
  `<symbol>` defined elsewhere in the document. The post itself contains no
  "Sponsored" string anywhere — searching its whole `textContent` finds
  nothing — so no amount of text decoding can catch it.

  The symbol *does* contain real text, because a screen reader has to announce
  it. `#SvgT31` reads "Sponsored"; an organic post's byline symbol reads
  "17 hours ago". So `classifyLabel` follows the reference and matches the
  symbol's text against the same string sets as every other path — organic
  posts resolve to a timestamp and match nothing. `use` is in
  `LABEL_SELECTOR` for this reason, and `resolveViaReferrer` follows
  `use[*|href="#id"]` as well as `aria-labelledby`, since a sprite points at
  its target through `xlink:href`.

  Do **not** try to detect this by "the byline holds a glyph instead of text".
  Facebook renders the timestamp as a sprite on every post too, so that fires
  on the entire feed. The sprite's *text* discriminates; its existence does
  not. This was tried and rejected.

**Do not use `data-ad-rendering-role`.** Facebook tags the parts of a post
with it (`profile_name`, `story_message`, `like_button`, …) and it is present
throughout sponsored posts, which makes it look like an ideal ad marker. It
is also present on ordinary posts from pages you follow — both render through
the same story template — so keying off it classifies the whole feed as
sponsored and hides everything. This was tried and reverted.

`content.js` watches the page for either signal, then finds the post that
label belongs to. This version of Facebook doesn't use `role="article"` at
all; instead each feed post carries `aria-posinset` (the standard ARIA
"position within a list" attribute), so that's the primary anchor. That whole
post then gets hidden, either fully or by collapsing it into a small
"Sponsored post hidden [Show]" placeholder bar, depending on your settings.

A "Follow"/"Join" button only counts when it belongs to the post's **own**
author. Posts frequently embed a shared post, and the embedded copy carries
its own author header with its own Follow button — so a group post you're a
member of, quoting someone you don't follow, would otherwise be hidden
entirely on the strength of the quoted author's button.
`isAuthorLevelLabel()` requires the button to sit in the container's first
heading, which is the post's own author header; anything quoted inside comes
later in the DOM. This errs toward leaving posts visible, which is the right
way to be wrong — a missed unfollowed post is an annoyance, a wrongly hidden
group post is content you never learn you lost.

A `MutationObserver` keeps this running as you scroll and Facebook streams
in new posts. Scans are coalesced into one `requestAnimationFrame` callback
rather than run per mutation: bursts of feed activity fire many separate
observer callbacks in quick succession, and one `querySelectorAll` pass over
the union of changed nodes is much cheaper than one pass per callback. (One
consequence worth knowing: `requestAnimationFrame` doesn't fire while a tab
is hidden or occluded, so posts streaming in while you're on another tab are
scanned when you return rather than as they arrive.)

Scan cost is dominated by how many elements get their text read, so
`classifyLabel` only reads `.textContent` on two shapes: a **leaf**, where
it's just that element's own text, and a **character-split label**, which
`isCharacterSplit()` recognises by structure alone (a row of leaf spans each
holding one visible character) without resolving any style. Wrappers are
skipped entirely — `scanRoot` visits every span and anchor anyway, so the
leaf actually holding the text is visited in its own right, and reading a
wrapper's text re-walks the same subtree once per nesting level. The
`getComputedStyle`-per-child walk in `labelVariants()` runs only behind
`isCharacterSplit`; gating it any looser resolves style on thousands of
ordinary wrappers and blocks the main thread hard enough to stop Facebook
rendering.

Facebook also streams some ad content in via a hidden React Suspense staging
node that gets moved into its real position a moment later, so a label can
match before its container exists — a bounded retry loop (`pendingLabels`,
`retryPendingLabels`, every 50ms for up to 8s) rechecks instead of giving up.
Unfollowed labels are excluded from it: a Follow button and its author header
always render together, so retrying can't change the answer.

Facebook also parks accessibility-label targets (the `<span id="_r_…_">` an
ad's `aria-labelledby` points at) in a portal a few levels below `<body>`.
These contain the literal word "Sponsored", so they classify — but they sit
outside any post and can never resolve to one, and fresh ones appear
constantly. `isImplausiblyShallow()` drops them before they reach the retry
queue or the logs.

Set `DEBUG = true` at the top of `content.js` to log unresolved matches and a
rolling scan-cost summary. Two cautions if you do: unresolved logs are capped
(`UNRESOLVED_LOG_LIMIT`) because the volume, not the content, is what hurts —
each log holds a live DOM reference and devtools retains and renders every
one. And that cost lands in the browser, *outside* the extension's own
`performance.now()` accounting, so the perf line can look healthy while the
page is unusable. Don't treat it as sufficient evidence on its own.

## Files

- `manifest.json` — extension manifest (Manifest V3, Firefox form; `build.ps1`
  transforms it for Chromium)
- `content.js` / `content.css` — detection + hiding logic, injected into facebook.com
- `background.js` — tracks a per-tab "posts hidden" count for the toolbar badge/popup
- `popup/` — toolbar popup with on/off toggles and the hidden-post count
- `icons/icon.svg` — toolbar/extension icon (Firefox)
- `icons/icon-{16,32,48,128}.png` — the same icon rasterised; Chromium does not
  support SVG icons
- `build.ps1` — produces both packages
- `CHANGELOG.md` — what changed and, more usefully, which approaches were tried
  and rejected
- `store-release-notes.md` — listing copy for AMO and the Chrome Web Store
  (not shipped in the package)

## Building

```
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
```

Writes `fb-sponsored-ad-post-blocker.zip` (Firefox) and
`fb-sponsored-ad-post-blocker-chrome.zip` (Chromium), plus unpacked copies
under `dist/`. Add `-Diagnostic` for `-debug` packages with `DEBUG` enabled;
the source stays at `false` either way.

Build artifacts are gitignored — every zip is reproducible from source, and
they are rewritten on each run.

## Development: load it in Firefox (temporary)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` in this folder

The extension reloads automatically until you restart Firefox; re-run the
steps above after a restart, or package it (see below) for a persistent
install.

Firefox MV3 treats host access as opt-in, and declaring `content_scripts`
alone does not request it — without the `host_permissions` entry in the
manifest the extension defaults to "run only when you click it", and the
content script is never injected on load. That failure is easy to misread:
the extension looks installed and enabled and the badge works, because the
background script runs regardless. If nothing is being hidden until you click
the toolbar icon, check site access first (`about:addons` → Permissions).

## Development: load it in Chrome/Edge/Brave (unpacked)

1. Run `build.ps1`
2. Open `chrome://extensions`, enable **Developer mode**
3. **Load unpacked** → select `dist/chrome`

Note `dist/chrome` holds whichever variant you built last, so run `build.ps1`
without `-Diagnostic` if you want the release behaviour (no logging).

## Settings

Click the toolbar icon to toggle:

- **Hide "Sponsored" posts** — on by default
- **Hide "Suggested for you" posts** — on by default. These aren't ads, just
  algorithmic recommendations, so turn it off if you want them back.
- **Hide posts from Pages/Groups you don't follow** — on by default. This is
  broader than the other two: it hides organic, non-ad posts, so it's the
  first one to turn off if the feed feels too empty.
- **Show a "Show" placeholder instead of removing completely** — off by
  default, so hidden posts disappear entirely. Turn it on to leave a small
  bar in place of each hidden post: the feed doesn't jump around, and you can
  reveal a specific post if you want to see it anyway. Useful for checking
  what's being caught.

Changes apply live, no page reload required.

## Known limitations

- The text-based match only covers the English-language labels ("Sponsored",
  "Ad", "Suggested for you", "Follow", "Join"). To support another locale,
  add the translated strings to `SPONSORED_TEXTS` / `SUGGESTED_TEXTS` /
  `UNFOLLOWED_TEXTS` in `content.js`. The `aria-label`-based match
  ("… sponsored content") may also be locale-specific; check
  `SPONSORED_ARIA_RE` if ads slip through on a non-English account.
- Relies on Facebook's DOM structure and accessibility labels, which have
  been stable for a while but aren't guaranteed — if Facebook changes them,
  detection may stop working until the heuristics are updated. Turn on
  `DEBUG` in `content.js` to see what's (not) matching.
- **Right-column sidebar ads are detected but not hidden.** Their menu
  buttons match `SPONSORED_ARIA_RE` ("Open menu for <advertiser> sponsored
  content"), but `findPostContainer` can't anchor them: they have no
  `aria-posinset`, and the sidebar column no longer carries the
  `role="complementary"` landmark the old fallback relied on — every ancestor
  up to `<body>` is an unlabelled `<div>`. Climbing blindly is how a stray
  match takes out a whole region, so nothing is hidden rather than risk it. A
  bounded climb (stop as soon as the candidate stops being card-sized) would
  work, with the size limit as the safety property.
- Unfollowed detection assumes the post's own author header is the **first**
  heading in the post. If Facebook ships a layout where it isn't, those posts
  stop being detected — failing quiet rather than hiding wrongly.
- Some ad units (particularly the video/link-preview "Ad"-badge template)
  can briefly flash visible before the retry loop catches and hides them,
  rather than being hidden instantly.
- Doesn't yet cover ads in Stories, Marketplace, or Watch/Reels — those use
  different markup entirely.
- If you also run F.B. Purity and/or uBlock Origin's Facebook filters, they
  may hide some of the same content independently, which can make it hard
  to tell which extension caught what while testing. Worth disabling the
  others temporarily if you need to verify this extension's own detection.
- The "posts hidden" counter is per-tab and resets on page load; it doesn't
  persist across Facebook's internal SPA navigation resets.

## A note on debugging this

Facebook's markup changes, and several assumptions baked into earlier
versions of this extension turned out to be stale or simply wrong. If posts
stop being hidden — or worse, everything gets hidden — verify before
theorising:

1. **Check which build is actually running.** With `DEBUG = true` the console
   opens with `[fbsb] content script loaded, build <version>`. A temporary
   add-on loaded from `manifest.json` runs the folder in place; a copy
   installed from the `.zip`/`.xpi` does not, and if both are installed both
   inject and fight over the same DOM. Confirm the version before drawing any
   conclusion from anything else.
2. **Check site access.** The extension can be enabled while still blocked
   from running on facebook.com (`about:addons` → Permissions). The
   background script runs regardless, so a working badge proves nothing about
   the content script.
3. **Measure before optimising.** The `DEBUG` perf line reports real scan
   cost. It has been in the 10–30ms per 2s range even on a heavy feed — if
   you see numbers like that, scanning is not your problem, and a page that
   won't render is a correctness bug (something too large being hidden), not
   a slow one.
4. **Test new signals against an organic post**, not just an ad. Anything
   that matches every post looks exactly like "the feed won't load". Two
   signals have been rejected this way (`data-ad-rendering-role`, and "the
   byline is a glyph") — both looked convincing on an ad and fired on the
   entire feed.
5. **Separate "we looked and didn't match" from "we never looked."** These
   need opposite fixes and are indistinguishable from the outside. Diagnostic
   builds mark every examined element with `data-fbsb-seen`, so
   `post.querySelectorAll('[data-fbsb-seen]').length` against the candidate
   count answers it directly. Several rounds of the 1.1.32 cycle went into
   fixing the scanning layer when scanning was already reaching the element
   and classification was returning nothing.
6. **Check what the label actually is before assuming it's text.** As of
   1.1.32 the feed byline is an SVG sprite; the word "Sponsored" appears
   nowhere in the post. If `post.textContent` doesn't contain the label you're
   matching, no text fix will ever work — follow the `<use>` reference
   instead.
