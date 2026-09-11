# Desktop ad labels — what has been ruled out

Written 2026-09-11, after a long investigation into feed ads that stay visible
on desktop. Read this before attempting another detection mechanism.

## Where it stands

Ads that carry an `/ads/about/` explainer link **are** detected and hidden
(1.1.63). Several ad formats fell to that.

At least one format still gets through: a another advertiser ad whose byline anchor
has **no path at all** — `href="?__cft__[0]=…"`, query string only. Its label
is not readable from the DOM by any mechanism tried.

## The label, as it actually exists

```html
<a href="?__cft__[0]=…" role="link" target="_blank">
  <span><span aria-labelledby="_r_v7_"><span></span></span></span>
</a>
```

The anchor renders at 17×17 and shows the word "Ad" on screen. Every element in
that subtree is empty. The `aria-labelledby` target is deleted immediately after
the browser computes the accessible name.

## Mechanisms eliminated, each by measurement

| Mechanism | Result |
| --- | --- |
| Leaf text (`textContent` of childless elements) | empty |
| Non-leaf own text (1.1.57) | empty |
| SVG `<text>` in the card (1.1.53) | not present |
| `<use>` sprite references | none resolve to "Ad" |
| Live `aria-labelledby` target | deleted before it can be read |
| Rescue from removal records (1.1.62) | counter stays 0 — never observed at all |
| Observer rooted at `documentElement` (1.1.61) | no change; not an insertion we were missing |
| `/ads/about/` path (1.1.63) | absent on this format — path stripped |
| CSS `::before` / `::after` content | `none` |
| CSS `background-image` / `mask-image` | `none` |

### data-ad-rendering-role: re-verified, still unusable

`data-ad-rendering-role` is **not** usable, despite being all over these cards.
See the warning in `classifyLabel`: it appears on ordinary posts too, because
Facebook renders both through the same story template, and keying off it hides
the entire feed.

Re-checked on 2026-09-11, when ads whose label is absent from the DOM made this
look like the only remaining option. An ordinary local buy-and-sell group
post reported:

```
ad-roles=profile_name,story_message,meta,title   ad-preview=yes   ads/about=no
```

Not an ad. `data-ad-preview` and `data-ad-comet-preview` are no better — the
same post carried those too. The warning stands; do not spend another session
on it.

## Why probing is so unreliable here

A recorder on a live feed measured **125 of 128 label nodes deleted within 40
seconds**. Two consecutive reads of the *same* byline anchor returned four
elements and then two. Any conclusion drawn from a single `querySelectorAll`
should be treated as a snapshot of something already gone.

The diagnostics panel exists for this reason — it accumulates over a page's
lifetime and reports from inside the content script. Use it first:

| symptom | reading |
| --- | --- |
| label not recognised | `matched` low, no `by#` evidence |
| recognised, nothing to anchor to | `matched` > `anchored` |
| label never observed | `by#…->MISSING` |

## What is left, if anyone wants to continue

**A shape heuristic, not a label.** Every one of these cards carries an
uppercase advertiser domain (`<ADVERTISER>.COM`, `<ADVERTISER>.COM`,
`<ADVERTISER>.COM`) plus a CTA button ("Shop now", "Learn More"), and its byline
anchor has no path where an organic post links to its own permalink.

Implemented in 1.1.70-1.1.73, after the label routes above were exhausted. It
rests on one veto: **a real post links to itself, an ad does not.** Everything
else is only a way of becoming a candidate.

### The permalink veto, and the trap in it

The veto is a list of self-link shapes, and the list is the dangerous part —
every shape missing from it is a real post the rule can hide. `/posts/` alone
covered a profile post and nothing else; group posts, listings, reels, photos
and events each link to themselves differently, and a live panel showed a
buy-and-sell post whose only self-link was `/commerce/listing/…`.

**`/stories/<id>/` is not on the list, and must not be added.** It looks
exactly like a self-link. A screenshot on 2026-09-11 showed it on a card
reading "Sponsored" in plain sight — National Geographic Travel and West
Virginia Tourism — so ads use it too, and adding it would permanently immunise
every ad shaped that way. Only add a shape here on evidence that ads do *not*
use it.

### Becoming a candidate

Two routes, because Facebook ships these cards differently week to week:

1. A **dangling `aria-labelledby`** in the byline. Held for all of a week: by
   1.1.71 the survey read `0 dangling, 0 resolving` across every visible card.
2. An **outbound link** — anything leaving facebook.com. Not just `/l.php`: the
   National Geographic card linked straight to `nationalgeographic.com`.

Ten `expect: visible` guards keep this honest, including a friend sharing a
news link both ways round (through the redirector and direct), and a group
post whose self-link is a listing. They must stay green.
