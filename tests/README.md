# Fixture tests

Offline tests for detection and anchoring. Each fixture is a DOM shape Facebook
has actually used; the runner builds it, drives the real pipeline over it, and
checks whether the post ends up hidden.

## Why this exists

Facebook rewrites its own markup continuously — a recorder on a live feed saw
**125 of 128 label nodes deleted within 40 seconds**. That makes console probing
unreliable (five consecutive probes gave five different answers) and makes "does
this fix work?" a question that otherwise needs a store submission to answer.

On 2026-09-11 six releases went out in a day chasing ads that stayed visible.
Three were confident fixes that never demonstrably landed. This is the thing
that would have prevented that.

## Running

```
python tests/build.py
```

Then open `tests/runner.html` in any browser. Green is pass. No install, no
network, no Facebook account — about a second.

`build.py` inlines `content.js` and every fixture into one page, because a
content script can only run against a real DOM and `file://` cannot fetch.
**Re-run it after every edit to `content.js`.**

## Testing against the live site without a store submission

Do not use AMO to test. In desktop Firefox:

`about:debugging` → **This Firefox** → **Load Temporary Add-on** → pick
`manifest.json`

Edit, click **Reload**, refresh Facebook. Seconds instead of a review cycle. The
add-on disappears on restart, which is what you want for testing.

## Adding a fixture when an ad gets through

1. Open the extension popup → **Diagnostics** → note the card under
   `VISIBLE, NOT HIDDEN`.
2. With that ad on screen, run this in the page console to capture its shape
   with the text stripped out:

```js
(()=>{const cards=[...document.querySelectorAll("div")].filter(d=>{const r=d.getBoundingClientRect();return r.width>600&&r.width<760&&r.height>300&&r.height<1400&&r.bottom>0&&r.top<innerHeight});const card=cards.filter(c=>!cards.some(o=>o!==c&&o.contains(c)))[0];if(!card)return"no card in viewport";const c=card.cloneNode(true);for(const el of c.querySelectorAll("*")){if(!el.children.length&&el.textContent&&el.textContent.length>20)el.textContent="text";el.removeAttribute("src");el.removeAttribute("href")}return c.outerHTML.slice(0,4000)})()
```

3. Save it as `tests/fixtures/<name>.json`:

```json
{
  "expect": "hidden",
  "why": "One sentence: what shape this is and where it was seen.",
  "card": "<div aria-posinset=\"1\">…</div>",
  "portal": "<span id=\"_r_x_\">Sponsored</span>"
}
```

`portal` is optional — use it when the label lives outside the post, as
`aria-labelledby` targets and sprite symbols do. It is inserted into `<body>`
rather than into the card.

**Always keep some `"expect": "visible"` fixtures.** Detection that hides real
posts is worse than detection that misses ads, and those guards are the only
thing standing between a broad heuristic and a hidden friend.

## A fixture is only worth what its fidelity is worth

The first `scrambled-sponsored` fixture here was **invented**, and it failed —
which looked like it had caught the live bug. It had not. It gave real
characters 3 classes and decoys 9, both below `HONEYPOT_LEAF_CLASS_COUNT`
(10), so no partition in `classifyLabel` could ever separate them. The code was
being asked to do something impossible.

With the ratio `content.js` actually documents — real ~22 classes, decoys ~7 —
the same fixture passes, in both polarities.

So the two live cards seen on 2026-09-11 remain **unexplained**. They differ
from the documented structure somehow, and a fixture written from imagination
cannot show how. When an ad next gets through, capture the real markup with the
snippet above rather than guessing at its shape; a fixture that fails for the
wrong reason is worse than no fixture, because it invites a fix to a bug that
is not there.

## Things the harness does not cover

- **The MutationObserver's own wiring.** The runner calls `cacheLabelTargets`
  and `scanRoot` directly, because `scheduleScan` defers through
  `requestAnimationFrame`, which does not fire in a hidden tab.
- **Mobile.** Every mobile path is gated on `<body class="html-renderer">` and
  the virtualised feed cannot be reproduced this way. See
  `MOBILE-VIRTUALISATION.md`.
- **Timing.** Labels that arrive in pieces, or posts revealed later, are
  sequencing behaviour rather than shape.

## Traps that produced false failures here

Worth knowing, because each one made a working extension look broken:

- **Depth.** `isImplausiblyShallow` discards any label within 10 levels of
  `<body>`. The runner nests every fixture 16 levels deep for this reason.
- **Where the marker lands.** `hidePost` marks whatever `findPostContainer`
  returned, usually an *ancestor* of the card. Checking the card itself finds
  nothing.
- **`getComputedStyle` on a hidden subtree.** A descendant of a `display: none`
  element reports its own display, never `"none"`. Ask whether it still has a
  box instead.
