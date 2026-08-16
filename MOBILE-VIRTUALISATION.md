# Mobile feed virtualisation — what we know

Written 2026-08-15, at the end of the first real-device testing session. The
decision about how to handle this was deliberately deferred; this is the state
of the evidence, not a plan.

## Resolved in 1.1.50 — verified on a real device

Mobile works. Confirmed on stock Firefox for Android against a live feed: posts
are hidden and the feed keeps paging as you scroll. Blank space remains where
each hidden post was — that is the deliberate trade described below, and the
only known outstanding problem.

**The cause, after several wrong theories:** Facebook's feed stops paging if
*any* attribute is written to a direct child of the feed container. Isolated by
hand, with the extension inert, six feed children, 15s of scrolling each:

| Done to 6 feed children | Result |
| --- | --- |
| Nothing | +58 posts, paging normally |
| `data-fbsb-hidden` + inline style | stalled |
| **`data-fbsb-hidden` alone, no styling** | **stalled** |
| `visibility: hidden` on their *children* | +34 posts, still paging |
| `display: none` on their *children* (collapsing the space) | stalled |

One data attribute, nothing visible changed, stopped the pager. So the post
element is untouchable; styling and the marker both live on its children, which
keep their boxes so the post keeps its height.

**The blank space is permanent, not a loose end.** The last row is the answer to
"can we collapse it": no. Touching only the children is safe, but making them
`display: none` shrinks the post, and the pager stops just as surely as it does
on an attribute write. Facebook objects both to being written to and to the
feed changing height underneath it. Anything that reclaims that space will stall
the feed, so a hidden post has to keep its full height and the gap stays.

The remaining scope for improvement is cosmetic and lives *inside* the post:
its children can be styled freely, so the space could be made to read as
deliberate — a marker rendered within the existing height — rather than left
blank. Untested, but it is the only direction that does not violate a
constraint already measured.

Theories this disproved along the way, all of which looked convincing:
`display: contents` wrappers, the width guard degrading at phone widths,
geometry/height accounting, main-thread starvation, Waterfox's user agent, and
Facebook's GWT `user.agent` mismatch error (real, present on every Gecko mobile
browser, and irrelevant to this).

## The history below, kept because it explains how the code got its shape

**Mobile did not work in practice until 1.1.50.** Not in 1.1.39 when it was
declared working, and not in any release until the one above. The user's
experience across all of them was ads and unfollowed posts throughout the feed.

Evidence exists that *something* was hidden — two feed children carried
`data-fbsb-hidden=sponsored`, and the badge reached 12 — so it is not zero. But
a handful of hides inside the render window, on a feed where most posts are
virtualised out and never resolve at all, is not a filtered feed.

Worth being blunt about why it shipped: 1.1.39–1.1.41 were validated against a
**desktop browser with a spoofed user agent at 1345px**. That serves the same
weblite markup, which is why the work looked correct — but a desktop viewport
does not virtualise. The single property of the real environment that breaks
this was absent from every test that declared it working, and stayed absent
until the first real device was tried.

Any future claim that mobile works should be backed by a real device, scrolled
a long way, with the diagnostics panel read — not by markup that merely
resembles it.

## Current state, and the thing to know first

**1.1.44 is published and installed, and it blanks the mobile feed** unless
*Hide posts from Pages/Groups you don't follow* is unchecked. With that box
off, the feed is usable. That is the workaround in force right now.

Reverting to 1.1.43's behaviour is one commit away (`git revert 128870c`) if a
usable mobile build matters more than the diagnosis.

## Measurements, from a real device

Waterfox Android, Gecko 153, viewport 408×736, live logged-in feed, read via
USB remote debugging from Waterfox desktop's `about:debugging`:

| Fact | Value |
| --- | --- |
| `<body>` class | `html-renderer Firefox Android` |
| Feed container | 64 children, 17,010px tall |
| Children at `display: none` | 42 of 64, simultaneously |
| Trailing spacer | `[63] div.filler`, **13,226px** |
| Leading spacer | `[0] div.filler`, 0px |
| Ads hidden by us | `[16]`, `[30]` — carried `data-fbsb-hidden=sponsored` |
| Ads hidden by Facebook | `[24]`, `[36]`, `[52]` — `display:none`, **no** marker |

Two things that settles for good:

- **The layout gate works.** `html-renderer` is present on real Waterfox
  Android, so `isMobileLayout()` is not the problem and never was.
- **The climb picks the right node.** For each ad label, the last ancestor
  before the many-childrened feed container is a direct feed child — which is
  the post. The algorithm is not lost.

## The mechanism

Facebook virtualises this feed. Only a window of posts is rendered; the rest
sit at `display: none` with `filler` elements reserving their scroll height.
As you scroll, it converts filler height into real posts.

A virtualised-out post reports `offsetWidth` 0, because it has no box at all.
Up to 1.1.43 the width rule in `findMobilePostContainer` read that as "narrower
than 60% of the feed" and returned `null` — so **every off-screen ad was
classified, rejected, and forgotten**, then revealed unfiltered on scroll. The
posts that were on screen resolved normally.

That is the exact shape of the original complaint: the badge climbed to 12
while ads stayed visible. Both observations were true simultaneously.

## What 1.1.44 changed, and what went wrong

1.1.44 applied the width rule only to elements that actually have a box, so
virtualised-out posts resolve and get hidden ahead of being revealed.

The feed then blanked out: a few posts would load and everything below was
blank. Unchecking `unfollowed` — the rule that hides the largest share of the
feed — stopped it.

The likely explanation is that **hiding posts breaks Facebook's virtualisation
loop**. It swaps the next batch in based on rendered content; remove enough of
that content and it stalls, leaving the filler's 13,226px with nothing ever
rendering into it. Pre-hiding makes this dramatically worse than 1.1.43,
because Facebook goes to reveal a batch that is already gone.

This is *likely*, not established — see Unknowns.

## The tension

The two goals are in direct conflict:

- **Pre-hide virtualised posts** → ads never appear, feed blanks out.
- **Only hide rendered posts** (1.1.43) → feed works, ads arrive on scroll.

The candidate way out is **hide on reveal**: restore the width guard, and
re-scan when Facebook swaps a batch in, hiding those ads as they become real.
Facebook's loop stays intact because only already-rendered nodes are removed.

Its costs, both real:

- An ad can flash visible for a frame or two before being hidden. The README
  already documents this for the desktop video/link-preview template, but on
  mobile it would be the normal path rather than an edge case.
- Detecting reveals means watching style attributes across the feed subtree or
  a throttled scroll rescan. **Both are the shape of the 1.1.35 freeze**, which
  reported a healthy `1.0ms across 274 scans` while the page was unusable. Any
  attempt must go through `scheduleScan`'s rAF coalescing and be measured by
  the 1.1.42 observer timing, with the result read in the diagnostics panel.

## Unknowns — measure these before deciding

1. ~~**Is the extension even responsible for the blank regions?**~~
   **Answered 2026-08-15: yes.** With the extension disabled, the feed does not
   blank — it scrolls normally. Baseline Waterfox Android renders Facebook's
   mobile feed fine, so every blank region and gap seen during this session was
   caused by the extension's hiding, and the "hiding disturbs Facebook's
   swap-in loop" explanation stands on evidence rather than inference.

   Consequence worth carrying forward: **gaps are not exclusive to 1.1.44.**
   They were reported before it too, when only rendered posts were hidden. So
   1.1.45's hide-on-reveal, which also removes rendered posts, may still
   produce them — it addresses the blackout and the filtering, not the gaps.
2. **Blackout mechanism.** Is the loop stalling, or is `unfollowed` simply
   hiding most of a feed that is mostly Pages the user doesn't follow? A short
   feed and a stalled feed are different bugs. The diagnostics panel's
   `samples` section distinguishes them and has not yet been read.
3. **Does a hide survive a reveal?** If Facebook overwrites the inline style
   when swapping a post in, the ad returns — and the observer would not notice,
   because it watches `childList` only, not attributes.
4. **Does placeholder mode behave differently?** It leaves a bar where each
   post was, which changes how much the content height collapses. Untested.

## Tooling built along the way

- **1.1.42** — warns once when 20 labels classify and none anchor. Console
  only, so invisible on Android.
- **1.1.43** — diagnostics panel in the popup: layout gate, viewport, counts,
  climb thresholds, and the ancestor chain of the first hidden elements with
  dimensions. Built because Android has no devtools UI. **Not yet read from an
  actual failing phone** — doing so is the fastest route into unknowns 2 and 3.
- USB remote debugging via desktop `about:debugging` works and produced
  everything in the Measurements table. `adb` did not need installing
  separately; the *Enable USB Devices* button fetched it.
