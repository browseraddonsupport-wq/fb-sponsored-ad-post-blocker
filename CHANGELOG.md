# Changelog

## 1.1.38

### Changed

- **The `DEBUG` perf line now reports MutationObserver cost separately.** It
  previously timed `scanRoot` only, so everything the observer callback does —
  including `cacheLabelTargets` walking every subtree Facebook inserts during
  its initial render — was invisible. That blind spot had already hidden one
  regression: the retry-loop freeze fixed in 1.1.35 reported a healthy
  `1.0ms across 274 scans` while the page was unusable.

  Measured on a real feed, the observer costs 2–16ms per 2s window and falls
  after load rather than spiking during it, which ruled it out as the cause of
  a slow first paint that had been attributed to it.
- README leads with an **Install** section pointing at the store listings.
  Both sideload sections are now labelled `Development:` — a temporary add-on
  disappears on restart and never updates, so it is the wrong way to install
  this for normal use.

No behaviour change in release builds: the instrumentation is `DEBUG`-only.

## 1.1.37

### Added

- **A setup page opens once, on first install.** The popup prompt added in
  1.1.36 only helps someone who opens the popup, and a new Firefox user has no
  reason to: the extension appears installed and simply does nothing. The page
  explains that facebook.com access is still needed and requests it directly.

  It reads the current permission state rather than assuming: where access is
  already granted — always the case on Chromium — it shows a short "you're all
  set" confirmation instead of asking for anything. Gated on
  `reason === "install"` so upgrades don't reopen it, and the `tabs.create`
  call is wrapped, because failing to open a setup page must not take the
  background script down with it.
- `build.ps1` copies `onboarding/`. The payload is an explicit file list, so a
  new directory ships only when added here — worth remembering when adding
  another.

## 1.1.36

### Added

- **The popup now asks for facebook.com access when it doesn't have it.**
  Firefox MV3 does not grant host permissions at install, so a fresh install
  from AMO hides nothing and looks broken — the toolbar badge and popup work,
  because only the content script is missing. The popup now checks for access
  and, if absent, shows a prompt with an "Allow on facebook.com" button that
  requests it directly. Granting also reloads the open Facebook tab, since the
  content script is not retro-injected into tabs that were already open.

  Chromium grants host permissions at install, so the check passes there and
  the prompt never appears. The permission check fails open: if it throws, the
  popup renders normally rather than nagging for access it may already have.

## 1.1.35

### Fixed

- **The feed stopped loading.** 1.1.30 queued any element carrying an
  `aria-labelledby` whose target didn't resolve, on the theory that ad labels
  arrive late; 1.1.33 then tightened the retry loop to one frame. Facebook has
  a great many elements with dangling label references — a 300-post feed
  carries roughly 1,800 — so the queue flooded and every entry was
  re-examined every 16ms for the full 8s window.

  The theory was wrong regardless: late-arriving labels were never what hid
  feed ads. Following the sprite reference (1.1.32) was. That queueing is
  removed, and the retry loop is back to 50ms.
- The retry queue is now capped (`MAX_PENDING_LABELS`). It exists for ads
  staged in a hidden node and reparented a moment later, which is a handful of
  entries at most; a future change that queues too eagerly should degrade
  detection, not the page.

### Note for anyone building on this

This regression did not show up in the `DEBUG` perf line, which reported a
healthy `1.0ms across 274 scans` while the page was unusable — that line times
`scanRoot` only, and the cost was in the retry loop. A timer that re-examines a
growing set of nodes is invisible to it. If the page is struggling and the perf
line looks fine, profile the whole page rather than trusting the number.

## 1.1.34

### Fixed

- **Nothing was hidden until the toolbar icon was clicked.** The manifest
  declared `content_scripts.matches` but no `host_permissions`. Firefox MV3
  treats host access as opt-in, so the extension defaulted to "run only when
  you click it": the content script wasn't injected on page load at all, and
  clicking the toolbar button was what granted access for that visit. Adding
  the explicit `host_permissions` entry lets the browser ask for facebook.com
  up front instead.

  Worth knowing when diagnosing this: an extension in this state looks fully
  installed and enabled, and the background script runs normally, so the
  badge and popup behave — only the content script is missing. The symptom is
  indistinguishable from broken detection unless you check site access.

## 1.1.33

### Performance

- **Hiding no longer waits for settings to load.** The content script read
  settings before it was allowed to hide anything, so every matching post in
  the first screenful stayed visible until `storage.local.get` resolved —
  precisely the moment the most ads are on screen. Scanning now starts
  immediately under defaults, and `main()` reverses anything the user has
  turned off as soon as it knows. A wrong hide costs a few milliseconds of
  flicker and is undone; waiting cost every ad being visible on every load.

  This only ever affected text-labelled posts ("Follow"/"Join", "Suggested for
  you"). Sprite-labelled feed ads were already resolved synchronously at
  startup through the label cache, which bypasses the scan path entirely.
- **The retry interval is one frame instead of 50ms.** That interval is the
  window in which an ad staged in a hidden node is on screen after being
  reparented, so it is a visible-flash budget rather than a polling
  preference. The loop only runs while something is pending.
- **Removed a redundant full-document scan from every page load.** Once the
  startup scan and the observer are both running, the post-settings sweep
  changes nothing unless placeholder mode differs from the default — turning a
  reason off is handled by restoring, not re-scanning.

## 1.1.32

### Fixed

- **Sponsored posts in the feed were not hidden at all in Chrome.** Facebook no
  longer renders the "Sponsored" byline as text. It draws it as vector art: an
  `<svg><use xlink:href="#SvgT31">` pointing at a sprite `<symbol>` defined
  elsewhere in the document. The post contains no such string anywhere — its
  entire `textContent` is free of it — so every text-matching path was
  structurally incapable of finding it, no matter how the scrambled-label
  decoding was tuned.

  The symbol itself does hold real text, because a screen reader has to be able
  to announce it. `#SvgT31` reads "Sponsored"; an organic post's byline symbol
  reads "17 hours ago". Detection now follows the reference and matches the
  symbol's text against the same string sets used everywhere else, so organic
  posts continue to match nothing.
- **Labels created during startup were invisible to us.** The `MutationObserver`
  was attached only after `await browser.storage.local.get(...)` resolved, and
  Facebook renders the first posts during exactly that window — so ephemeral
  labels on early posts (`aria-posinset` 1-3) were created and destroyed with no
  observation. Observation now begins at document start; hiding still waits for
  settings, so nothing is removed under defaults the user has turned off.
- **A label pointing at a target that does not exist yet is now retried.**
  Previously an element that classified as nothing was never revisited, so a
  post whose label span arrived milliseconds later stayed visible forever. A
  dangling `aria-labelledby` reference now enters the existing bounded recheck.
  Relatedly, that recheck used to drop an entry the first time it still failed
  to classify — which is the state every queued entry is in by definition.
- `resolveViaReferrer` follows `use[*|href="#id"]` as well as
  `aria-labelledby`. A sprite-drawn label references its target through
  `xlink:href`, so forward resolution previously reported "not found" for
  labels sitting inside perfectly ordinary posts.

### Changed

- Diagnostic builds mark every element they examine with `data-fbsb-seen`, and
  log an ad's label target the moment it is cached. Without these, "we looked
  and didn't match" and "we never looked" are indistinguishable from outside,
  and they need opposite fixes — several rounds of this cycle were spent fixing
  the wrong layer for want of that distinction.

### Note for anyone building on this

Two signals were tried during this cycle and **rejected** by testing them
against organic posts before shipping:

- **A byline containing an SVG glyph instead of text.** Plausible — the ad's
  "Sponsored" is a sprite. But Facebook renders the *timestamp* as a sprite
  too, on every post: this fires on 100% of rendered posts, ads and organic
  alike.
- **`data-ad-rendering-role`** (see 1.1.21 below), for the same reason.

Both would have presented as "the entire feed disappeared", not as "ads leak
through". Test any new signal against a post from a page you follow before
trusting it — a signal that matches everything looks exactly like a signal that
works, right up until the feed is empty.

## 1.1.22

### Added

- **Chromium support.** The same source now builds for Chrome, Edge, Brave and
  Opera as well as Firefox. `build.ps1` emits both packages: the Chromium
  manifest swaps the Firefox event page for a service worker, drops
  `browser_specific_settings`, and uses PNG icons (Chromium doesn't support
  SVG icons). The scripts themselves are shared — they alias the API namespace
  (`globalThis.browser ?? globalThis.chrome`) and use the `sendResponse` form
  of `onMessage`, which both browsers accept. Firefox alone permits returning
  a promise from a message listener, and getting that wrong fails silently:
  the popup's count request simply never resolves.
- `build.ps1 -Diagnostic` produces a `-debug` package with `DEBUG` enabled,
  leaving the source at `false`.

### Changed

- **"Suggested for you" and "Pages/Groups you don't follow" are now on by
  default**, alongside "Sponsored". Both remain toggleable; the unfollowed
  option is the broadest and the first to turn off if the feed looks too
  sparse.
- **"Show a 'Show' placeholder" is now off by default**, so hidden posts
  disappear entirely rather than leaving a bar behind. Turning it on is still
  the easiest way to check what's being caught.
- The `DEBUG` summary now reports match counts by reason and how many were
  hidden, not just timing. Without per-match logging, "matched nothing" and
  "matched but couldn't anchor" are otherwise indistinguishable.

## 1.1.21

Covers everything since 1.1.13. Identical in behaviour to 1.1.20 — that build
carried the same code but shipped without this changelog.

### Fixed

- **Sponsored posts were not being hidden at all.** Facebook's scrambled
  "Sponsored" label pads the real characters with decoy spans, distinguished
  by class-list length — but the direction of that signal had flipped. The
  filter was discarding the *real* characters (~22 classes, including a long
  shared randomized suffix) and keeping the decoys (~7). Detection now
  assembles every plausible partition and matches against any of them, so a
  future flip can't silently kill detection again.
- **Hidden posts immediately reappeared.** Any node added inside a hidden post
  was treated as Facebook recycling the container for unrelated content, and
  the post was restored. Ads mutate constantly after being hidden (video
  players, lazy-loaded media, self-refreshing widgets), so they were un-hidden
  within milliseconds — and never re-examined afterwards, because scanning
  only ever runs on newly-added nodes. Restoring now re-checks whether the
  label that earned the hide is still present before undoing it.
- **Group posts were wrongly hidden.** A post embedding a shared post
  inherited the *quoted* author's "Follow" button, so a group you're a member
  of quoting someone you don't follow was hidden entirely. Follow/Join now
  only counts when it belongs to the post's own author header.
- **The toolbar counter reset by itself.** The background script is an event
  page — Firefox suspends it after roughly 30s idle, discarding the in-memory
  tally. The badge then jumped back to 1 on the next increment while the popup
  simultaneously reported 0. The count is now read back from the badge itself,
  which survives suspension, with per-tab serialisation so concurrent updates
  can't lose increments.

### Performance

- Element text is now read only on leaves and character-split labels.
  Wrappers are skipped entirely — the leaf holding the text is visited in its
  own right, so reading wrappers re-walked the same subtree once per nesting
  level.
- The `getComputedStyle`-per-child walk is gated behind a structural check
  (`isCharacterSplit`) instead of running on any element with two or more
  children. Resolving style on thousands of ordinary wrappers blocks the main
  thread hard enough to stop Facebook rendering.
- Facebook's portal accessibility spans (`<span id="_r_…_">`, which contain
  the literal word "Sponsored" but belong to no post and are minted
  constantly) are dropped before they reach the retry queue or the logs.
- Unfollowed labels no longer enter the retry queue. That queue exists for ads
  Facebook stages in a hidden node and reparents a moment later; a Follow
  button and its author header always render together, so retrying can never
  change the outcome.

### Changed

- `DEBUG` now defaults to **false**. When enabled it reports the running build
  version on load, a rolling scan-cost summary, and unresolved matches capped
  at `UNRESOLVED_LOG_LIMIT`. The cap matters: each log holds a live DOM
  reference, and with devtools open the browser retains and renders every one.
- README rewritten to correct stale claims and document the traps below.

### Known issues

- **Right-column sidebar ads are detected but not hidden.** Their menu buttons
  match `SPONSORED_ARIA_RE`, but they have no `aria-posinset` and the sidebar
  column no longer carries the `role="complementary"` landmark the fallback
  relied on — every ancestor up to `<body>` is an unlabelled `<div>`. Hiding
  nothing was preferred over risking an over-broad match that takes out a
  whole region.
- Unfollowed detection assumes the post's own author header is the **first**
  heading in the post. If Facebook ships a layout where it isn't, those posts
  are missed — failing quiet rather than hiding wrongly.
- Feed ad detection rests on the scrambled-text path; the
  `"… sponsored content"` aria-label matches sidebar ads only, since feed post
  menus read `"Actions for this post by <name>"`. Some feed ads may slip
  through.
- English-language labels only.

### Note for anyone building on this

`data-ad-rendering-role` looks like an ideal ad marker — the name says "ad",
and it tags every part of a sponsored post (`profile_name`, `story_message`,
`like_button`, …). It is **also present on ordinary posts from pages you
follow**; both render through the same story template. Keying off it
classifies the entire feed as sponsored and hides everything. It was tried
during this cycle and reverted.
