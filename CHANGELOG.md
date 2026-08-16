# Changelog

## 1.1.50

### Fixed

- **The mobile feed stopped paging because of a single attribute write.**
  1.1.49 preserved every post's height and the feed still stalled, so the
  problem was never the geometry.

  Isolated by hand on a live phone feed, with the extension installed but all
  hiding switched off:

  | What was done to 6 feed children | Feed after 15s |
  | --- | --- |
  | Nothing (extension inert) | +58 posts — paging normally |
  | `data-fbsb-hidden` + inline style | stalled |
  | **`data-fbsb-hidden` only, no styling** | **stalled** |
  | `visibility: hidden` on their *children* | +34 posts — still paging |

  Setting one data attribute, changing nothing visible, was enough to stop
  Facebook's pager for the full window. Its own observers evidently treat a
  direct feed child that has been written to as changed underneath it, and stop
  reconciling.

  So the post element is now untouchable — no style, no attribute. Both go on
  its children instead: every element child gets `visibility: hidden`, and the
  marker attribute rides on the first of them. The children keep their boxes,
  so the post keeps its height, and Facebook sees a feed it still owns.

  `hiddenPosts` is still keyed by the post, so recycled-node detection resolves
  a marker to its parent when the marker is not itself a key.

  Desktop is unchanged: it removes posts with `display: none` as before, and
  nothing there is virtualised or reconciled this way.

### Still to verify

That the feed keeps paging with the extension actually doing the hiding, over a
long scroll — the table above was measured by hand, six posts at a time. It
also leaves blank space where each hidden post was, which is now the only known
remaining problem on mobile rather than one of several.

## 1.1.49

### Fixed

- **The mobile feed stopped loading after about 15 seconds of scrolling, and
  it was us.** Established by control test on stock Firefox for Android:
  extension disabled, the feed pages in new posts indefinitely; extension
  enabled, it stalls. Same account, same feed, same browser.

  Facebook virtualises that feed and decides what to page in next by measuring
  rendered content. `display: none` removes a post's height from that
  measurement, so hiding posts corrupts the figure the loop works from — hide
  enough and it stops paging entirely. This also explains two things that never
  quite added up: unchecking "Hide posts from Pages/Groups you don't follow",
  which hides the largest share of any feed, made the blackout go away; and
  1.1.44's pre-hiding, which hid far more posts than anything before it, made
  it dramatically worse.

  On mobile a post is now hidden with `visibility: hidden` instead. It becomes
  invisible while its box keeps exactly the height it had, so Facebook's
  accounting sees a feed that never changed shape.

  **The cost is deliberate and visible: a hidden ad leaves blank space where it
  was, rather than vanishing.** That is the same gap reported throughout
  testing, now accepted on purpose — blank space you can scroll past beats
  content you cannot reach. Desktop is unchanged and still removes posts
  outright; nothing there is virtualised this way.

### Note

With placeholder mode on, mobile now shows both the placeholder bar and the
blank space of the post behind it. Untidy, and left alone for now: the point of
this release is to find out whether preserving height keeps the feed alive.

## 1.1.48

### Added

- **Real timings in the diagnostics panel.** Three costs, kept apart, with each
  shown as a share of wall-clock time on the page:

  ```
  over 47s on page:
    scan     312ms  0.7%  (204 scans, 18422 els)
    observer  88ms  0.2%  (1310 calls)
    retry      4ms  0.0%  (12 ticks)
  ```

  They are separated because they fail for different reasons, and 1.1.35
  proved a healthy scan figure says nothing about the other two: it reported
  `1.0ms across 274 scans` while the page was unusable, because the cost was in
  the retry loop, which never calls `scanRoot`. The observer had the same blind
  spot until 1.1.42. Now all three are visible, and on a phone, which is where
  none of them could be read before.

  The percentage is the number worth reading. Milliseconds alone mean nothing
  without knowing over how long they accumulated.

  Scan timing was already collected in release builds — `reportStats` returns
  early when `DEBUG` is false, so nothing ever reset it — it simply had no way
  to be seen. Observer timing is now collected unconditionally too: two
  `performance.now()` calls per callback cost far less than what they measure,
  and a figure that only exists in a build nobody installs is not a
  measurement. Retry timing is new.

  In a `DEBUG` build these are a rolling 2s window rather than cumulative,
  because `reportStats` resets them. Worth remembering before comparing figures
  between the two builds.

## 1.1.47

### Fixed

- **The mobile feed was slow to catch up, and it was the extension's fault.**
  Confirmed by control test: with the extension disabled the same feed loaded
  quickly and normally.

  A label whose post Facebook hasn't rendered gets deferred to the reveal
  observer — but it was *also* being queued into the retry loop, which
  re-examines every entry every 50ms for a full 8 seconds. Those retries can
  never succeed: the candidate has no box and won't get one until Facebook
  reveals it, at which point the IntersectionObserver handles it anyway. On a
  virtualised feed most sponsored labels take that path, so the queue filled
  with work that was guaranteed to be wasted.

  This is the 1.1.35 regression's shape reached from a different direction — a
  flooded retry queue burning the 50ms loop — and the same lesson applies:
  queue only what can actually resolve later. Deferred labels are now left to
  the reveal observer, which is already waiting for exactly the event that
  would make them resolvable.

  `unfollowed` labels were already excluded on the same reasoning. This extends
  it to the case virtualisation creates.

- The diagnostics panel reports `reveals` — how many scans the reveal path has
  triggered. It should track how far you have scrolled; climbing while the page
  is still means the observer is firing when it shouldn't.

## 1.1.46

### Fixed

- **The breakage warning fired on every mobile page load, blaming Facebook for
  the extension working correctly.** Observed on a real device running 1.1.45:

  > `[fbsb] 20 labels matched, none could be anchored to a post ... If this is
  > a phone, the mobile class was probably renamed.`

  The mobile class had not been renamed — the warning says so itself two lines
  earlier, reporting the gate as `mobile`. What actually happened is that most
  of a virtualised feed is unrendered at any moment, those candidates have no
  box, and since 1.1.45 they are deliberately deferred to the reveal observer.
  The 1.1.42 check counted every deferral as a failure to anchor, so it
  tripped its threshold on any mobile feed within a second of loading.

  A miss on a post Facebook hasn't rendered is now counted separately and
  excluded from the threshold. What remains is what the check was written for:
  labels that should have anchored against something rendered, and didn't.

  This mattered beyond the noise. The warning is not `DEBUG`-gated, so it
  reached anyone with a console open, and it pointed confidently at the wrong
  cause — the exact failure mode 1.1.42 was built to prevent.

- The diagnostics panel reports `deferred` alongside the other counts. A large
  number there next to a healthy `anchored` is the reveal mechanism working,
  not failing.

## 1.1.45

### Fixed

- **Reverted 1.1.44's pre-hiding, which blanked the feed.** Resolving posts
  while Facebook still had them virtualised out let the extension hide them
  before they were ever rendered, and Facebook's swap-in loop — which works
  from rendered content — stalled: a few posts loaded and everything below
  stayed blank. The width rule is strict again.

### Added

- **Posts are now filtered when Facebook reveals them.** This is the actual
  reason mobile filtered almost nothing, in every release since 1.1.39.

  Facebook renders a window of the feed and swaps batches in as you scroll.
  That swap flips `display` on children that already exist — it is not a
  `childList` mutation, so the MutationObserver never saw it. Only the posts
  rendered at page load were ever examined; everything revealed afterwards
  arrived unfiltered, which on a feed where 42 of 64 children are hidden at
  any moment is nearly all of it.

  An `IntersectionObserver` on the feed's children notices the reveal. It
  polls nothing and stays silent while the page is still — unlike a scroll
  handler, which is the shape of the 1.1.35 freeze. An 800px root margin means
  a post is scanned while still below the fold, so it is hidden before it is
  seen rather than flashing into view.

  The feed element is recorded as a side effect of a successful climb, since
  that is the only code that knows which container is the feed. A second,
  `childList`-only observer on the feed itself picks up children appended as
  you page further down — a handful of callbacks per page, not one per
  mutation inside every post.

- The diagnostics panel now reports whether a feed is being watched and how
  many children are under observation. "not identified" there means no reveals
  are being seen at all, which is the first thing to check if mobile filters
  nothing.

### Still unverified

Whether this actually filters a real phone feed. Every mobile release since
1.1.39 was declared working on the strength of a spoofed desktop viewport that
does not virtualise, and none of them worked. This one is a hypothesis with a
mechanism behind it, and it stays that until it has been scrolled a long way on
a real device with the diagnostics panel read.

## 1.1.44

### Fixed

- **Ads kept appearing on a phone while the badge said posts were hidden.**
  Both statements were true. Facebook virtualises the mobile feed: only a
  window of posts is rendered, the rest sit at `display: none` with a `filler`
  element reserving their scroll height. Measured on a live phone feed, 42 of
  64 feed children were hidden at once, behind a filler 13,226px tall.

  A virtualised-out post reports `offsetWidth` 0 — it has no box. The width
  rule in `findMobilePostContainer` read that as "narrower than 60% of the
  feed" and returned `null`, so every off-screen ad was classified, rejected,
  and forgotten. Facebook then revealed it on scroll, unfiltered. The posts
  that *were* on screen resolved normally, which is why the badge kept
  climbing while ads stayed visible.

  The rule exists to reject nested carousel items — real boxes that happen to
  be narrow. It can say nothing about an element with no box at all, so it is
  now applied only to elements that have one. "Not currently rendered" and
  "too narrow to be a post" are different claims, and only the second is
  evidence against something being a post.

  Desktop is unaffected: nothing there is virtualised this way, so every
  candidate has a box and the rule applies exactly as before.

### Note on what this does not fix

Long blank gaps between posts are a separate problem with the same root.
Facebook sizes that filler assuming the posts it virtualised still occupy
their heights; hiding one shrinks the content without shrinking the filler.
This release does not address that.

It is also not yet known whether a hide applied while a post is virtualised
out survives Facebook revealing it — if Facebook overwrites the inline style,
the ad returns, and the observer would not notice because it watches
`childList` only, not attributes. That is the next thing to measure, and the
reason this ships as one change rather than two.

## 1.1.43

### Added

- **A diagnostics panel in the popup.** Firefox for Android has no devtools UI:
  the console is reachable only over USB remote debugging, so both the `DEBUG`
  perf line and the 1.1.42 breakage warning are unreadable on the one platform
  whose layout is hardest to reason about. Everything they would have said now
  renders in the popup, collapsed by default.

  It reports the layout gate taken, the viewport, the classified/anchored/
  hidden/waiting counts, the climb thresholds in force, and — the part that
  matters — the ancestor chain of the first few hidden elements with each
  node's child count and pixel dimensions.

  Those dimensions are the point. A correctly hidden post leaves no space
  behind, because `display: none` removes it. A **gap** in the feed means the
  node that owns the vertical space is still there and only its contents were
  hidden — so the climb stopped one level short. Reading `h` down the chain
  shows that immediately: a short chosen node under a tall parent is the
  signature.

  The sample is captured **before** the element is hidden, since `display: none`
  zeroes `offsetWidth` and `offsetHeight`, and it stores plain numbers rather
  than element references — the caution that applies to `logUnresolved` applies
  harder to data meant to outlive the hide.

  Not `DEBUG`-gated, deliberately. Gating it would put the diagnostics only in a
  build that cannot be installed from AMO, which is where phone users get
  theirs. The cost is a bounded array of eight small objects.

### Note on what this is for

This exists because of a real failure it could not previously explain: on a
phone the badge read 12 while ads and unfollowed posts stayed visible, with
long blank gaps between posts. Twelve successful hides landing on the wrong
node — invisible to every diagnostic the extension had, because all of them
spoke only to a console no phone can open.

## 1.1.42

### Added

- **Structural breakage now announces itself.** Every mobile code path is gated
  on `<body class="html-renderer">` and the app banner on
  `.fixed-container.bottom`. Both names are Facebook's to change, and when
  either goes the symptom is silence: labels still classify, nothing anchors,
  and the extension looks completely healthy while hiding nothing. 1.1.39 spent
  three stacked fixes inside exactly that blind spot.

  The check is not "does `html-renderer` still match" — that only catches the
  rename already imagined. It counts classified labels against anchored ones,
  and warns once per page if 20 labels match while none resolve. That signature
  means detection works and container resolution does not, which is what a
  structural rename looks like on either layout, desktop landmarks included.
  The warning reports which layout gate was taken so the two cases can be told
  apart immediately.

  The app banner gets its own check, since it is the one target anchored by
  selector rather than by climbing: reaching resolution at all means the text
  matched and the layout gate passed, so failing to find the bar is
  unambiguous and needs no threshold.

  This one is deliberately **not** `DEBUG`-gated. A diagnostic that only speaks
  in a build the user isn't running does not fix a silent failure. It is one
  `console.warn`, at most once per page, and it cannot fire on a page where
  anything at all was successfully hidden.

### Note on what this does not do

It warns; it does not adapt. A structural fallback was considered and rejected:
guessing the layout from "no ARIA landmarks, shallow document" would let a
wrong guess disable every mobile path silently — reintroducing the failure mode
this is meant to remove, one level further down.

## 1.1.41

### Fixed

- **Declared an Android compatibility floor of 120.** AMO validation flagged
  `permissions.request` as unimplemented at the stated minimum, and it was
  right: per Mozilla's compatibility data that API landed in Firefox for
  Android 120, while the manifest claimed 109. Below 120 the "Allow on
  facebook.com" button in both the popup and the setup page would have done
  nothing at all — on the one platform 1.1.39 exists to serve. 120 is also
  where Firefox for Android gained general extension support, so it is the
  floor at which any of this is installable anyway.

  `gecko_android` sets a compatibility range separate from desktop, which is
  what it is for. Desktop stays at 109.

### Note on the two warnings left

AMO still warns that `data_collection_permissions` postdates the stated
minimum (140 desktop, 142 Android). Those are left alone deliberately: it is
a manifest key, unknown keys are ignored by older browsers, and nothing
behaves differently. Silencing them would mean raising the desktop floor from
109 to 140 — cutting off every user between — to quiet a cosmetic warning
about a key whose entire content is a declaration that no data is collected.

## 1.1.40

### Added

- **The mobile "Open app" bar can be hidden.** Facebook pins a fixed bar to
  the bottom of the mobile web layout pushing you into the native app. It is
  now hidden by default, with its own checkbox — someone who wants ads gone
  may still want that button, so it is not folded into the existing three.

  It reuses the normal pipeline rather than getting a path of its own, which
  is what makes the setting toggle, the restore-on-disable, and the
  recycled-node handling work without new code. It differs from a hidden post
  in exactly two ways, both in `isPostReason()`: it never gets a placeholder
  (a "Post hidden — Show" bar would be more intrusive than the thing it
  replaced) and it never counts toward the badge, which counts posts.

  Detection is gated on the layout as well as the setting. Without that, every
  "Open app" string on a desktop page would classify, fail to resolve, and sit
  in the retry queue for the full 8s window — the shape of the 1.1.35
  regression, if not the scale.

  The anchor is `.fixed-container.bottom`, the only fixed-position element in
  the bottom half of the mobile viewport. Those two class names are
  descriptive rather than hashed, so they stand a better chance than the
  surrounding `m`/`f2` soup — but this is still a class-name dependency, and
  it will fail silently if Facebook renames them.

## 1.1.39

### Added

- **Works on Facebook's mobile web layout.** Installed on a phone the
  extension hid nothing at all, while looking perfectly healthy: permissions
  granted, content script injected, no errors. Three separate faults were
  stacked behind that, each invisible until the one before it was fixed.

  **Container resolution had nothing to anchor to.** Mobile web ("weblite" —
  it tags `<body>` with `html-renderer`) is a different app, not a narrow
  desktop. It exposes no ARIA landmarks whatsoever: no `role="article"`, no
  `aria-posinset`, no `data-pagelet`, no `role="complementary"`, and the
  author header is a plain `<div>` rather than a heading. Every strategy in
  `findPostContainer` keys off one of those, so all of them returned `null`.
  `findMobilePostContainer` climbs instead: that layout's feed is a single
  container whose direct children are the posts, so the post is the last
  ancestor before the first ancestor with many children. A width check
  rejects nested carousels, which can also clear the child-count bar. For
  `unfollowed`, the label must sit inside the container's first child —
  `isAuthorLevelLabel`'s "don't hide a post over a quoted author's Follow
  button" rule, expressed without headings to key off.

  **Ad labels were unmatchable.** Weblite draws its icons from a font mapped
  into the Private Use Area and packs them into the same span as the text, so
  an ad's label is literally `"Ad\u{F078B}\u{F17E0}"`. Those glyphs are
  category `Co`, and `INVISIBLE_CHARS_RE` stripped only `Cf` and `Mn`, so the
  cleaned text never equalled `"Ad"`. This is precisely why mobile hid
  unfollowed posts but never ads: `"Follow"` happens to sit in a span of its
  own, with no icons alongside it.

  **The decoy filter threw the labels away before either fix could matter.**
  `isImplausiblyShallow` treats anything within 10 levels of `<body>` as a
  portal/decoy span, which holds on desktop where real posts sit 15+ deep.
  Weblite's entire document is about 11 levels and an ad label measures
  exactly 10, so every real ad was discarded before resolution was attempted.
  The limit is now layout-aware (`MOBILE_SHALLOW_DEPTH_LIMIT`).

  Desktop behaviour is unchanged. The `Co` strip does apply to both, but it
  can only shorten text: the neighbouring organic-post span is a timestamp
  plus the same icons, `"1h\u{F212D}\u{F3196}"`, which cleans to `"1h"` and
  matches no target. Confirmed against a live desktop feed as well as mobile.

### Note for anyone building on this

Two of these three faults were undetectable from the outside, because the
symptom is identical in every case: nothing is hidden. What separated them
was `data-fbsb-seen`, the `DEBUG`-only marker `processLabel` sets on every
element it examines. "We never looked at it", "we looked and didn't match",
and "we matched and couldn't anchor it" need completely different fixes, and
that attribute is the only thing that tells them apart. The perf line helps
too, for the same reason: an entry missing from `matched:` means the label
was rejected before counting, not that detection failed.

## 1.1.38

### Changed

- **The `DEBUG` perf line now reports MutationObserver cost separately.**
  1.1.35 froze the feed while that line read a healthy `1.0ms across 274
  scans`, because the figure times `scanRoot` and nothing else. The observer
  callback runs synchronously on every mutation Facebook makes, including the
  whole of its initial render, and `cacheLabelTargets` walks each added
  subtree — none of it visible to the scan timer.

  The line now carries `observer: <ms> across <n> calls` alongside the scan
  figures, so the two costs can be told apart. This does not make anything
  faster; it makes a regression of that shape visible in the log instead of
  only in a whole-page profile.

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
