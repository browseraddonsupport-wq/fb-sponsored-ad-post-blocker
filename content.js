// Detects Facebook's "Sponsored"/"Ad", "Suggested for you" and unfollowed
// Page/Group posts, and hides the post they belong to. Facebook exposes no
// stable class name for any of this, so detection works from what the page has
// to show a person:
//   1. Label text or accessible name, cleaned of Facebook's obfuscation (see
//      labelVariants) - "Sponsored"/"Ad", "Suggested for you", or a
//      "Follow"/"Join" button beside the poster's name.
//   2. Where no label is readable, the shape of an ad: a card that points at a
//      vanished label, links off Facebook or carries a call to action, and
//      neither links to itself nor says how old it is (see sweepUnlabeledAds).
// Once a post is identified, wholePost finds the card it belongs to and
// hidePost takes it out of the feed.

// Firefox exposes the promise-based WebExtension APIs as `browser`; Chromium
// only provides `chrome`. Every API this extension uses (storage, action,
// tabs, runtime) already returns promises under Chromium's MV3, so aliasing
// the namespace is enough — no polyfill library required.
const browser = globalThis.browser ?? globalThis.chrome;

// Set true to log unresolved matches (capped) and a rolling scan-cost summary.
// Leave false for normal use: the logs hold DOM references, and with devtools
// open the browser retains and renders every one — enough volume there made
// the page unusable while the extension's own measured cost stayed low.
const DEBUG = false;

// Keep in sync with the copy in popup/popup.js.
const DEFAULT_SETTINGS = {
  hideSponsored: true,
  hideSuggested: true,
  hideUnfollowed: true,
  hideAppBanner: true,
  // ON by default. This is the only rule that infers "ad" from shape rather
  // than reading a label, so it is the only one that can hide a real post - but
  // Facebook now ships ads carrying no readable label at all, and an extension
  // whose whole purpose is hiding ads should do that out of the box rather than
  // wait to be asked. The checkbox exists to switch it off if it misfires.
  hideUnlabeledAds: true,
  // Pages the shape rule must never hide, one per line. On a page load with no
  // byline timestamp and no permalink it recognises, a Page you follow posting a
  // link is indistinguishable from an advertiser posting one; the audit list names
  // the page, so this fixes it for good.
  keepPages: "",
  // Pages you have marked as advertisers. Not a blanket block: a post from one
  // still has to look like an ad - it must link off Facebook - before it is
  // hidden. A Page that posts both, which is the case that makes a blanket
  // block wrong, keeps the posts that are not ads.
  adPages: "",
  // The in-feed "This is an ad" control. On by default because it is how the
  // other two lists get filled in, and easily switched off once they are.
  showMarkers: true,
  placeholderMode: false,
};

let settings = { ...DEFAULT_SETTINGS };

// --- Label detection -------------------------------------------------------

// Add more strings here to support other locales.
const SPONSORED_TEXTS = new Set(["Sponsored", "Ad"]);
const SUGGESTED_TEXTS = new Set(["Suggested for you", "Suggested for You"]);
// A bare "Follow"/"Join" button next to the poster's name is Facebook's own
// signal that this is a Page or Group you don't follow/haven't joined —
// distinct from "Following"/"Joined", which only show once you already do.
const UNFOLLOWED_TEXTS = new Set(["Follow", "Join"]);
// The "Open app" bar pinned to the bottom of the mobile web layout. Not a
// feed post, so it is hidden by its own container rather than by climbing:
// it is the only fixed-position element in the bottom half of the viewport,
// and unlike the m/f2 class soup around it, these two class names are
// descriptive and have some chance of surviving a redesign.
const APP_BANNER_TEXTS = new Set(["Open app"]);
const APP_BANNER_SELECTOR = ".fixed-container.bottom";
const SPONSORED_ARIA_RE = /sponsored content$/i;
// The "Why am I seeing this ad?" explainer. Matches both "/ads/about/" and the
// absolute form; the query string Facebook appends is irrelevant.
const ADS_ABOUT_RE = /(^|\.com)\/ads\/about(\/|\?|$)/;

// Facebook obfuscates label text in ways all undone by stripping these Unicode
// categories:
//   - Cf/Mn: an invisible joiner or combining mark on every character, so
//     textContent never equals "Sponsored" even once concatenated.
//   - Co: on mobile, icons drawn from a Private Use Area font share the label's
//     span - an ad reads "Ad" plus two icon glyphs, which matches nothing until
//     they are removed.
// Decoy characters and CSS `order` reshuffling are handled by labelVariants.
// Dropping Co cannot create a match on its own: the organic equivalent, a
// timestamp plus the same icons, cleans to "1h".
const INVISIBLE_CHARS_RE = /[\p{Cf}\p{Mn}\p{Co}]/gu;
const HONEYPOT_LEAF_CLASS_COUNT = 10;
// Every genuine character-split label found this session is flat: one
// wrapper span, one level of character-spans below it (occasionally two).
// Profiling showed the label walk recursing 20+ levels deep into unrelated,
// legitimately-deeply-nested page content that slipped past the width
// check (MAX_SCRAMBLED_LABEL_CHILDREN bounds direct children, not depth),
// calling the expensive getComputedStyle at every level — a real perf bug.
// Bailing out past a small depth caps the damage regardless of width.
const MAX_LABEL_DEPTH = 4;

// Walk the label once, collecting its character-spans in visual (CSS `order`)
// sequence along with the two things that distinguish real characters from
// decoys: how many classes the span carries, and whether it renders at all.
// One getComputedStyle per node, reused for both the ordering and the
// visibility test.
function collectOrderedLeaves(node, depth = 0) {
  if (node.nodeType === Node.TEXT_NODE) {
    return [{ text: node.textContent, classCount: null }];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  if (depth > MAX_LABEL_DEPTH) return [];

  const withOrder = Array.from(node.childNodes).map((child, index) => {
    let order = index;
    let hidden = false;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const computed = getComputedStyle(child);
      const parsed = parseInt(computed.order, 10);
      if (!Number.isNaN(parsed)) order = parsed;
      hidden = computed.display === "none" || computed.visibility === "hidden";
    }
    return { child, order, hidden };
  });
  withOrder.sort((a, b) => a.order - b.order);

  const leaves = [];
  for (const { child, hidden } of withOrder) {
    if (hidden) continue;
    if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "SPAN" && child.children.length === 0) {
      leaves.push({ text: child.textContent, classCount: child.classList.length });
    } else {
      leaves.push(...collectOrderedLeaves(child, depth + 1));
    }
  }
  return leaves;
}

// Character-split labels are padded with decoy spans, signalled by class-list
// length - but the direction of that signal has flipped before (the real
// characters have carried both the longer and the shorter lists), and a flip
// silently stops detection. So assemble every plausible partition and let the
// caller match any of them: the targets are a handful of short known labels, so
// a decoy partition matching one by accident is not a realistic risk.
function labelVariants(el) {
  const leaves = collectOrderedLeaves(el);
  if (leaves.length === 0) return [];
  const assemble = (keep) =>
    leaves
      .filter((leaf) => leaf.classCount === null || keep(leaf.classCount))
      .map((leaf) => leaf.text)
      .join("")
      .replace(INVISIBLE_CHARS_RE, "")
      .trim();
  return [
    assemble(() => true),
    assemble((n) => n > HONEYPOT_LEAF_CLASS_COUNT),
    assemble((n) => n <= HONEYPOT_LEAF_CLASS_COUNT),
  ];
}

function reasonForText(text) {
  if (!text) return null;
  if (settings.hideSponsored && SPONSORED_TEXTS.has(text)) return "sponsored";
  if (settings.hideSuggested && SUGGESTED_TEXTS.has(text)) return "suggested";
  if (settings.hideUnfollowed && UNFOLLOWED_TEXTS.has(text)) return "unfollowed";
  // Gated on the layout as well as the setting: this banner only exists on
  // mobile, and without the gate every "Open app" string on a desktop page
  // would classify, fail to resolve, and sit in the retry queue for 8s.
  if (settings.hideAppBanner && APP_BANNER_TEXTS.has(text) && isMobileLayout()) {
    return "appbanner";
  }
  return null;
}

// Bounds how wide a character-split label can be. Real ones run to a few
// dozen character-spans including decoy padding; anything wider is some
// unrelated, much larger chunk of the page that could never be one of our
// short target strings.
const MAX_SCRAMBLED_LABEL_CHILDREN = 120;

// labelVariants resolves computed style per child, which forces a style flush,
// so it must only run on genuine character-split labels. "Has two or more
// children" matches thousands of ordinary wrappers and blocked the main thread
// badly enough to stop the feed rendering. A real scrambled label is cheap to
// recognise without resolving any style: a row of leaf spans each holding
// exactly one visible character.
const MIN_SCRAMBLED_LABEL_CHILDREN = 4;

function isCharacterSplit(el) {
  const children = el.children;
  if (children.length < MIN_SCRAMBLED_LABEL_CHILDREN) return false;
  if (children.length > MAX_SCRAMBLED_LABEL_CHILDREN) return false;
  for (const child of children) {
    if (child.tagName !== "SPAN" || child.children.length !== 0) return false;
    if (child.textContent.replace(INVISIBLE_CHARS_RE, "").length > 1) return false;
  }
  return true;
}

// The text an element holds directly, ignoring anything its children hold.
// Bounded by the number of direct children and never recurses - see the note in
// classifyLabel about why walking subtrees here is what once stalled Facebook's
// rendering.
const MAX_OWN_TEXT = 300;

function ownText(el) {
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    out += node.textContent;
    if (out.length > MAX_OWN_TEXT) return "";
  }
  return out.trim() ? out : "";
}

function classifyLabel(el) {
  // Only two shapes can carry a text label, and both are cheap to read: a leaf,
  // and a character-split label (recognised without resolving style). Reading
  // textContent on a wrapper walks its whole subtree, and since the scan visits
  // every span and anchor, doing so at every nesting level is quadratic - enough
  // to stall Facebook's rendering. Wrappers are skipped; the leaf holding the text
  // is visited on its own.
  if (el.children.length === 0) {
    const raw = el.textContent;
    if (raw && raw.length <= 300) {
      const reason = reasonForText(raw.replace(INVISIBLE_CHARS_RE, "").trim());
      if (reason) return reason;
    }
  } else if (ownText(el)) {
    // An element can hold the label AND an element child - "Ad" beside a globe
    // icon, which is how several feed ads are built. It is neither a leaf nor
    // character-split, so read only its OWN text nodes: one pass over direct
    // children, never descending, which keeps the leaf rule's guarantee against
    // re-walking the same subtree.
    const reason = reasonForText(ownText(el).replace(INVISIBLE_CHARS_RE, "").trim());
    if (reason) return reason;
    if (isCharacterSplit(el)) {
      for (const variant of labelVariants(el)) {
        const r = reasonForText(variant);
        if (r) return r;
      }
    }
  } else if (isCharacterSplit(el)) {
    for (const variant of labelVariants(el)) {
      const reason = reasonForText(variant);
      if (reason) return reason;
    }
  }

  // NOTE: do not key off data-ad-rendering-role, data-ad-preview or
  // data-ad-comet-preview. They look like ad markers and appear on every part of a
  // sponsored post - and also on ordinary posts, because Facebook renders both
  // through the same story template. Keying off them hides the entire feed.
  // Re-verified against an ordinary group post carrying all three.

  // Some byline labels are vector art: an <svg><use> pointing at a sprite
  // <symbol> elsewhere in the document, so the post itself contains no text. The
  // symbol does hold real text for screen readers - "Sponsored" for an ad, a
  // timestamp for an organic post - so follow the reference and match that. The
  // cache covers symbols Facebook has already discarded.
  if (el.tagName === "use") {
    const ref = el.getAttribute("xlink:href") || el.getAttribute("href");
    if (ref && ref.startsWith("#")) {
      const id = ref.slice(1);
      const target = document.getElementById(id);
      const text = target
        ? target.textContent.replace(INVISIBLE_CHARS_RE, "").trim()
        : labelTextById.get(id);
      if (text) {
        const reason = reasonForText(text);
        if (reason) return reason;
      }
    }
  }

  // The byline links the "Ad" label to /ads/about/ - the "Why am I seeing this
  // ad?" explainer. That is structural, not textual, which matters because some
  // ads have no text to find: the byline is an anchor wrapping an empty span
  // whose accessible name comes from a node Facebook deletes immediately.
  //
  // Unlike data-ad-rendering-role, this link is not on ordinary posts: an organic
  // byline links to the post's own permalink. `a` is already in LABEL_SELECTOR, so
  // this costs one attribute read.
  if (settings.hideSponsored && el.tagName === "A") {
    const href = el.getAttribute("href") || "";
    if (ADS_ABOUT_RE.test(href)) return "sponsored";
  }

  const ariaLabel = el.getAttribute && el.getAttribute("aria-label");
  if (ariaLabel) {
    // NOTE: current markup labels the post menu "Actions for this post by
    // <name>" with no mention of sponsorship, so this no longer fires on the
    // feed. Kept because it costs nothing and still matches older/other
    // surfaces; the data-ad-rendering-role check above is what actually
    // carries sponsored detection now.
    if (settings.hideSponsored && SPONSORED_ARIA_RE.test(ariaLabel)) {
      return "sponsored";
    }
    if (DEBUG && /sponsor/i.test(ariaLabel)) {
      console.log('[fbsb] near-miss aria-label (contains "sponsor" but no match):', ariaLabel, el);
    }
  }

  // Some ads carry no "Sponsored" text in the post at all: the word lives in a
  // portal <span id="_r_..._"> parked outside every post, which the post
  // references by aria-labelledby. The portal span can never be anchored, but the
  // referencing element is inside the post, so resolve the relationship from this
  // end. Every referenced id is checked: the attribute is a list, and the
  // accessible name is their concatenation.
  //
  // Deliberately limited to the ad labels: "Follow"/"Join" appear as accessible
  // names all over the interface for reasons unrelated to who posted something.
  for (const { text } of labelRefTexts(el)) {
    if (!text) continue;
    if (settings.hideSponsored && SPONSORED_TEXTS.has(text)) return "sponsored";
    if (settings.hideSuggested && SUGGESTED_TEXTS.has(text)) return "suggested";
  }

  return null;
}

// --- Post container resolution ----------------------------------------------

// Given an ancestor landmark, returns the direct child of that landmark
// that contains `label` — i.e. the individual post/card/widget boundary,
// for layouts where posts aren't wrapped in role="article".
function climbToChildOf(label, landmark) {
  let node = label;
  while (node.parentElement && node.parentElement !== landmark) {
    node = node.parentElement;
  }
  return node.parentElement === landmark ? node : null;
}

// A "Follow"/"Join" button only means "a Page or Group you don't follow" when it
// sits beside the post's OWN author. Posts often embed a shared post with its
// own author header and Follow button, so a group post quoting someone you don't
// follow would otherwise be hidden on the strength of the quoted author's button.
//
// The post's own header is its first heading or - where there is none, as on
// reels and video cards - its first child subtree; anything quoted comes later.
// Erring toward leaving posts visible is the right way to be wrong: a missed
// unfollowed post is an annoyance, a wrongly hidden one is content you never
// learn you lost.
function isAuthorLevelLabel(label, container) {
  // The header row holds the name and the button side by side: on a real card the
  // Follow button is a sibling of the heading, not inside it. Descend through
  // single-child wrappers first, or "the first child" of a landmark wrapping the
  // card is the whole post - and a quoted page's Follow button inside it would
  // take the post out.
  let body = container;
  while (body.children.length === 1) body = body.children[0];
  const first = body.firstElementChild;
  if (first && first !== label && first.contains(label)) return true;
  const firstHeading = container.querySelector("h1, h2, h3, h4, h5, h6");
  return !!firstHeading && label.closest("h1, h2, h3, h4, h5, h6") === firstHeading;
}

// Facebook's mobile web renderer ("weblite", which tags <body> with
// html-renderer) is a different app, not a narrow desktop: no ARIA landmarks at
// all, and the author header is a plain <div>. Every strategy in
// findPostContainer keys off a landmark, so mobile needs its own climb.
//
// Keyed off the body class rather than "no landmarks found", which would need a
// document-wide query per label and answers wrongly on a desktop page that has
// not painted its feed yet. If Facebook renames this class, mobile support stops
// silently - which is what the breakage warning below exists to catch.
const MOBILE_BODY_CLASS = "html-renderer";

function isMobileLayout() {
  return document.body.classList.contains(MOBILE_BODY_CLASS);
}

// What that layout does have is a flat feed: one container whose direct
// children are the posts (measured: 71 children, each post 7 levels above its
// "Follow" button, every wrapper in between holding 1-4 children). So the post
// is the last ancestor before the first one that has many children.
const MOBILE_FEED_MIN_CHILDREN = 10;
const MOBILE_MAX_CLIMB = 12;
// Feed posts span the feed's full width (measured: 1339-1345 of 1345). A
// carousel nested inside a post could also clear the child-count bar, and
// climbing would stop at one of its items; requiring most of the parent's
// width rejects that without needing to know what the carousel is.
const MOBILE_MIN_WIDTH_RATIO = 0.6;

// --- Catching posts as Facebook reveals them -------------------------------
//
// Facebook renders a window of the feed and swaps batches in as you scroll by
// flipping `display` on children that already exist - not a childList mutation,
// so the MutationObserver never sees it. Hiding posts while they are still
// virtualised out stalls Facebook's swap-in loop and blanks the feed (see
// MOBILE-VIRTUALISATION.md), so wait for the reveal instead of racing it.
// IntersectionObserver notices without polling; the margin means a post is
// scanned while still below the fold, so it is hidden before it is seen.
const REVEAL_MARGIN = "800px";

let mobileFeed = null;
let revealObserver = null;
let feedChildObserver = null;
// How many scans the reveal path has triggered. Cheap, and the number to look
// at first if mobile feels slow: it should track how far you have scrolled,
// not climb while the page is still.
let revealScans = 0;

function observeFeedChildren() {
  if (!mobileFeed || !revealObserver) return;
  // observe() on an already-observed element is a no-op, so this can be called
  // as often as the feed changes without tracking what is already watched.
  for (const child of mobileFeed.children) revealObserver.observe(child);
}

function noteMobileFeed(feed) {
  if (mobileFeed === feed) return;
  mobileFeed = feed;

  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          revealScans += 1;
          scheduleScan(entry.target);
        }
      },
      { rootMargin: REVEAL_MARGIN }
    );
  } else {
    revealObserver.disconnect();
  }

  observeFeedChildren();

  // Facebook appends more children as you page further down. childList on the
  // feed element itself — not its subtree — is a handful of callbacks per page
  // of scrolling, rather than one per mutation inside every post.
  if (feedChildObserver) feedChildObserver.disconnect();
  feedChildObserver = new MutationObserver(observeFeedChildren);
  feedChildObserver.observe(feed, { childList: true });
}

function findMobilePostContainer(label, reason) {
  // The app banner is a fixed bar, not a feed child — climbing by child count
  // would walk straight past it to the page wrapper.
  if (reason === "appbanner") {
    const bar = label.closest(APP_BANNER_SELECTOR);
    if (!bar) warnAppBannerAnchorLost(label);
    return bar;
  }

  let node = label;
  for (let i = 0; i < MOBILE_MAX_CLIMB; i++) {
    const parent = node.parentElement;
    if (!parent || parent === document.body) return null;

    if (parent.children.length >= MOBILE_FEED_MIN_CHILDREN) {
      // Most children of this feed are display:none at any moment, behind a filler
      // reserving their scroll height, and report offsetWidth 0 - so this rejects
      // them, deliberately. Resolving virtualised-out posts hides them before
      // Facebook has rendered them, and its swap-in loop stalls: a few posts load and
      // everything below stays blank. They are caught when revealed instead, by the
      // reveal observer, once they have boxes.
      if (node.offsetWidth < parent.clientWidth * MOBILE_MIN_WIDTH_RATIO) {
        // A candidate with no box at all was rejected because Facebook has not
        // rendered it yet — an expected, temporary miss that the reveal
        // observer will retry. One that has a box and is merely narrow is a
        // real rejection. Only the second is evidence of anything being wrong,
        // and conflating them made the breakage warning fire on every mobile
        // page load claiming Facebook had renamed the structure.
        deferredUnrendered = node.offsetWidth === 0 && node.offsetHeight === 0;
        return null;
      }

      // Remember the feed the moment one is identified, so the reveal observer
      // has something to watch. This is the only place that knows which
      // container is the feed, and it knows it as a side effect of a
      // successful climb rather than by searching for it.
      noteMobileFeed(parent);

      // The mobile equivalent of isAuthorLevelLabel. There are no headings to
      // key off, but the post's own author header is its first child subtree,
      // and a quoted/embedded post's header comes later — so requiring the
      // label to sit inside the first child errs the same way, toward leaving
      // posts visible.
      if (reason === "unfollowed") {
        const first = node.firstElementChild;
        if (!first || !first.contains(label)) return null;
      }
      return node;
    }
    node = parent;
  }
  return null;
}

// A feed card is wide; the chrome inside it is not. Below this, a candidate is
// a button or a byline rather than a post, and hiding it would leave the ad in
// place looking broken.
const DESKTOP_CARD_MIN_WIDTH = 400;
const DESKTOP_CARD_MAX_CLIMB = 14;
// A real jump in width means the climb has left the card and entered the page
// column. 1.2 is generous enough to tolerate padding without crossing it.
const DESKTOP_CARD_WIDTH_JUMP = 1.2;

function climbToCard(label) {
  let node = label;
  let best = null;
  for (let i = 0; i < DESKTOP_CARD_MAX_CLIMB; i++) {
    const parent = node.parentElement;
    if (!parent || parent === document.body) break;
    const width = node.getBoundingClientRect().width;
    const parentWidth = parent.getBoundingClientRect().width;
    // The width-jump rule only means anything once the climb has reached card
    // width. From the start it fires on the first step - a label is a narrow inline
    // span inside the whole card - and the climb ends having found nothing.
    if (width >= DESKTOP_CARD_MIN_WIDTH) {
      best = node;
      if (parentWidth > width * DESKTOP_CARD_WIDTH_JUMP) break;
    }
    node = parent;
  }
  return best;
}

function findPostContainer(label, reason) {
  if (isMobileLayout()) return findMobilePostContainer(label, reason);

  const feedPost = label.closest('[role="article"], [data-pagelet^="FeedUnit"]');
  if (feedPost) return feedPost;

  // aria-posinset marks an element's position within a list — on the main
  // feed that means "this is a feed post", but Facebook reuses the same
  // generic attribute for other ordered lists too (e.g. a Reels comment
  // list), where climbing to it would wrongly grab the whole comments
  // panel instead of a specific post. Reels (and other full-screen
  // overlays like the photo viewer) sometimes render inside a dialog,
  // which a real feed post never does, so excluding that context helps
  // (though not always — see role="complementary" note below).
  if (!label.closest('[role="dialog"]')) {
    const posinsetPost = label.closest('[aria-posinset]');
    if (posinsetPost) {
      if (reason === "unfollowed" && !isAuthorLevelLabel(label, posinsetPost)) {
        return null;
      }
      return posinsetPost;
    }
  }

  // role="complementary" reliably means the right-hand ad rail for sponsored and
  // suggested content. But Facebook also marks a reel page's whole comments panel
  // as complementary, and a stray "Follow"/"Join" anywhere inside it would take
  // out the panel. Hiding a sidebar Follow button was never the intent of
  // "unfollowed", which is about feed posts, so this fallback skips that reason.
  if (reason !== "unfollowed") {
    const rail = label.closest('[role="complementary"]');
    if (rail) return climbToChildOf(label, rail);
  }

  // Last resort: no landmark anywhere above the label. Some cards carry no
  // role="article" and no pagelet, and their aria-posinset only as a descendant,
  // so every strategy above returns null. Climb to the outermost ancestor that is
  // still card-shaped and stop at the width jump into the feed column.
  //
  // For "unfollowed" the button must sit at the card's own author level - the rule
  // the mobile climb applies - or a Follow button inside a quoted post would take
  // out the whole card.
  if (reason === "unfollowed" && label.closest('[role="complementary"]')) return null;
  const card = climbToCard(label);
  if (card) {
    if (reason === "unfollowed" && !isAuthorLevelLabel(label, card)) return null;
    return card;
  }

  return null;
}

// --- Hide / restore ----------------------------------------------------------

// container element -> { reason, originalDisplay, placeholder, label }
const hiddenPosts = new Map();

// Sending a runtime message crosses a process boundary (content script ->
// background), which has real fixed overhead — batching rapid-fire
// hide/restore events (e.g. scrolling past many ads at once) into one
// message every 500ms instead of one per event cuts that down a lot,
// while the badge count still stays close enough to real-time.
const COUNT_FLUSH_MS = 500;
let pendingCountDelta = 0;
let countFlushScheduled = false;

// Reloading the extension leaves the already-injected copy of this script
// running in open tabs with a dead connection to the background — its
// "extension context" is gone. Chromium throws Error("Extension context
// invalidated") *synchronously* from sendMessage in that state, so .catch()
// does not help; it needs try/catch. Once it happens nothing can bring the
// connection back, so stop trying rather than throwing on every hide for the
// rest of the tab's life. The hiding itself is pure DOM work and keeps
// working — only the toolbar badge goes stale, until the tab is reloaded.
let backgroundGone = false;

function sendToBackground(message) {
  if (backgroundGone) return;
  try {
    const sent = browser.runtime.sendMessage(message);
    if (sent && typeof sent.catch === "function") sent.catch(() => {});
  } catch (err) {
    backgroundGone = true;
  }
}

function reportCount(delta) {
  pendingCountDelta += delta;
  if (countFlushScheduled) return;
  countFlushScheduled = true;
  setTimeout(() => {
    countFlushScheduled = false;
    const amount = pendingCountDelta;
    pendingCountDelta = 0;
    if (amount !== 0) sendToBackground({ type: "INCREMENT_COUNT", amount });
  }, COUNT_FLUSH_MS);
}

// The app banner is chrome, not content: a "Post hidden — Show" bar in its
// place would be more intrusive than the thing it replaced, and it isn't a
// post, so counting it would make the badge overstate what was filtered.
// Both of those are the only ways it differs from a hidden post.
function isPostReason(reason) {
  return reason !== "appbanner";
}

// How a post is taken out of the feed differs by layout, for a measured reason.
//
// Desktop removes the post outright: display:none, no space left behind.
//
// Mobile cannot. Facebook virtualises that feed and decides what to page in next
// by measuring rendered content, and it reacts to ANY attribute write on a
// direct child of the feed: in a control test an unstyled data attribute on six
// posts stopped the pager dead, while hiding the same posts' inner content left
// it paging normally. So the post element is untouchable - no style, no
// attribute. Both go on its children, with visibility rather than display so
// the post keeps its height. The cost is a blank gap where the ad was, accepted
// deliberately: blank space you can scroll past beats a feed that stops loading.
// See MOBILE-VIRTUALISATION.md.
function applyHide(container) {
  if (!isMobileLayout()) {
    container.style.setProperty("display", "none", "important");
    return { method: "display", targets: [container], marker: container };
  }

  // Mobile: the feed child is untouchable. Style every one of its element
  // children instead — that covers the post's whole visible content — and hang
  // the marker attribute on the first of them rather than on the post.
  const targets = Array.from(container.children);
  if (targets.length === 0) {
    // Nothing inside to hide. Falling back to the post itself will stall the
    // pager, but leaving an ad visible is worse, and a childless feed entry is
    // not a shape that has been observed.
    container.style.setProperty("visibility", "hidden", "important");
    return { method: "visibility", targets: [container], marker: container };
  }
  for (const t of targets) t.style.setProperty("visibility", "hidden", "important");
  return { method: "inner", targets, marker: targets[0] };
}

function undoHide(info) {
  const { method, targets, marker } = info.hide;
  if (method === "display") {
    targets[0].style.display = info.originalDisplay;
  } else {
    for (const t of targets) t.style.removeProperty("visibility");
  }
  delete marker.dataset.fbsbHidden;
}

// The marker no longer sits on the hidden post itself, so a mutation inside one
// resolves to a child. hiddenPosts is still keyed by the post, so step up once
// when the marker is not itself a key.
function hiddenContainerFor(node) {
  const marker = node.closest("[data-fbsb-hidden]");
  if (!marker) return null;
  if (hiddenPosts.has(marker)) return marker;
  const parent = marker.parentElement;
  return parent && hiddenPosts.has(parent) ? parent : null;
}

// A hide is not finished until it contains the line saying who posted it.
// Geometry alone kept stopping short: expandToCard stops at a parent holding two
// tall blocks, which is what a container of posts looks like - and also what one
// post with a tall picture and a tall block of text looks like - leaving the
// picture hidden and the rest of the post standing.
//
// The climb keeps every guard that keeps it inside ONE post - never into the
// page column, a viewer, above a hidden neighbour, or into a container holding
// another post - and if no byline is found within those bounds it leaves the
// hide as it was. It can widen a hide within a post, never into the feed.
function includesByline(node) {
  return pageNameFor(node) !== null;
}

// Another post, as opposed to another block of this one. A post's own header
// has a byline too, but it is short; a neighbouring post is card-sized.
function holdsAnotherPost(parent, self) {
  for (const child of parent.children) {
    if (child === self || child.contains(self)) continue;
    const r = child.getBoundingClientRect();
    if (r.width < FEED_POST_MIN_WIDTH || r.width > FEED_POST_MAX_WIDTH) continue;
    if (r.height < FEED_POST_MIN_HEIGHT) continue;
    if (includesByline(child)) return true;
  }
  return false;
}

function includeByline(node) {
  if (isMobileLayout() || includesByline(node)) return node;
  let best = node;
  for (let i = 0; i < SHAPE_MAX_CLIMB; i++) {
    const parent = best.parentElement;
    if (!parent || parent === document.body) break;
    const br = best.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    if (pr.width > FEED_POST_MAX_WIDTH) break;
    if (pr.width > br.width * DESKTOP_CARD_WIDTH_JUMP) break;
    if (pr.height > UNHIDDEN_MAX_HEIGHT) break;
    if (parent.querySelector('[role="dialog"]')) break;
    if (hasHiddenSibling(parent, best)) break;
    if (parent.querySelectorAll("[aria-posinset]").length > 1) break;
    if (holdsAnotherPost(parent, best)) break;
    best = parent;
    if (includesByline(best)) return best;
  }
  return node;
}

// The whole post, as far as it can safely be found.
function wholePost(node) {
  return includeByline(expandToCard(node));
}

// Whatever route chose this element, if it is feed-post width then the thing
// the user wants gone is the whole card, never a block inside it - so walk up
// until the next step would leave the card. Cheap, and it holds even if a
// climb elsewhere stops short again.
function expandToCard(node) {
  if (isMobileLayout()) return node;
  const r = node.getBoundingClientRect();
  // Feed cards only. The right-hand rail is 360 wide and stacks several
  // modules with no card-width child between them, so this would climb out of
  // one ad and take the whole column.
  if (r.width < FEED_POST_MIN_WIDTH || r.width > FEED_POST_MAX_WIDTH) return node;

  let best = node;
  for (let i = 0; i < SHAPE_MAX_CLIMB; i++) {
    const parent = best.parentElement;
    if (!parent || parent === document.body) break;
    const br = best.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    if (pr.width > FEED_POST_MAX_WIDTH) break;
    if (pr.width > br.width * DESKTOP_CARD_WIDTH_JUMP) break;
    if (pr.height > UNHIDDEN_MAX_HEIGHT) break;
    if (holdsSeveralCards(parent)) break;
    // Whatever else is up there, it is not part of this card if it holds the
    // photo viewer or the comment dialog.
    if (parent.querySelector('[role="dialog"]')) break;
    // holdsSeveralCards measures boxes, and a post we have already hidden has
    // no box - so a feed column whose other posts are all hidden looks exactly
    // like a single card, and the climb would take the entire feed. Ask
    // whether the siblings are posts rather than whether they are visible.
    if (hasHiddenSibling(parent, best)) break;
    best = parent;
  }
  return best;
}

function hasHiddenSibling(parent, self) {
  for (const child of parent.children) {
    if (child === self) continue;
    if (child.hasAttribute("data-fbsb-hidden")) return true;
    if (child.querySelector("[data-fbsb-hidden]")) return true;
  }
  return false;
}

// A post opened on purpose is not feed, and no rule here should touch it. Two
// ways a post is opened deliberately:
//
//   - It is inside a viewer (role="dialog"): a post clicked into, a photo, a
//     reel, a link followed from chat.
//   - The page IS that post - a permalink, loaded directly or from a link. The
//     right-hand rail is still filtered there; it is page furniture.
//
// Checked in hidePost because every rule ends up there. A group post shared in
// chat carries a "Join" button, and the unfollowed rule used to hide it inside
// the very viewer that had been opened for it.
const SINGLE_POST_PATH_RE =
  /\/(posts|permalink|videos|reel|photos)\/[^/]|\/(permalink|story|photo)\.php$|^\/photo\/?$|^\/share\/[a-z]\/|^\/marketplace\/item\/|^\/commerce\/listing\//;

// The harness cannot change its own address - it runs from a data: URL - so it
// sets this instead. Honoured only when the manifest reports the harness's
// stand-in version, so in a real install it does nothing at all - and a page
// script could not reach it anyway: content scripts run in an isolated world,
// and Facebook's globals are not ours.
function currentUrl() {
  const forced = globalThis.__FBSB_TEST_URL__;
  if (forced && browser.runtime.getManifest().version === "fixture") {
    try {
      return new URL(forced);
    } catch (e) {
      /* fall through to the real one */
    }
  }
  return location;
}

function isSinglePostPage() {
  const u = currentUrl();
  if (SINGLE_POST_PATH_RE.test(u.pathname)) return true;
  // /watch/ on its own is a feed of videos, with ads in it. /watch/?v=<id> is
  // one video.
  return /^\/watch\/?$/.test(u.pathname) && /[?&]v=/.test(u.search || "");
}

let openedPostsSpared = 0;

function wasOpenedOnPurpose(container) {
  if (container.closest('[role="dialog"]')) return true;
  if (isSinglePostPage() && !container.closest('[role="complementary"]')) return true;
  return false;
}

function hidePost(container, reason, label, via) {
  if (isPostReason(reason)) container = wholePost(container);
  if (isPostReason(reason) && wasOpenedOnPurpose(container)) {
    openedPostsSpared += 1;
    return;
  }
  const originalDisplay = container.style.display || "";
  let placeholder = null;

  if (settings.placeholderMode && isPostReason(reason)) {
    placeholder = document.createElement("div");
    placeholder.className = "fbsb-placeholder";

    const PLACEHOLDER_TEXT = {
      sponsored: "Sponsored post hidden",
      suggested: "Suggested post hidden",
      unfollowed: "Unfollowed page's post hidden",
    };
    const label = document.createElement("span");
    label.textContent = PLACEHOLDER_TEXT[reason] || "Post hidden";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fbsb-show-btn";
    btn.textContent = "Show";
    btn.addEventListener("click", () => restorePost(container));

    placeholder.appendChild(label);
    placeholder.appendChild(btn);

    // Only the shape rule can be wrong about a post, so only its placeholders
    // offer this. It names the page rather than this one post, because a post
    // id does not survive a reload and a page name does.
    if (via === "shape") {
      const page = pageNameFor(container);
      if (page) {
        const keep = document.createElement("button");
        keep.type = "button";
        keep.className = "fbsb-show-btn fbsb-keep-btn";
        keep.textContent = "Not an ad";
        keep.title = "Never hide posts from " + page;
        keep.addEventListener("click", () => {
          addToPageList("keepPages", page);
          restorePost(container);
        });
        placeholder.appendChild(keep);
      }
    }
    container.insertAdjacentElement("beforebegin", placeholder);
  }

  // Before the hide, while the element still has dimensions to report.
  noteHiddenSample(container, reason, via || "label");

  const hide = applyHide(container);
  hide.marker.dataset.fbsbHidden = reason;
  hiddenPosts.set(container, { reason, originalDisplay, placeholder, label, hide });
  if (isPostReason(reason)) reportCount(1);
}

function restorePost(container) {
  const info = hiddenPosts.get(container);
  if (!info) return;
  undoHide(info);
  if (info.placeholder) info.placeholder.remove();
  hiddenPosts.delete(container);
  if (isPostReason(info.reason)) reportCount(-1);
}

// Facebook builds its photo and comment viewers by reusing nodes already on the
// page, sometimes inside a card we have hidden - the viewer then renders into
// display:none and the user clicks through to a blank screen. Whatever earned
// the hide, a viewer inside it means the hide is now doing harm, so give it back
// immediately rather than working out why.
let viewersReleased = 0;

// A viewer anywhere in this card, above or below the given element, up to the
// point where the climb would leave the card.
function nearViewer(el) {
  if (el.closest('[role="dialog"]')) return true;
  let node = el;
  for (let i = 0; i < SHAPE_MAX_CLIMB && node && node !== document.body; i++) {
    if (node.querySelector('[role="dialog"]')) return true;
    if (node.getBoundingClientRect().width > FEED_POST_MAX_WIDTH) break;
    node = node.parentElement;
  }
  return false;
}

function releaseHiddenAround(dialog) {
  for (const [container] of hiddenPosts) {
    if (container.contains(dialog) || dialog.contains(container)) {
      viewersReleased += 1;
      restorePost(container);
    }
  }
}

// The in-feed "This is an ad" control.
//
// One button, appended to <body> and positioned over whichever card the
// pointer is on. Deliberately NOT injected into the card: writing into feed
// children is what stalls Facebook's pager on mobile, and every piece of UI
// added to a Facebook subtree is a hostage to the next markup change. A single
// fixed-position element that only reads geometry cannot do either.
const MARKER_ID = "fbsb-mark";
let markerEl = null;
let markerCard = null;

function feedCardUnder(node) {
  let el = node;
  for (let i = 0; i < SHAPE_MAX_CLIMB && el && el !== document.body; i++) {
    if (el.nodeType === Node.ELEMENT_NODE) {
      const r = el.getBoundingClientRect();
      if (
        r.width >= FEED_POST_MIN_WIDTH && r.width <= FEED_POST_MAX_WIDTH &&
        r.height >= FEED_POST_MIN_HEIGHT && r.height <= UNHIDDEN_MAX_HEIGHT &&
        !holdsSeveralCards(el)
      ) {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

let markerMedia = null;

// The post's main picture or video - the largest one in the card. Avatars,
// reaction icons and emoji are all far below this, so they never qualify.
const MARKER_MEDIA_MIN_WIDTH = 200;
const MARKER_MEDIA_MIN_HEIGHT = 150;

function mainMediaOf(card) {
  let best = null;
  let bestArea = 0;
  for (const m of card.querySelectorAll("img, video")) {
    const r = m.getBoundingClientRect();
    if (r.width < MARKER_MEDIA_MIN_WIDTH || r.height < MARKER_MEDIA_MIN_HEIGHT) continue;
    if (r.width * r.height > bestArea) {
      best = m;
      bestArea = r.width * r.height;
    }
  }
  return best;
}

function hideMarker() {
  markerCard = null;
  markerMedia = null;
  if (markerEl) markerEl.style.display = "none";
}

function ensureMarker() {
  if (markerEl) return markerEl;
  markerEl = document.createElement("button");
  markerEl.type = "button";
  markerEl.id = MARKER_ID;
  markerEl.textContent = "This is an ad";
  markerEl.style.display = "none";
  markerEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!markerCard) return;
    const card = markerCard;
    const page = pageNameFor(card);
    hideMarker();
    // Hide the post whether or not its page could be named: the click asked
    // for this ad to go, and a page with no readable name is no reason to
    // leave it standing.
    if (page) addToPageList("adPages", page);
    if (!hiddenPosts.has(card)) hidePost(card, "sponsored", card, "marked");
  });
  document.body.appendChild(markerEl);
  return markerEl;
}

function positionMarkerOver(card, media) {
  const el = ensureMarker();
  const r = media.getBoundingClientRect();
  markerCard = card;
  markerMedia = media;
  el.style.display = "block";
  el.style.top = Math.max(4, r.top + 8) + "px";
  el.style.left = r.left + 8 + "px";
}

// Its own setting and nothing else: marking is most useful precisely when ads
// are getting through, so it must not depend on the rules that hide them.
function markerEnabled() {
  return settings.showMarkers && !isMobileLayout();
}

document.addEventListener(
  "mouseover",
  (e) => {
    if (!markerEnabled()) return;
    if (markerEl && e.target === markerEl) return;
    const inner = feedCardUnder(e.target);
    if (!inner || inner.closest("[data-fbsb-hidden]") || inner.closest('[role="dialog"]')) {
      hideMarker();
      return;
    }
    // Over the picture and nowhere else, and the click takes the whole post.
    // Measured by position rather than by what the pointer is on: Facebook lays
    // transparent layers over its images, so the element under the pointer is
    // rarely the <img> itself.
    const card = wholePost(inner);
    const media = mainMediaOf(card);
    if (!media) {
      hideMarker();
      return;
    }
    const r = media.getBoundingClientRect();
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!over) {
      hideMarker();
      return;
    }
    if (card !== markerCard || media !== markerMedia) positionMarkerOver(card, media);
  },
  true
);

// Geometry read on hover goes stale the moment the page moves.
window.addEventListener("scroll", hideMarker, { passive: true, capture: true });

// Every hidden post is remembered so it can be put back, and only restoring one
// used to forget it - so a hidden post Facebook removed from the page stayed in
// memory, whole, until the tab closed. Entries for posts no longer on the page
// are dropped, with the hide undone on the way out: Facebook reuses nodes, and
// one that came back still carrying our hide but missing from the map could
// never be restored. Undone, it comes back clean and is scanned again.
const PRUNE_INTERVAL_MS = 5000;
let lastPruneAt = 0;
let hiddenPostsPruned = 0;

function pruneRemovedPosts(now) {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  for (const [container, info] of hiddenPosts) {
    if (container.isConnected) continue;
    undoHide(info);
    if (info.placeholder) info.placeholder.remove();
    hiddenPosts.delete(container);
    hiddenPostsPruned += 1;
  }
}

function restoreByReason(reason) {
  for (const [container, info] of hiddenPosts) {
    if (info.reason === reason) restorePost(container);
  }
}

// --- Retry queue ---------------------------------------------------------

// Facebook streams some ad content in via a hidden React Suspense staging
// node (<div hidden id="S:n">) and reparents it into its real spot (feed or
// sidebar) a moment later, so a label can match before its post container
// exists yet. Some widgets (e.g. the sidebar sponsored module) also refresh
// themselves every few seconds, recreating the element entirely. Retrying
// briefly instead of giving up immediately catches both cases; a short
// interval keeps the window where a swapped-in ad is visible as small as
// possible.
const RETRY_WINDOW_MS = 8000;
// The interval is the window in which a staged ad, once reparented into the
// feed, is on screen before we hide it — a visible-flash budget rather than a
// polling preference, so shorter is better *provided the queue stays small*.
// It was briefly 16ms; combined with over-eager queueing that was enough to
// stall the feed. 50ms is the value that has run without trouble.
const RETRY_INTERVAL_MS = 50;
// A hard ceiling so a future change that queues too eagerly degrades detection
// instead of the page. Nothing legitimate needs more than a few entries: this
// queue exists for ads staged in a hidden node, not for bulk rechecking.
const MAX_PENDING_LABELS = 40;
const pendingLabels = new Map(); // label -> first-seen timestamp

// Facebook also litters the page with decoy/portal duplicate elements that
// read as a real label (e.g. bare "Sponsored" spans reused for tooltips)
// but can never resolve to a post container — they sit only 2-5 levels
// below <body>, whereas every real post we've found this whole session
// sits 15+ levels deep. Filtering those out before they ever enter the
// retry queue avoids paying for ~80 pointless rechecks (8s at 100ms) per
// decoy, which otherwise adds up fast since new ones keep appearing while
// scrolling.
const SHALLOW_DEPTH_LIMIT = 10;
// Mobile needs its own number, because the threshold only means anything
// relative to how deep the page nests. Weblite's whole document is about 11
// levels and a feed ad's label sits 10 steps below <body>, so the desktop limit
// discarded every real ad as a decoy. 4 keeps the intent - anything parked
// directly under <body> is not a post - while leaving room for a tree this
// shallow.
const MOBILE_SHALLOW_DEPTH_LIMIT = 4;

function isImplausiblyShallow(el) {
  const limit = isMobileLayout() ? MOBILE_SHALLOW_DEPTH_LIMIT : SHALLOW_DEPTH_LIMIT;
  let node = el;
  for (let depth = 0; depth < limit; depth++) {
    node = node && node.parentElement;
    if (!node) return false;
    if (node === document.body) return true;
  }
  return false;
}

function tryHideFromLabel(label, reason) {
  const container = findPostContainer(label, reason);
  if (!container) return false;
  if (!hiddenPosts.has(container)) hidePost(container, reason, label);
  return true;
}

// Accessibility-label targets - the <span id="_r_..._"> an ad's aria-labelledby
// points at - are parked outside the post they describe. They classify, but can
// never resolve to a post themselves. classifyLabel resolves the relationship
// from the referencing element, but only if the span already existed when the
// post was scanned, and Facebook often creates the post first and the span
// moments later, after which nothing looks at the post again. The span's own
// insertion is a mutation we observe, so use it to walk forward to whoever
// references it. `~=` matches one entry of a space-separated list, which is what
// aria-labelledby is.
function resolveViaReferrer(label) {
  if (!label.id) return false;
  const id = CSS.escape(label.id);
  // Two ways to point at a label target: aria-labelledby from an ordinary
  // element, or xlink:href from an <svg><use> that draws it as a sprite - the form
  // many feed ads use. `*|href` matches href in any namespace.
  const referrer =
    document.querySelector(`[aria-labelledby~="${id}"]`) ||
    document.querySelector(`use[*|href="#${id}"]`);
  if (!referrer || referrer === label) return false;
  processLabel(referrer);
  return true;
}

function processLabel(label) {
  // Diagnostic only: mark everything we examine, so it's possible to tell
  // "we looked and didn't match" apart from "we never looked". Those need
  // completely different fixes and are indistinguishable from the outside.
  if (DEBUG && label.dataset) label.dataset.fbsbSeen = "1";

  const reason = classifyLabel(label);
  if (!reason) {
    // NOTE: do not queue elements just because their aria-labelledby does not
    // resolve. Facebook has a great many dangling label references, so the retry
    // queue floods and each is re-examined every tick for the full retry window. It
    // froze the feed, and never showed in the scan timing because the retry loop
    // does not call scanRoot.
    return;
  }

  // Portal spans sit a few levels below <body>. Bail before doing anything
  // else with them: no retry queue, no logging (each log holds a live DOM
  // reference that devtools then retains and renders), and no match count —
  // counting them made sponsored detection look like it was working when
  // every match was one of these and no real ad had been seen at all.
  if (isImplausiblyShallow(label)) {
    resolveViaReferrer(label);
    return;
  }

  if (DEBUG) stats.matched[reason] = (stats.matched[reason] || 0) + 1;
  noteLabelClassified();

  // Cleared before the attempt so it can only describe this one, and read
  // immediately after: resolveViaReferrer below re-enters processLabel and
  // would otherwise overwrite it.
  deferredUnrendered = false;
  const resolved = tryHideFromLabel(label, reason);
  const deferred = deferredUnrendered;
  if (resolved) {
    if (DEBUG) stats.hidden += 1;
    noteLabelAnchored();
    return;
  }
  noteLabelUnresolved(deferred);

  // A label that classifies but can't be anchored may still be a portal span
  // that simply sits deeper than the shallow check's threshold — Facebook
  // does not park them at a fixed depth. Tying the recovery to *where* the
  // span sits was wrong; tie it to what actually went wrong. Anything holding
  // an id that something else points at gets one forward hop before we give
  // up and start retrying it.
  if (resolveViaReferrer(label)) return;

  if (DEBUG) logUnresolved(label, reason);

  // The retry queue exists for ads that Facebook stages in a hidden node and
  // reparents a moment later. An unfollowed label has no such race: the Follow
  // button and the author header it belongs to are rendered together, so if it
  // didn't resolve now it never will — and a quoted post's Follow button is
  // rejected deliberately, not provisionally. Queueing those just burns the
  // 50ms loop for 8s each.
  if (reason === "unfollowed") return;

  // Nor a label whose post Facebook hasn't rendered yet. Retrying cannot succeed:
  // the candidate has no box until Facebook reveals it, which the
  // IntersectionObserver is already waiting for. On a virtualised feed most
  // sponsored labels land here, and queueing them floods the retry loop with
  // entries re-examined every 50ms that can never resolve.
  if (deferred) return;

  if (!pendingLabels.has(label) && pendingLabels.size < MAX_PENDING_LABELS) {
    pendingLabels.set(label, Date.now());
    ensureRetryLoopRunning();
  }
}

// --- Breakage detection ----------------------------------------------------

// Everything on mobile is gated on one class name and the app banner on one
// selector, both Facebook's. When either is renamed the symptom is silence:
// labels still classify, nothing anchors, and the extension looks healthy while
// hiding nothing. "We classified labels and anchored none of them" catches any
// structural change on either layout, not just the rename we thought of - for
// two integer increments per label.
//
// Not DEBUG-gated: a silent failure that only becomes audible in a build the
// user isn't running is still a silent failure.
const BREAKAGE_MIN_LABELS = 20;
let labelsClassified = 0;
let labelsAnchored = 0;
let labelsDeferred = 0;
let breakageWarned = false;

// Set by findMobilePostContainer when it rejects a candidate that has no box
// because Facebook has not rendered it yet. Read once, immediately after the
// resolution attempt that set it.
let deferredUnrendered = false;

function noteLabelAnchored() {
  labelsAnchored += 1;
}

function noteLabelClassified() {
  labelsClassified += 1;
}

// Called once per label that classified but could not be anchored. A miss on a
// virtualised-out post is not breakage - those are deferred to the reveal
// observer by design - so it is not counted. Anchoring even one label settles
// the question for this page: some posts resolving and others not is ordinary.
function noteLabelUnresolved(deferred) {
  if (deferred) {
    labelsDeferred += 1;
    return;
  }
  if (breakageWarned || labelsAnchored > 0) return;
  if (labelsClassified - labelsDeferred < BREAKAGE_MIN_LABELS) return;
  breakageWarned = true;

  const mobile = isMobileLayout();
  console.warn(
    `[fbsb] ${labelsClassified} labels matched, none could be anchored to a post. ` +
    `Detection works; container resolution does not — which is what happens when ` +
    `Facebook renames the structure this keys off.\n` +
    `  layout gate: ${mobile ? "mobile" : "desktop"} ` +
    `(<body class> ${mobile ? "has" : "lacks"} "${MOBILE_BODY_CLASS}")\n` +
    `  build: ${browser.runtime.getManifest().version}\n` +
    `  If this is a phone, the mobile class was probably renamed. If it is a ` +
    `desktop feed, the ARIA landmarks were.`
  );
}

// The banner is the one target anchored by selector rather than by climbing,
// so it fails on its own schedule and says so on its own. Reaching here means
// the text matched and the layout gate passed, so a miss is unambiguous: the
// selector is stale. No threshold needed — there is only ever one of these.
let appBannerWarned = false;

function warnAppBannerAnchorLost(label) {
  if (appBannerWarned) return;
  appBannerWarned = true;
  console.warn(
    `[fbsb] found an "Open app" bar but "${APP_BANNER_SELECTOR}" no longer matches ` +
    `any ancestor of it — the bar will not be hidden. Those class names have ` +
    `presumably been renamed.\n` +
    `  build: ${browser.runtime.getManifest().version}`
  );
  if (DEBUG) console.log("[fbsb] unanchored app banner label:", label);
}

// --- Diagnostics readable on a phone ---------------------------------------

// Firefox for Android has no devtools UI, so the console is unreadable on the
// one platform whose layout is hardest to reason about. Everything below exists
// so the popup can show, on the device, what the console would have said. Not
// DEBUG-gated: phones install from AMO, so a debug-only panel would never reach
// them. The cost is a small bounded array.
const DIAG_SAMPLE_LIMIT = 8;
const diagSamples = [];

// Plain data, never element references: the note on logUnresolved applies here
// too, and these outlive the hide by design.
function describeNode(el) {
  if (!el || !el.tagName) return null;
  const cls = (el.className || "").toString().trim().split(/\s+/).filter(Boolean);
  return {
    tag: el.tagName.toLowerCase(),
    cls: cls.slice(0, 2).join(" ").slice(0, 32),
    kids: el.children ? el.children.length : 0,
    w: Math.round(el.offsetWidth || 0),
    h: Math.round(el.offsetHeight || 0),
  };
}

// MUST be called before the element is hidden. display:none zeroes offsetWidth
// and offsetHeight, and those two numbers are the entire point: they are what
// distinguishes "we hid the post" from "we hid the post's insides and left its
// wrapper holding the space", which on a feed looks like a gap you scroll past.
const DIAG_CHAIN_DEPTH = 4;

// The LATEST hides, not the first: a problem noticed mid-scroll is almost never
// among the first eight posts of the session.
function noteHiddenSample(container, reason, via) {
  if (diagSamples.length >= DIAG_SAMPLE_LIMIT) diagSamples.shift();
  const chain = [];
  let n = container;
  for (let i = 0; i < DIAG_CHAIN_DEPTH && n && n !== document.body; i++) {
    chain.push(describeNode(n));
    n = n.parentElement;
  }
  // Which rule chose this element. Every route reports "sponsored", so without
  // this a wrong hide looks the same whichever rule produced it.
  diagSamples.push({ reason, via, chain });
}

// What does a post we FAILED to hide look like? The page console cannot answer
// reliably - Facebook deletes its own label nodes within moments, so successive
// probes disagree. This runs on demand when the popup asks, sees the same
// document the scan sees, and reports the small leaf texts inside each unhidden
// card, which is where "Ad"/"Sponsored" lives whatever wraps it. Costs nothing
// until the panel is opened.
const UNHIDDEN_SAMPLE_LIMIT = 4;
// A feed card is a few hundred pixels tall. Without an upper bound the
// outermost-wins rule below selects the entire feed column, which contains every
// card, so they all get filtered out as nested inside it.
const UNHIDDEN_MAX_HEIGHT = 1800;
// The feed column's own width, to tell posts from page furniture.
const FEED_POST_MIN_WIDTH = 600;
const FEED_POST_MAX_WIDTH = 760;
const FEED_POST_MIN_HEIGHT = 300;

// Counted across the WHOLE feed, not just what is on screen: a viewport sample
// reads "no unhidden ads" while a page full of them scrolls past above and
// below.
function surveyFeedCards() {
  const candidates = [];
  for (const el of document.querySelectorAll("div")) {
    const r = el.getBoundingClientRect();
    // Feed-post width specifically. The left nav is 360 and the chat window 338,
    // and counting those made "not hidden: 21" look like 21 unblocked ads when
    // most of them were page furniture.
    if (r.width < FEED_POST_MIN_WIDTH || r.width > FEED_POST_MAX_WIDTH) continue;
    if (r.height < FEED_POST_MIN_HEIGHT || r.height > UNHIDDEN_MAX_HEIGHT) continue;
    candidates.push(el);
  }
  // Keep only the outermost of each nested run, so one card counts once.
  const outer = candidates.filter((el) => !candidates.some((o) => o !== el && o.contains(el)));
  const visible = outer
    .filter((el) => !el.querySelector("[data-fbsb-hidden]") && !el.closest("[data-fbsb-hidden]"))
    // Not posts: boxes Facebook leaves behind holding a scroll position. They are
    // feed-width and several hundred pixels tall, so without this they count as
    // unhidden posts.
    .filter((el) => el.querySelectorAll("a[href]").length > 0 || (el.textContent || "").trim().length > 0);
  // Whether each visible card's byline reference dangles or resolves. An ad's
  // points at a label Facebook deletes after computing the accessible name; an
  // organic post's resolves to a timestamp. The shape rule acts on this; the
  // survey counts it so the split can be checked across a whole feed.
  let withDangling = 0;
  let withResolving = 0;
  for (const el of visible) {
    let dangling = false;
    let resolving = false;
    for (const e of el.querySelectorAll("[aria-labelledby]")) {
      for (const { text } of labelRefTexts(e)) {
        if (text) resolving = true;
        else dangling = true;
      }
    }
    if (dangling) withDangling += 1;
    if (resolving && !dangling) withResolving += 1;
  }

  return {
    // hiddenPosts is authoritative. A hidden post is display:none, so it has no box,
    // fails every size filter above, and cannot be counted by looking at the page.
    hidden: hiddenPosts.size,
    visible,
    withDangling,
    withResolving,
  };
}

function sampleUnhiddenPosts() {
  const out = [];
  const survey = surveyFeedCards();
  // Prefer cards on screen - they are the ones being complained about - but
  // fall back to the rest of the page rather than reporting nothing.
  const onScreen = survey.visible.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  });
  const offScreen = survey.visible.filter((el) => !onScreen.includes(el));
  const outer = onScreen.concat(offScreen);

  for (const el of outer.slice(0, UNHIDDEN_SAMPLE_LIMIT)) {
    const r = el.getBoundingClientRect();
    const labels = [];
    const seenText = new Set();
    for (const leaf of el.querySelectorAll("*")) {
      if (labels.length >= 12) break;
      // Non-leaves are reported by their OWN text only, the way classifyLabel reads
      // them - otherwise the report shares the detector's blind spot, and an "Ad"
      // sharing an element with an icon is invisible in both.
      const own = leaf.children.length ? ownText(leaf) : leaf.textContent;
      if (!own) continue;
      const t = own.replace(INVISIBLE_CHARS_RE, "").trim();
      if (!t || t.length > 20) continue;
      // Icon <title> elements are leaves with text and no box, and a card holds
      // dozens of them all reading the same thing. Unfiltered they crowd out
      // every label that matters - the first report came back as ten identical
      // span:"Facebook" entries. Only what actually renders, and only once.
      const lr = leaf.getBoundingClientRect();
      if (lr.width === 0 || lr.height === 0) continue;
      if (seenText.has(t)) continue;
      seenText.add(t);
      labels.push(`${leaf.tagName.toLowerCase()}${leaf.children.length ? "*" : ""}:"${t}"`);
    }
    // An ad card can show the "·" that follows "Ad" in the byline with no "Ad" text
    // anywhere, because the label is drawn some non-textual way. These three cover
    // every remaining mechanism - a sprite reference, an accessible name pointing
    // elsewhere, and a plain aria-label - so whichever carries "Ad" shows up here.
    const evidence = [];
    for (const u of el.querySelectorAll("use")) {
      if (evidence.length >= 6) break;
      const href = u.getAttribute("xlink:href") || u.getAttribute("href") || "";
      if (!href.startsWith("#")) continue;
      const target = document.getElementById(href.slice(1));
      const text = target ? target.textContent.replace(INVISIBLE_CHARS_RE, "").trim() : "";
      if (text && text.length <= 25) evidence.push(`use${href}->"${text}"`);
    }
    for (const e of el.querySelectorAll("[aria-labelledby]")) {
      if (evidence.length >= 10) break;
      for (const { id, text } of labelRefTexts(e)) {
        if (text && text.length <= 25) {
          evidence.push(`by#${id}->"${text}"`);
        } else if (!text) {
          // A reference whose target is gone AND was never cached. Silently
          // skipping these made a card look label-less when in fact it points
          // at a label we never saw - a very different problem, and the one
          // 125-of-128 label deletions would produce. Facebook removes these
          // spans moments after the accessible name is computed.
          evidence.push(`by#${id}->MISSING`);
        }
      }
    }
    // Where the card's links point. The /ads/about explainer link marks an ad, so
    // when a card is not hidden the first question is whether it has one. Paths
    // only: Facebook's query strings are enormous and say nothing.
    for (const a of el.querySelectorAll("a[href]")) {
      if (evidence.length >= 12) break;
      const path = linkPath(a);
      if (!path) continue;
      evidence.push(`href:${path.slice(0, 28)}`);
    }

    for (const e of el.querySelectorAll("[aria-label]")) {
      if (evidence.length >= 14) break;
      const a = e.getAttribute("aria-label");
      if (a && a.length <= 30) evidence.push(`aria:"${a}"`);
    }

    // closest(), not getAttribute(): the landmark is rarely on the outermost
    // div of a card, and reporting only that div's own attributes made every
    // card look landmark-less - including ones the extension anchors fine.
    const near = (sel) => (el.closest(sel) ? "self/anc" : el.querySelector(sel) ? "descendant" : "-");
    out.push({
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      cls: (el.className || "").toString().trim().split(/\s+/).slice(0, 2).join(" ") || "-",
      role: near('[role="article"]'),
      posinset: near("[aria-posinset]"),
      pagelet: near('[data-pagelet^="FeedUnit"]'),
      labels,
      // Links first: aria-labels used to crowd them out of the budget, and the cut
      // fell exactly where the answer was.
      evidence: [...new Set(evidence.filter((e) => e.startsWith("href:")))]
        .slice(0, 12)
        .concat([...new Set(evidence.filter((e) => !e.startsWith("href:")))].slice(0, 8)),
      // Five counts that tell a post from an empty box holding a scroll position,
      // which reads a=0 img=0 text=0 where a real post never does.
      shape: `els=${el.querySelectorAll("*").length} a=${el.querySelectorAll("a[href]").length} img=${el.querySelectorAll("img,video,canvas").length} text=${(el.textContent || "").trim().length}`,
    });
  }
  return out;
}

function buildDiagnostics() {
  const mobile = isMobileLayout();
  return {
    version: browser.runtime.getManifest().version,
    // "pending"/"waiting for <body>" here means startup never completed, which
    // is invisible from the page: the popup still answers because its listener
    // registers before the observer is attached.
    boot: bootState,
    layout: mobile ? "mobile" : "desktop",
    bodyClass: mobile ? MOBILE_BODY_CLASS : (document.body.className || "").toString().slice(0, 60),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    classified: labelsClassified,
    anchored: labelsAnchored,
    // Labels whose post Facebook had not rendered yet. Expected on mobile, and
    // retried when the reveal observer sees them — a large number here beside a
    // healthy anchored count is the system working, not failing.
    deferred: labelsDeferred,
    reveals: revealScans,
    lateText: lateTextLabels,
    rescued: rescuedLabels,
    unlabeled: unlabeledAdsHidden,
    shapeHides: shapeHides.slice(),
    released: viewersReleased,
    spared: openedPostsSpared,
    pruned: hiddenPostsPruned,
    remembered: hiddenPosts.size,
    // Hides that do not contain who posted it: a picture taken out of a post
    // that is otherwise still standing. Should be zero; anything else is this
    // bug again, and the samples below show where.
    partial: (() => {
      if (isMobileLayout()) return 0;
      let n = 0;
      for (const [container] of hiddenPosts) {
        if (!container.isConnected) continue;
        if (container.closest('[role="complementary"]')) continue;
        if (!includesByline(container)) n += 1;
      }
      return n;
    })(),
    // Cumulative since page load in a release build — reportStats returns early
    // when DEBUG is false, so nothing resets these. In a DEBUG build they are a
    // rolling 2s window instead, which is worth remembering before comparing
    // figures between the two.
    timing: {
      scanMs: stats.ms,
      scans: stats.scans,
      elements: stats.elements,
      observerMs: stats.observerMs,
      observerCalls: stats.observerCalls,
      retryMs: stats.retryMs,
      retryTicks: stats.retryTicks,
      uptimeMs: performance.now(),
    },
    hidden: hiddenPosts.size,
    pending: pendingLabels.size,
    thresholds: `kids>=${MOBILE_FEED_MIN_CHILDREN} width>=${MOBILE_MIN_WIDTH_RATIO}`,
    // Whether the reveal observer has a feed to watch is the first thing to
    // check when mobile filters nothing: no feed means no reveals are seen,
    // and only the posts rendered at load ever get examined.
    feed: mobileFeed
      ? `watching ${mobileFeed.children.length} children (reveal margin ${REVEAL_MARGIN})`
      : "not identified",
    samples: diagSamples,
    unhidden: sampleUnhiddenPosts(),
    survey: (() => {
      const v = surveyFeedCards();
      return {
        hidden: v.hidden,
        visible: v.visible.length,
        dangling: v.withDangling,
        resolving: v.withResolving,
      };
    })(),
  };
}

// The popup asks the content script directly (tabs.sendMessage), which needs no
// "tabs" permission — the facebook.com host permission already covers it. The
// sendResponse form is used for the same cross-browser reason as background.js.
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "GET_DIAGNOSTICS") {
    sendResponse(buildDiagnostics());
    return true;
  }
  return false;
});

// Diagnostics must not become their own performance problem. Repeats of the
// same unresolved shape teach nothing after the first few, and the volume is
// what makes the page unusable rather than merely noisy — so cap it, and log
// the chain as a plain string instead of handing devtools an element to retain.
const UNRESOLVED_LOG_LIMIT = 15;
let unresolvedLogged = 0;

function logUnresolved(label, reason) {
  if (unresolvedLogged >= UNRESOLVED_LOG_LIMIT) return;
  unresolvedLogged += 1;
  const chain = [];
  let n = label;
  for (let i = 0; n && i < 30; i++) {
    const attr = (name) => (n.getAttribute && n.getAttribute(name)) || "-";
    chain.push(
      `<${n.tagName.toLowerCase()} role=${attr("role")} posinset=${attr("aria-posinset")} pagelet=${attr("data-pagelet")} class="${(n.className || "").toString().slice(0, 40)}">`
    );
    n = n.parentElement;
  }
  const aria = (label.getAttribute && label.getAttribute("aria-label")) || "";
  console.log(
    `[fbsb] UNRESOLVED ${reason}${aria ? ` aria="${aria}"` : ""} ` +
    `(${unresolvedLogged}/${UNRESOLVED_LOG_LIMIT})\n${chain.join("\n")}`
  );
  if (unresolvedLogged === UNRESOLVED_LOG_LIMIT) {
    console.log("[fbsb] further UNRESOLVED logs suppressed");
  }
}

function retryPendingLabels() {
  // The retry loop never calls scanRoot, so the scan timer cannot see it; a
  // growing queue re-examined every 50ms only shows up as a number if it is timed
  // separately.
  const retryStartedAt = performance.now();
  const now = Date.now();
  for (const [label, firstSeenAt] of pendingLabels) {
    if (!label.isConnected || now - firstSeenAt > RETRY_WINDOW_MS) {
      pendingLabels.delete(label);
      continue;
    }
    const reason = classifyLabel(label);
    if (!reason) {
      // Entries here matched when they were queued; if one no longer
      // classifies, the node was recycled and there is nothing left to wait
      // for.
      pendingLabels.delete(label);
      continue;
    }
    if (tryHideFromLabel(label, reason)) {
      if (DEBUG) console.log("[fbsb] resolved on retry", label);
      // Counts as anchoring: this path bypasses processLabel, and without it a
      // feed whose ads all resolve a beat late would look like total breakage.
      noteLabelAnchored();
      pendingLabels.delete(label);
    }
  }
  stats.retryMs += performance.now() - retryStartedAt;
  stats.retryTicks += 1;
}

// Run the retry loop only while there's actually something pending,
// instead of a permanent 10Hz timer for the entire lifetime of the tab —
// most of a browsing session has nothing waiting to retry, and profiling
// showed timer overhead as a real, avoidable ambient cost.
let retryIntervalId = null;

function ensureRetryLoopRunning() {
  if (retryIntervalId !== null) return;
  retryIntervalId = setInterval(() => {
    retryPendingLabels();
    if (pendingLabels.size === 0) {
      clearInterval(retryIntervalId);
      retryIntervalId = null;
    }
  }, RETRY_INTERVAL_MS);
}

// --- Scanning + mutation observing ----------------------------------------

// Some ads' labels are ephemeral: Facebook inserts the portal span, the browser
// computes the post's accessible name from it, and the span is removed again -
// sometimes within the same frame. Scanning waits for requestAnimationFrame and
// skips disconnected roots, so such a span would never be examined. Recording
// its text synchronously in the observer callback, the one moment it is
// guaranteed to exist, is what makes those ads detectable. Bounded, oldest
// first, because Facebook mints these continuously.
const MAX_LABEL_CACHE = 200;
const labelTextById = new Map();
// How many labels completed via a late text node rather than arriving whole.
// Zero on a feed with ads means that is not how they are being built any more.
let lateTextLabels = 0;
// Labels recovered from a removal record rather than an insertion - see the
// note in the observer. Non-zero means Facebook is deleting labels faster than
// an async callback can read them, which is invisible any other way.
let rescuedLabels = 0;
// Posts hidden by shape rather than by label. If this is climbing while the
// user reports missing posts, that rule is the first thing to switch off.
let unlabeledAdsHidden = 0;

function rememberLabelTarget(el) {
  if (!el.id) return;
  cacheLabelText(el.id, el.textContent, el);
}

// Separated from rememberLabelTarget so a label can be rescued from a removal
// record, where there is an id and a string but the element may already be
// detached and emptied. `source` is only used to resolve forward from.
function cacheLabelText(id, raw, source) {
  const text = (raw || "").replace(INVISIBLE_CHARS_RE, "").trim();
  if (!text || text.length > 40) return;
  const el = { id, textContent: text };
  if (labelTextById.size >= MAX_LABEL_CACHE) {
    labelTextById.delete(labelTextById.keys().next().value);
  }
  labelTextById.set(el.id, text);

  // Caching alone isn't enough: the post was scanned before this label
  // existed, found nothing, and nothing re-examines it. Resolve forward now,
  // while the relationship is finally complete. Restricted to the labels we
  // act on so this stays a rare O(1) lookup rather than a querySelector for
  // every id Facebook adds.
  if (SPONSORED_TEXTS.has(text) || SUGGESTED_TEXTS.has(text)) {
    // The cache lives in the isolated world, so it can't be inspected from the
    // page console. Log the one event that matters instead: an ad's label
    // target existing long enough for us to see it. Silence here means the
    // span was never inserted while we were observing, which is a different
    // problem from seeing it and failing to anchor it to a post.
    const resolved = resolveViaReferrer(source && source.id ? source : { id });
    if (DEBUG) {
      console.log(`[fbsb] cached label #${el.id} = "${text}" -> referrer ${resolved ? "found" : "NOT FOUND"}`);
    }
    return;
  }
}

function cacheLabelTargets(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (node.id) rememberLabelTarget(node);
  if (node.querySelectorAll) {
    for (const el of node.querySelectorAll("[id]")) rememberLabelTarget(el);
  }
}

// Elements that can carry a label, beyond spans, links and labelled elements:
//   - use: sprite-rendered labels carry no text of their own - see the
//     reference-following branch in classifyLabel.
//   - text: some labels are SVG <text> rather than a <span>.
//   - [role="button"]: on desktop the Follow button is a <div>. Matching the
//     role rather than every div keeps the cost proportional to the page's
//     controls, not its markup.
const LABEL_SELECTOR = 'span, a, use, text, [aria-label], [aria-labelledby], [role="button"]';

// Self-instrumentation. Whether this extension is what's stalling the feed is
// answerable with numbers rather than argument, and a synthetic page doesn't
// reproduce a real feed well enough to answer it — so measure in place and
// report a rolling summary. If total time here is a few ms per second we are
// not the bottleneck no matter what else is wrong; if it is hundreds, we are.
const stats = {
  ms: 0, scans: 0, elements: 0, reportedAt: 0, matched: {}, hidden: 0,
  observerMs: 0, observerCalls: 0, retryMs: 0, retryTicks: 0,
};

function reportStats(now) {
  if (!DEBUG || now - stats.reportedAt < 2000) return;
  if (stats.scans > 0) {
    // Match counts matter as much as timing: with no per-match logging, zero
    // matches and matches-that-couldn't-be-anchored otherwise look identical.
    const matched = Object.entries(stats.matched).map(([k, v]) => `${k}=${v}`).join(" ") || "none";
    console.log(
      `[fbsb] perf: ${stats.ms.toFixed(1)}ms across ${stats.scans} scans, ` +
      `${stats.elements} elements (last ${((now - stats.reportedAt) / 1000).toFixed(1)}s) | ` +
      `observer: ${stats.observerMs.toFixed(1)}ms across ${stats.observerCalls} calls | ` +
      `matched: ${matched} | hidden: ${stats.hidden}`
    );
  }
  stats.ms = 0;
  stats.scans = 0;
  stats.elements = 0;
  stats.matched = {};
  stats.hidden = 0;
  stats.observerMs = 0;
  stats.observerCalls = 0;
  stats.reportedAt = now;
}

// --- Ads Facebook does not label in the DOM ---------------------------------
//
// Some feed ads carry no readable label at all: the word "Ad" renders on screen
// while existing nowhere in the document. DESKTOP-AD-LABELS.md records every
// route tried against it and why each failed.
//
// What such a card does have is a shape. It becomes a candidate by pointing at a
// label that no longer exists, linking off Facebook, or carrying a call to
// action - the three entry points in sweepUnlabeledAds - and is then vetoed if
// it looks like a real post: it links to itself, or its byline says how old it
// is. On by default; the popup can switch it off, and the audit list in
// Diagnostics names everything it takes.
//
// "A real post links to itself" is the veto the rule rests on, so every organic
// self-link shape has to be listed here, or the rule hides real posts: a profile
// post, a group post, a listing, a reel, a photo and so on.
const PERMALINK_RE = /\/(posts|permalink|permalink\.php|story\.php|videos|video\.php|watch|photo|photo\.php|photos|reel|reels|groups|events|notes|share|media\/set|commerce\/listing|marketplace\/item)([\/?]|$)/;

// NOT in the list above, deliberately: /stories/<id>/. It looks exactly like a
// self-link, but ads use it too - one reading "Sponsored" in plain sight carried
// it - so adding it would immunise every ad shaped that way. Only add a shape
// here on evidence that ads do not use it.

// Facebook routes outbound links through this redirector. An ad links off
// Facebook, because sending you off-site is the point; an organic post only does
// when it happens to share a link, and then it still links to itself. This is
// the way in for ads whose byline carries no label reference at all.
const OUTBOUND_PATH = "/l.php";

// A third way in, for ads that never leave Facebook: a lead-form ad's button
// ("Sign up", "Apply now", "Get quote") opens a form on Facebook itself, so
// there is no outbound link, and its label is the unreadable kind. What every ad
// does carry is a call to action, and these are the words Facebook puts on
// those buttons.
//
// Deliberately absent: "Message"/"Send message" (every marketplace listing),
// "Join", "Follow", "Interested", "Going". A match only makes a card a
// candidate; every veto that protects a real post still applies.
const AD_CTA_TEXTS = new Set([
  "sign up", "apply now", "get quote", "learn more", "shop now", "order now",
  "book now", "buy now", "get offer", "get offers", "download", "install now",
  "subscribe", "contact us", "donate now", "get started", "see menu",
  "play game", "listen now", "watch more", "get tickets", "request time",
  "get showtimes", "call now", "use app", "get directions", "open link",
  "send whatsapp message", "enter now", "claim offer", "get deal",
]);
const MAX_CTA_TEXT = 30;

function isAdCallToAction(el) {
  // Small elements only: a button, not a container that happens to hold one.
  if (el.childElementCount > 4) return false;
  const text = (el.textContent || "").replace(INVISIBLE_CHARS_RE, "").trim();
  if (!text || text.length > MAX_CTA_TEXT) return false;
  return AD_CTA_TEXTS.has(text.toLowerCase());
}

// ...but not every ad uses it. One ad linked straight out to the
// advertiser's own site, so a test for /l.php alone never saw it. What
// an ad cannot avoid is leaving Facebook: the click has to reach the
// advertiser. Hosts that are still Facebook do not count.
const FACEBOOK_HOST_RE = /(^|\.)(facebook\.com|fb\.com|fbcdn\.net)$/i;

function isOutboundLink(a) {
  const href = a.getAttribute("href") || "";
  if (!href || href.startsWith("#")) return false;
  if (linkPath(a) === OUTBOUND_PATH) return true;
  const m = /^(?:https?:)?\/\/([^/?#]+)/i.exec(href);
  return !!m && !FACEBOOK_HOST_RE.test(m[1]);
}

// A byline reference that resolves to a time - "27 minutes ago", "about an hour
// ago" - marks a real post: Facebook puts "Sponsored" where a post puts its age,
// and the ad's version has no text. A sturdier veto than enumerating permalink
// shapes: /stories/<id>/ is used by ads and real posts alike, so it can sit in
// neither list, and a timestamp is not a shape Facebook can quietly rename. Not
// every page load carries these references, so it is one veto among several.
const TIMESTAMP_RE = /(\bago\b|^(just now|yesterday|today)\b|^\d{1,3}\s?(s|m|h|d|w|y)$|^[a-z]{3,9}\s\d{1,2}(\s|,|$)|\bat\b\s\d{1,2}:\d{2})/i;

function hasResolvingTimestamp(card) {
  for (const el of card.querySelectorAll("[aria-labelledby]")) {
    for (const { text } of labelRefTexts(el)) {
      if (text && TIMESTAMP_RE.test(text)) return true;
    }
  }
  return false;
}

// A post has one subject. The stories tray has one per tile, and it kept
// getting taken - "Online status indicatorActive -> /<page>" on this reading,
// "-> /stories/1221077..." on the one before. Counting story links caught the
// tray only when several tiles happened to be linked at once.
const MAX_PROFILE_LINKS = 3;

// Facebook's own routes. None is a page, and treating one as a page name is
// dangerous rather than merely useless: nearly every photo post links to
// /photo/, so "photo" in the advertiser list would set aside the real-post veto
// for all of them. Ignored wherever they appear, including lists that already
// hold one.
const RESERVED_PATHS = new Set([
  "photo", "photos", "photo.php", "watch", "reel", "reels", "video", "videos",
  "video.php", "stories", "story.php", "permalink.php", "profile.php", "posts",
  "events", "marketplace", "commerce", "l.php", "share", "sharer", "sharer.php",
  "hashtag", "pages", "gaming", "search", "help", "ads", "business", "messages",
  "notifications", "friends", "bookmarks", "saved", "media", "notes", "live",
  "fundraisers", "people", "public", "login", "login.php", "home.php",
  "settings", "privacy", "policies", "legal", "dialog", "plugins", "about",
  "groups", "watchparty",
]);

// A page with no vanity address is /profile.php?id=<number>, and the id is its
// only identity - 1.1.73's audit showed one as "<name> -> /profile.php".
function profileIdOf(a) {
  const m = /[?&]id=(\d+)/.exec(a.getAttribute("href") || "");
  return m ? m[1] : null;
}

// "/SomePage", "SomePage", "facebook.com/SomePage" all mean the same thing to
// someone typing it in, so accept all of them.
function pageSet(value) {
  const out = new Set();
  for (const raw of (value || "").split(/[\n,]/)) {
    let name = raw.trim().replace(/^https?:\/\/[^/]*/i, "").replace(/^\/+/, "");
    const pid = /^profile\.php\?(?:[^#]*&)?id=(\d+)/i.exec(name);
    // A pasted address usually carries ?ref=... or similar, which is not part
    // of the page's name and would otherwise make it match nothing.
    name = pid ? "profile.php?id=" + pid[1] : name.split(/[?#]/)[0];
    name = name.replace(/\/+$/, "").toLowerCase();
    if (name && !RESERVED_PATHS.has(name)) out.add(name);
  }
  return out;
}

function cardOnList(card, names) {
  if (names.size === 0) return false;
  for (const a of card.querySelectorAll("a[href]")) {
    // An external site's path is not a page on Facebook, however it reads.
    if (isOutboundLink(a)) continue;
    const path = linkPath(a);
    if (!path || path === "/") continue;
    const segments = path.replace(/^\/+|\/+$/g, "").split("/");
    if (segments[0].toLowerCase() === "profile.php") {
      const id = profileIdOf(a);
      if (id && names.has("profile.php?id=" + id)) return true;
      continue;
    }
    if (names.has(segments[0].toLowerCase())) return true;
    // A group post's identity is /groups/<id>, not the first segment.
    if (segments.length > 1 && names.has((segments[0] + "/" + segments[1]).toLowerCase())) return true;
  }
  return false;
}

function isKeptPage(card) {
  return cardOnList(card, pageSet(settings.keepPages));
}

function isAdPage(card) {
  return cardOnList(card, pageSet(settings.adPages));
}

// Which page a card belongs to, for writing into one of those lists: the first
// link that names somebody, whether an advertiser's own page or a group.
function pageNameFor(card) {
  for (const a of card.querySelectorAll("a[href]")) {
    // <shop>.com/<product> has the path "/<product>", which reads exactly
    // like a page name. It is somebody else's website.
    if (isOutboundLink(a)) continue;
    const path = linkPath(a);
    if (!path || path === "/") continue;
    const segments = path.replace(/^\/+|\/+$/g, "").split("/");
    const first = (segments[0] || "").toLowerCase();
    if (first === "groups" && segments[1]) return "groups/" + segments[1];
    if (first === "profile.php") {
      const id = profileIdOf(a);
      if (id) return "profile.php?id=" + id;
      continue;
    }
    if (segments.length === 1 && first && !RESERVED_PATHS.has(first) && !/^\d+$/.test(first)) {
      return segments[0];
    }
  }
  return null;
}

function hasAdCallToAction(card) {
  for (const b of card.querySelectorAll('[role="button"]')) {
    if (isAdCallToAction(b)) return true;
  }
  return false;
}

function hasOutboundLink(card) {
  for (const a of card.querySelectorAll("a[href]")) {
    if (isOutboundLink(a)) return true;
  }
  return false;
}

// Appends a name to one of the two lists and persists it. The storage listener
// picks the change up and rescans, so the feed updates without a reload.
function addToPageList(key, name) {
  const current = settings[key] || "";
  if (pageSet(current).has(name.toLowerCase())) return;
  const next = current.trim() ? current.trim() + "\n" + name : name;
  settings[key] = next;
  browser.storage.local.set({ [key]: next });
}

function bylineCount(card) {
  const subjects = new Set();
  for (const a of card.querySelectorAll("a[href]")) {
    const path = linkPath(a);
    if (!path || path === "/" || path === OUTBOUND_PATH) continue;
    // A story tile counts as a subject even though its path is three segments
    // deep. Counting only single-segment profile links missed the tray
    // entirely: its tiles link to /stories/<id>/<token>, and the two that did
    // link to a page came to two, under the limit. It
    // was hidden five times in one reading.
    const story = /^\/stories\/(\d+)/.exec(path);
    if (story) {
      subjects.add("story:" + story[1]);
    } else if (/^\/[^/]+\/?$/.test(path)) {
      subjects.add(path.replace(/\/$/, ""));
    }
  }
  return subjects.size;
}

// The text behind each of an element's aria-labelledby references: live if the
// target is still on the page, otherwise whatever the cache caught before
// Facebook removed it - for some ads the span is removed right after the
// accessible name is computed, so a live lookup alone fails even though the
// post genuinely was labelled. An empty string means the reference dangles:
// nothing to read either way.
function labelRefTexts(el) {
  const out = [];
  const ids = (el.getAttribute && el.getAttribute("aria-labelledby")) || "";
  for (const id of ids.split(/\s+/)) {
    if (!id) continue;
    const target = document.getElementById(id);
    const text = target
      ? target.textContent.replace(INVISIBLE_CHARS_RE, "").trim()
      : labelTextById.get(id) || "";
    out.push({ id, text });
  }
  return out;
}

function isDanglingRef(el) {
  return labelRefTexts(el).some((ref) => !ref.text);
}

function linkPath(a) {
  const href = a.getAttribute("href") || "";
  if (!href || href === "#") return "";
  try {
    return new URL(href, location.origin).pathname;
  } catch (e) {
    /* No usable origin to resolve against - a data: or file: document, which
       is what the fixture harness is. Returning the raw href here meant every
       path test silently compared against a string with the query still on it,
       so the guards proving a real post survives were passing without ever
       exercising the rule they guard. */
  }
  return href.replace(/^[a-z]+:\/\/[^/]*/i, "").split(/[?#]/)[0] || "/";
}

function hasPermalink(card) {
  for (const a of card.querySelectorAll("a[href]")) {
    if (PERMALINK_RE.test(linkPath(a))) return true;
  }
  return false;
}

// Where the climb has to stop. Not at a jump in height: a card is often far
// taller than the media block its link sits in, so that rule fired inside the
// card and hid only the picture. The height ceiling keeps the climb out of a long
// feed column; for a short one, stop at the first ancestor holding more than one
// card-shaped child. A card has one subject; a container of cards has several.
function holdsSeveralCards(el) {
  let cards = 0;
  for (const child of el.children) {
    const r = child.getBoundingClientRect();
    if (
      r.width >= FEED_POST_MIN_WIDTH && r.width <= FEED_POST_MAX_WIDTH &&
      r.height >= FEED_POST_MIN_HEIGHT
    ) {
      if (++cards > 1) return true;
    }
  }
  return false;
}

// Climb from a dangling label reference, an outbound link or a call to action
// to the card holding it. Starting from those rather than from every <div> keeps
// a repeated document-wide sweep cheap: a feed holds a handful of them and
// thousands of divs.
//
// Thirty levels, because Facebook nests a call to action twenty-odd elements
// below the card; a shorter climb runs out of steps and keeps the media block it
// passed on the way.
const SHAPE_MAX_CLIMB = 30;

function cardFromLabelRef(el) {
  let node = el;
  let best = null;
  for (let i = 0; i < SHAPE_MAX_CLIMB; i++) {
    const parent = node.parentElement;
    if (!parent || parent === document.body) break;
    const r = node.getBoundingClientRect();
    if (
      r.width >= FEED_POST_MIN_WIDTH && r.width <= FEED_POST_MAX_WIDTH &&
      r.height >= FEED_POST_MIN_HEIGHT && r.height <= UNHIDDEN_MAX_HEIGHT
    ) {
      // Only if it is one post. holdsSeveralCards was asked about the parent
      // and never about the candidate itself, so a container of three posts
      // that happened to fit under the height ceiling could be chosen whole -
      // three real posts gone on one judgement meant for one.
      if (!holdsSeveralCards(node)) best = node;
      const pr = parent.getBoundingClientRect();
      if (pr.width > r.width * DESKTOP_CARD_WIDTH_JUMP) break;
      if (holdsSeveralCards(parent)) break;
    }
    node = parent;
  }
  return best;
}

// Feed-sized is not the same as "a post". The stories tray sits at the top of
// the feed at the same width, and Facebook leaves empty boxes holding a scroll
// position where a post used to be. A post has something to say and exactly one
// subject; the tray has many and the spacer has none.
const POST_MIN_TEXT = 40;

function looksLikePost(card) {
  if ((card.textContent || "").trim().length < POST_MIN_TEXT) return false;
  // More than one story link means the tray, not a post that links to a story.
  let storyLinks = 0;
  for (const a of card.querySelectorAll('a[href*="/stories/"]')) {
    if (++storyLinks > 1) return false;
  }
  return true;
}

// The shape rule is the only one that infers rather than reads, so it is the
// only one that can hide something real. A count cannot say *which*; a name and
// a link each can, and a friend's name in this list is the answer immediately.
const MAX_SHAPE_AUDIT = 20;
const shapeHides = [];

function describeShapeHide(card) {
  let who = "";
  const paths = [];
  for (const a of card.querySelectorAll("a[href]")) {
    const path = linkPath(a);
    if (!path || path === "/") continue;
    if (paths.length < 6 && !paths.includes(path)) paths.push(path.slice(0, 30));
    if (path === OUTBOUND_PATH) continue;
    const text = (a.textContent || "").replace(INVISIBLE_CHARS_RE, "").trim();
    if (!who && text && text.length <= 40) who = `${text} -> ${path.slice(0, 26)}`;
  }
  // A name alone was not enough to work out WHY a card matched. Asked to
  // explain one wrongly hidden post, the honest answer was that I had never
  // seen the card - only its name. These are the three things the rule
  // actually consults.
  return {
    who: who || "(no byline link)",
    why: `ts=${hasResolvingTimestamp(card) ? "yes" : "no"} subj=${bylineCount(card)} perma=${hasPermalink(card) ? "yes" : "no"}`,
    links: paths,
  };
}

// How often the whole document is re-checked. A card inserted with its byline
// label still live cannot qualify yet, and Facebook deletes that label a beat
// later in a mutation outside the card - so a sweep over only the changed
// subtree would test each card at the one moment it cannot match, and never
// again.
const SWEEP_INTERVAL_MS = 500;
let lastSweepAt = 0;

function sweepUnlabeledAds(root) {
  if (!settings.hideSponsored) return;
  // Two things run through here: the shape rule, which infers, and pages the
  // user has marked, which is a decision. Only the first answers to the
  // "Hide ads Facebook doesn't label" switch - that switch exists because
  // inference can be wrong, and a page you named yourself is not a guess.
  if (!settings.hideUnlabeledAds && !(settings.adPages || "").trim()) return;
  // Desktop only. The mobile feed is virtualised and its cards are governed by
  // rules measured separately - see MOBILE-VIRTUALISATION.md.
  if (isMobileLayout()) return;

  // The subtree that just changed, always - so a card that arrives already
  // dangling is caught on the spot - plus the whole document on a timer, which
  // is the part that catches a card going dangling after we first saw it.
  const scopes = [];
  if (root && root.querySelectorAll) scopes.push(root);
  const now = performance.now();
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS && document.body) {
    lastSweepAt = now;
    scopes.push(document.body);
  }

  // Two ways in, because Facebook ships these cards differently from one day to
  // the next: a byline reference pointing at a label that no longer exists, or
  // a link out through the redirector. Either one only gets as far as the
  // permalink veto, which is what keeps a real post safe in both cases.
  const seen = new Set();
  const consider = (el, card) => {
    if (!card) return;
    // Nothing anywhere near an open viewer. Checking the chosen element and its
    // ancestors was not enough: after a release the sweep came straight back
    // and hid an inner block of the same card, because the element it settled
    // on that time did not itself contain the viewer. The question that
    // matters is whether a viewer is open in this card at all.
    if (nearViewer(card)) return;
    if (isKeptPage(card)) return;
    if (seen.has(card)) return;
    seen.add(card);
    if (hiddenPosts.has(card)) return;
    if (card.closest("[data-fbsb-hidden]")) return;
    // A page you have marked as an advertiser sets aside the two vetoes that
    // protect real posts - it links to itself, it says how old it is - because
    // you have said its posts are ads anyway. It does NOT set aside "does this
    // look like an ad": it still has to send you off Facebook. Marking a page
    // is a strong hint, not a block list.
    const marked = isAdPage(card);
    if (marked) {
      if (!hasOutboundLink(card) && !hasAdCallToAction(card)) return;
    } else {
      if (!settings.hideUnlabeledAds) return;
      if (hasPermalink(card)) return;
      // A byline that still tells you how old the post is. An ad's does not.
      if (hasResolvingTimestamp(card)) return;
    }
    if (bylineCount(card) > MAX_PROFILE_LINKS) return;
    if (holdsSeveralCards(card)) return;
    if (!looksLikePost(card)) return;
    unlabeledAdsHidden += 1;
    if (shapeHides.length < MAX_SHAPE_AUDIT) shapeHides.push(describeShapeHide(card));
    hidePost(card, "sponsored", card, marked ? "marked" : "shape");
  };

  for (const scope of scopes) {
    for (const el of scope.querySelectorAll("[aria-labelledby]")) {
      if (!isDanglingRef(el)) continue;
      consider(el, cardFromLabelRef(el));
    }
    for (const a of scope.querySelectorAll('a[href*="l.php"], a[href^="http"], a[href^="//"]')) {
      if (!isOutboundLink(a)) continue;
      consider(a, cardFromLabelRef(a));
    }
    for (const b of scope.querySelectorAll('[role="button"]')) {
      if (!isAdCallToAction(b)) continue;
      consider(b, cardFromLabelRef(b));
    }
  }
}

function scanRoot(root) {
  if (!settings.hideSponsored && !settings.hideSuggested && !settings.hideUnfollowed) return;
  if (root.nodeType !== Node.ELEMENT_NODE) return;

  const startedAt = performance.now();
  if (root.matches && root.matches(LABEL_SELECTOR)) {
    processLabel(root);
  }
  if (root.querySelectorAll) {
    const found = root.querySelectorAll(LABEL_SELECTOR);
    stats.elements += found.length;
    found.forEach(processLabel);
  }
  sweepUnlabeledAds(root);
  pruneRemovedPosts(startedAt);

  const finishedAt = performance.now();
  stats.ms += finishedAt - startedAt;
  stats.scans += 1;
  reportStats(finishedAt);
}

// Facebook fires many separate observer callbacks in quick succession while a
// post streams in, and scanning on each one re-scans overlapping subtrees.
// requestAnimationFrame coalesces everything since the last paint into one pass,
// run just before the next paint - the latest moment that still hides content
// before it is drawn.
const pendingRoots = new Set();
let scanScheduled = false;

function scheduleScan(root) {
  pendingRoots.add(root);
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const r of roots) {
      if (r.isConnected) scanRoot(r);
    }
  });
}

// Facebook recycles DOM nodes, so a container we hid can be repurposed for
// something innocent. But a hidden post also keeps mutating for benign reasons
// (re-renders, lazy media), so "children were added" says nothing on its own.
// Re-check the evidence: if the label that earned the hide still classifies, the
// node was not recycled. Only when it is gone is a full re-scan worth paying
// for, and only if that comes up empty is the post restored - restoring on every
// mutation un-hid ads permanently, since nothing rescans a restored container.
function stillQualifies(container, info) {
  if (info.label.isConnected && container.contains(info.label) && classifyLabel(info.label)) {
    return true;
  }
  for (const el of container.querySelectorAll(LABEL_SELECTOR)) {
    if (classifyLabel(el)) return true;
  }
  return false;
}

const observer = new MutationObserver((mutations) => {
  // Timed unconditionally now. Two performance.now() calls per callback is far
  // cheaper than the thing they measure, and on Android the console this used
  // to report to does not exist — the figure is only useful if the popup can
  // read it, which means collecting it in the build people actually install.
  const observerStartedAt = performance.now();
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0 && mutation.target.nodeType === Node.ELEMENT_NODE) {
      // Only worth asking while something is hidden, which keeps this off the
      // hot path on a page where nothing has matched yet.
      if (hiddenPosts.size > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const dialog = node.matches('[role="dialog"]')
            ? node
            : node.querySelector('[role="dialog"]');
          if (dialog) releaseHiddenAround(dialog);
        }
      }
      const staleContainer = hiddenContainerFor(mutation.target);
      const info = staleContainer && hiddenPosts.get(staleContainer);
      if (info && !stillQualifies(staleContainer, info)) {
        if (DEBUG) console.log("[fbsb] recycled node detected, clearing stale hide:", staleContainer);
        restorePost(staleContainer);
      }
    }
    // Removals carry the label too, and often only the removal does. Facebook can
    // create a span, set its text, let the browser compute the accessible name, then
    // empty and remove it - all in one task - so by the time this callback reads the
    // added node its text is already gone. The removal record still holds it: a
    // removed text node keeps its content and a removed element keeps its id.
    // Bounded: only id-bearing elements, or text nodes whose parent is an id-bearing
    // leaf.
    for (const node of mutation.removedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.id) rememberLabelTarget(node);
      } else if (node.nodeType === Node.TEXT_NODE) {
        const parent = mutation.target;
        if (
          parent &&
          parent.nodeType === Node.ELEMENT_NODE &&
          parent.id &&
          parent.children.length === 0
        ) {
          rescuedLabels += 1;
          cacheLabelText(parent.id, node.textContent, parent);
        }
      }
    }

    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        // An ad's label often completes in two steps: Facebook inserts
        // <span id="_r_..._"> empty, then fills it. The insertion caches nothing, and the
        // text arriving afterwards is a text node - so without this the label is never
        // cached and the post never re-examined. Kept O(1): only a parent that carries
        // an id and holds no elements can be one of these spans. rememberLabelTarget
        // resolves forward from there.
        const parent = node.parentElement;
        if (parent && parent.id && parent.children.length === 0) {
          lateTextLabels += 1;
          rememberLabelTarget(parent);
        }
        continue;
      }
      // Synchronously, before the node can be removed again: record any id →
      // text so an ephemeral label survives long enough to be useful. The
      // actual scanning still happens on the next frame.
      cacheLabelTargets(node);
      scheduleScan(node);
    }
  }
  // Timed separately from scanRoot on purpose. This callback runs
  // synchronously on every DOM mutation Facebook makes, including the whole of
  // its initial render, and cacheLabelTargets walks each added subtree — none
  // of which the scan timer sees. A regression here is invisible in the scan
  // figure while being exactly what makes a page feel slow.
  stats.observerMs += performance.now() - observerStartedAt;
  stats.observerCalls += 1;
});

// Start watching and hiding immediately, before settings are read. main() has
// to await storage, and Facebook renders the first posts during exactly that
// gap. Hiding under defaults is safe because it is reversible: main() restores
// anything the user has turned off as soon as it knows, so the worst case is a
// wanted post flickering out and back.
//
// document.body can be null here despite run_at "document_idle". Observing it
// then throws, module evaluation stops, and the extension hides nothing while
// the message listener above keeps answering the popup as if healthy. Never
// assume the body is there; if it is missing, wait for it.
let bootState = "pending";

function startObserving() {
  // documentElement, not body: a label span inserted directly under <html> is
  // invisible to an observer rooted at body, and these portal spans are
  // page-level scratch nodes of exactly that kind. The extra coverage is <head>,
  // which Facebook mutates when it injects styles; the observer's share of
  // wall-clock time is in the diagnostics panel, so a cost here shows up as a
  // number.
  observer.observe(document.documentElement, { childList: true, subtree: true });
  cacheLabelTargets(document.body);
  scanRoot(document.body);
  bootState = "running";
}

if (document.body) {
  startObserving();
} else {
  bootState = "waiting for <body>";
  const bootObserver = new MutationObserver(() => {
    if (!document.body) return;
    bootObserver.disconnect();
    startObserving();
  });
  // documentElement always exists by the time a content script runs; it is the
  // node body is appended to.
  bootObserver.observe(document.documentElement, { childList: true, subtree: true });
}

// --- Settings sync + bootstrap ---------------------------------------------

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  let shouldRescan = false;

  if (changes.hideSponsored) {
    settings.hideSponsored = changes.hideSponsored.newValue;
    if (!settings.hideSponsored) restoreByReason("sponsored");
    else shouldRescan = true;
  }
  if (changes.hideSuggested) {
    settings.hideSuggested = changes.hideSuggested.newValue;
    if (!settings.hideSuggested) restoreByReason("suggested");
    else shouldRescan = true;
  }
  if (changes.hideUnfollowed) {
    settings.hideUnfollowed = changes.hideUnfollowed.newValue;
    if (!settings.hideUnfollowed) restoreByReason("unfollowed");
    else shouldRescan = true;
  }
  if (changes.hideAppBanner) {
    settings.hideAppBanner = changes.hideAppBanner.newValue;
    if (!settings.hideAppBanner) restoreByReason("appbanner");
    else shouldRescan = true;
  }
  if (changes.hideUnlabeledAds) {
    settings.hideUnlabeledAds = changes.hideUnlabeledAds.newValue;
    // Restoring by reason cannot tell a shape hide from a labelled ad or a
    // marked page - all three are "sponsored" - so turning the shape rule off
    // used to bring back every ad on the page and leave them there. Restore,
    // then rescan: the ones that were never the shape rule's doing go straight
    // back.
    if (!settings.hideUnlabeledAds) restoreByReason("sponsored");
    shouldRescan = true;
  }
  if (changes.placeholderMode) {
    settings.placeholderMode = changes.placeholderMode.newValue;
  }
  if (changes.keepPages) {
    settings.keepPages = changes.keepPages.newValue;
    // Give back anything now named in the list, without waiting for a reload.
    for (const [container, info] of hiddenPosts) {
      if (info.reason === "sponsored" && isKeptPage(container)) restorePost(container);
    }
  }
  if (changes.adPages) {
    settings.adPages = changes.adPages.newValue;
    shouldRescan = true;
  }
  if (changes.showMarkers) {
    settings.showMarkers = changes.showMarkers.newValue;
    if (!settings.showMarkers) hideMarker();
  }

  if (shouldRescan && document.body) scanRoot(document.body);
});

(async function main() {
  settings = await browser.storage.local.get(DEFAULT_SETTINGS);
  if (DEBUG) {
    console.log(
      "[fbsb] content script loaded, build",
      browser.runtime.getManifest().version,
      "settings:", settings
    );
  }
  sendToBackground({ type: "RESET_COUNT" });

  // Undo anything the optimistic startup scan hid that this user doesn't want
  // hidden. Reversing a wrong hide is cheap; leaving ads visible while waiting
  // to be told it was allowed is what actually costs.
  if (!settings.hideSponsored) restoreByReason("sponsored");
  if (!settings.hideSuggested) restoreByReason("suggested");
  if (!settings.hideUnfollowed) restoreByReason("unfollowed");
  if (!settings.hideAppBanner) restoreByReason("appbanner");

  // Placeholder mode changes how a post is hidden, not whether — so anything
  // hidden under the default presentation has to be undone and redone to match.
  // That re-scan is the only reason to sweep the document again: the startup
  // scan already covered everything present, the observer has covered
  // everything since, and turning a reason *off* is handled by restoring, not
  // by re-scanning. Sweeping unconditionally cost a second full-document pass
  // on every page load for no effect.
  if (settings.placeholderMode !== DEFAULT_SETTINGS.placeholderMode) {
    for (const container of Array.from(hiddenPosts.keys())) restorePost(container);
    if (document.body) scanRoot(document.body);
  }
})();
