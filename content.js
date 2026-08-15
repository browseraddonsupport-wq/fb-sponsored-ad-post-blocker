// Detects Facebook's "Sponsored"/"Ad", "Suggested for you", and unfollowed
// Page/Group posts, and hides the post they belong to. Facebook exposes no
// stable class name for any of this, so detection is keyed off two things
// instead:
//   1. Label text, cleaned up (see labelVariants below) — "Sponsored"/
//      "Ad", "Suggested for you", or a "Follow"/"Join" button next to the
//      poster's name (Facebook's own signal for content from a Page/Group
//      you don't follow yet).
//   2. For sponsored content specifically, the post's "..." menu button,
//      whose accessible name reads "Open menu for <name> sponsored
//      content" even when no label text is visible on screen.
// Once a label is found, the post/ad card it belongs to is located via
// `findPostContainer` and hidden.

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

// Facebook renders label text as one <span> per character and scrambles it
// two ways at once:
//   - Every character carries an invisible Unicode joiner/combining mark,
//     so plain textContent never equals "Sponsored"/"Ad" even once
//     concatenated. Stripping Unicode "Format" (Cf) and "Mark, nonspacing"
//     (Mn) characters undoes this.
//   - Real characters are sometimes interspersed with decoy character-spans
//     (junk text) and/or placed in randomized DOM order, then repositioned
//     to the correct visual position purely via CSS flexbox `order`. Decoy
//     leaf spans consistently carry a much longer class list than genuine
//     ones, so a length threshold filters them out; sorting each level's
//     children by computed `order` before concatenating restores the real
//     reading order.
// The third class of junk is only visible on mobile: weblite draws its icons
// from a font mapped into the Private Use Area, and packs them into the same
// span as the label text — an ad's label is literally "Ad\u{F078B}\u{F17E0}",
// where the two trailing glyphs are the audience and chevron icons. Those are
// category Co, not Cf or Mn, so stripping only the first two left the text as
// "Ad<glyph><glyph>", which matches nothing. This is why mobile hid unfollowed
// posts but never ads: "Follow" happens to sit in a span of its own with no
// icons, while every ad label shares one with them.
//
// Dropping Co cannot create a false positive on its own. The neighbouring
// organic-post span is "1h\u{F212D}\u{F3196}" (a timestamp plus the same kind
// of icons), which cleans to "1h" and matches no target.
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

// Facebook pads character-split labels with decoy spans, and which spans are
// the decoys is signalled by class-list length — but the *direction* of that
// signal is not stable. In the markup this was originally written against the
// decoys carried the longer class list; in current markup it is reversed (the
// real characters of "Sponsored" each carry ~22 classes including a long
// shared randomized suffix, while the decoys carry ~7). Betting on either
// direction silently breaks whenever Facebook flips it, and the flip is
// invisible — detection just stops. So assemble every plausible partition and
// let the caller match against any of them: the target strings are a handful
// of short known labels, so a decoy partition matching one by accident is not
// a realistic risk, and this stops caring which way round the signal is.
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

// labelVariants resolves computed style once per child, and getComputedStyle
// forces a style flush — so it must only ever run on elements that really are
// character-split labels. Gating it on "has at least two children" was far too
// loose: on Facebook that matches thousands of ordinary wrappers, and paying
// up to MAX_SCRAMBLED_LABEL_CHILDREN style resolutions on each one blocks the
// main thread hard enough to stop the feed rendering at all.
//
// A genuine scrambled label is unmistakable and cheap to recognise: a row of
// leaf spans each holding exactly one visible character. Reading text off a
// leaf is O(1) and no style is resolved, so this rejects almost everything
// before any expensive work starts.
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

function classifyLabel(el) {
  // Only two element shapes can carry a text label, and reading either is
  // cheap:
  //   - a leaf, where .textContent is just its own text, and
  //   - a character-split label, which isCharacterSplit recognises without
  //     resolving any style.
  // Everything else is a wrapper. Reading .textContent on a wrapper walks its
  // whole subtree, and since scanRoot visits every span and anchor on the
  // page, doing so at each nesting level re-walks the same text over and over
  // — quadratic in subtree size, and enough on a real feed to stall Facebook's
  // rendering outright. Skipping wrappers costs nothing: the leaf that
  // actually holds the text gets visited on its own.
  if (el.children.length === 0) {
    const raw = el.textContent;
    if (raw && raw.length <= 300) {
      const reason = reasonForText(raw.replace(INVISIBLE_CHARS_RE, "").trim());
      if (reason) return reason;
    }
  } else if (isCharacterSplit(el)) {
    for (const variant of labelVariants(el)) {
      const reason = reasonForText(variant);
      if (reason) return reason;
    }
  }

  // NOTE: do not be tempted by data-ad-rendering-role. Its name and its
  // values ("profile_name", "story_message", "like_button", …) make it look
  // like a reliable ad marker, and it is present on every part of a sponsored
  // post. It is also present on ordinary posts from pages you follow —
  // Facebook renders both through the same story template — so keying off it
  // classifies the entire feed as sponsored and hides everything. Verified the
  // hard way; the attribute name is simply misleading.

  // Facebook now draws the byline label as vector art: an <svg><use> pointing
  // at a sprite <symbol> elsewhere in the document. There is no text in the
  // post at all — which is why every text-based path above finds nothing, and
  // why the word "Sponsored" is absent from the post's entire textContent.
  //
  // The symbol itself does hold real text, because a screen reader has to be
  // able to announce it: #SvgT31 reads "Sponsored", while an organic post's
  // byline symbol reads "17 hours ago". So follow the reference and match that
  // — same string sets as everywhere else, no new heuristic. The cache covers
  // symbols Facebook has already discarded.
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

  // Chromium gets a different obfuscation from Firefox: feed ads carry no
  // "Sponsored" text at all, neither plain nor character-split. The word lives
  // only in a portal <span id="_r_…_"> parked a few levels below <body>, which
  // the post references by aria-labelledby.
  //
  // We already see those portal spans and correctly refuse to hide anything
  // from them — they sit outside every post, so they can never be anchored.
  // The referencing element, though, is inside the post and anchors normally,
  // so resolve the relationship from this end instead.
  //
  // Deliberately limited to the ad labels: "Follow"/"Join" appear as accessible
  // names all over the interface for reasons that have nothing to do with who
  // posted something, and matching those here would hide unrelated content.
  // aria-labelledby holds a space-separated *list* of ids, not one id — the
  // accessible name is the concatenation of all of them. Passing the raw
  // attribute to getElementById returns null the moment there is more than
  // one, which silently skips every ad whose label is assembled from several
  // nodes. Check each referenced node.
  const labelledBy = el.getAttribute && el.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      if (!id) continue;
      // Fall back to the cache when the target is gone: for some ads the span
      // is removed right after the accessible name is computed, so a live
      // lookup fails even though the post genuinely was labelled "Sponsored".
      const target = document.getElementById(id);
      const text = target
        ? target.textContent.replace(INVISIBLE_CHARS_RE, "").trim()
        : labelTextById.get(id);
      if (!text) continue;
      if (settings.hideSponsored && SPONSORED_TEXTS.has(text)) return "sponsored";
      if (settings.hideSuggested && SUGGESTED_TEXTS.has(text)) return "suggested";
    }
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

// A "Follow"/"Join" button only means "this post is from a Page or Group you
// don't follow" when it sits beside the post's *own* author. Posts frequently
// embed a shared post, and the embedded copy carries its own author header
// with its own Follow button — so a group post you're a member of, quoting
// someone you don't follow, would otherwise be hidden entirely on the strength
// of the quoted author's button.
//
// The post's own author header is the first heading in the container;
// anything quoted inside it comes later. Requiring the button to live in that
// first heading errs toward leaving posts visible, which is the right way to
// be wrong: a missed unfollowed post is an annoyance, a wrongly hidden group
// post is content you never learn you lost.
function isAuthorLevelLabel(label, container) {
  const heading = label.closest("h1, h2, h3, h4, h5, h6");
  if (!heading) return false;
  return heading === container.querySelector("h1, h2, h3, h4, h5, h6");
}

// Facebook's mobile web renderer ("weblite" — it tags <body> with
// html-renderer) is a different app, not a narrow desktop. It exposes no ARIA
// landmarks whatsoever: no role="article", no aria-posinset, no data-pagelet,
// no role="complementary", and the author header is a plain <div> rather than
// a heading. Every strategy in findPostContainer keys off one of those, so on
// mobile all of them return null and nothing is ever hidden — detection works
// fine there, resolution is what fails.
//
// Keying off the body class rather than "no landmarks found" is deliberate:
// the latter needs a document-wide query on every unresolved label, and a
// desktop page that hasn't painted its feed yet would answer it wrongly. The
// tradeoff is that if Facebook renames this class, mobile support stops
// silently — the same failure mode as everything else in this file.
const MOBILE_BODY_CLASS = "html-renderer";

function isMobileLayout() {
  return document.body.classList.contains(MOBILE_BODY_CLASS);
}

// What that layout does have is a flat feed: one container whose direct
// children are the posts. Observed on a live feed, the container held 71
// children and each post sat 7 levels above its "Follow" button, with every
// intermediate wrapper holding 1-4 children. So the post is the last ancestor
// before the first ancestor that has many children.
const MOBILE_FEED_MIN_CHILDREN = 10;
const MOBILE_MAX_CLIMB = 12;
// Feed posts span the feed's full width (measured: 1339-1345 of 1345). A
// carousel nested inside a post could also clear the child-count bar, and
// climbing would stop at one of its items; requiring most of the parent's
// width rejects that without needing to know what the carousel is.
const MOBILE_MIN_WIDTH_RATIO = 0.6;

function findMobilePostContainer(label, reason) {
  // The app banner is a fixed bar, not a feed child — climbing by child count
  // would walk straight past it to the page wrapper.
  if (reason === "appbanner") return label.closest(APP_BANNER_SELECTOR);

  let node = label;
  for (let i = 0; i < MOBILE_MAX_CLIMB; i++) {
    const parent = node.parentElement;
    if (!parent || parent === document.body) return null;

    if (parent.children.length >= MOBILE_FEED_MIN_CHILDREN) {
      if (node.offsetWidth < parent.clientWidth * MOBILE_MIN_WIDTH_RATIO) return null;

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

  // role="complementary" reliably means "the feed's right-column ad
  // sidebar" for sponsored/suggested content, which is what this fallback
  // was built and confirmed against. But Facebook also marks a Reel
  // page's entire comments+info panel as role="complementary" (a
  // legitimate "supplementary content" landmark, just reused for
  // something else there), and a stray "Follow"/"Join" button anywhere
  // inside it would otherwise take out the whole panel. Since hiding a
  // sidebar Follow button was never really the intent of "unfollowed"
  // detection anyway (that's about feed posts specifically), skip this
  // fallback for that reason rather than trying to further disambiguate
  // which role="complementary" region is actually the ad sidebar.
  if (reason !== "unfollowed") {
    const rail = label.closest('[role="complementary"]');
    if (rail) return climbToChildOf(label, rail);
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

function hidePost(container, reason, label) {
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
    container.insertAdjacentElement("beforebegin", placeholder);
  }

  container.style.setProperty("display", "none", "important");
  container.dataset.fbsbHidden = reason;
  hiddenPosts.set(container, { reason, originalDisplay, placeholder, label });
  if (isPostReason(reason)) reportCount(1);
}

function restorePost(container) {
  const info = hiddenPosts.get(container);
  if (!info) return;
  container.style.display = info.originalDisplay;
  if (info.placeholder) info.placeholder.remove();
  delete container.dataset.fbsbHidden;
  hiddenPosts.delete(container);
  if (isPostReason(info.reason)) reportCount(-1);
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
// Mobile needs its own number, because the threshold is only meaningful
// relative to how deep the page nests. Weblite's whole document is about 11
// levels: a feed ad's "Ad" label measures exactly 10 steps from <body>, so the
// desktop limit classified every real ad as a decoy and discarded it before
// resolution was attempted — detection and container resolution both worked,
// and this threw the label away in between. Unfollowed posts escaped only
// because their "Follow" button carries two extra wrappers, putting it at 11.
//
// 4 keeps the original intent (anything parked directly under <body> is not a
// post) while leaving room for a tree this shallow.
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

// Facebook parks accessibility-label targets — the <span id="_r_…_"> that an
// ad's aria-labelledby points at — outside the post they describe. They hold
// the literal word "Sponsored", so they classify, but they can never resolve
// to a post themselves.
//
// The element that *references* them is inside the post and anchors fine.
// classifyLabel already resolves that relationship, but only if the span
// existed when the post was scanned — and Facebook creates the post first and
// the span moments later. At scan time getElementById returns null,
// classifyLabel finds nothing, and an element that classifies as nothing never
// enters the retry queue, so nothing looks at it again and the ad stays
// visible forever.
//
// The span's own insertion is a mutation we already observe, so use it as the
// trigger and walk forward to whoever references it.
//
// `~=` matches one entry of a space-separated list, which is what
// aria-labelledby is; `=` would only match labels built from a single id.
function resolveViaReferrer(label) {
  if (!label.id) return false;
  const id = CSS.escape(label.id);
  // Two ways to point at a label target: aria-labelledby from an ordinary
  // element, or xlink:href from an <svg><use> that draws it as a sprite. The
  // sprite form is how feed ads label themselves now, and looking only for the
  // first is why these reported "referrer NOT FOUND" while sitting inside a
  // perfectly ordinary post. `*|href` matches href in any namespace.
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
    // NOTE: do not queue elements here just because they carry an
    // aria-labelledby whose target doesn't resolve. That was tried (1.1.30)
    // on the theory that ad labels arrive late, and it froze the feed:
    // Facebook has a great many elements with dangling label references, so
    // the retry queue floods and every one of them is re-examined on every
    // tick for the full retry window. The cost never showed up in the perf
    // line either, because that only times scanRoot.
    //
    // The theory was wrong anyway — late-arriving labels were not what hid
    // feed ads. Following the sprite reference in classifyLabel was.
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

  const resolved = tryHideFromLabel(label, reason);
  if (resolved) {
    if (DEBUG) stats.hidden += 1;
    return;
  }

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

  if (!pendingLabels.has(label) && pendingLabels.size < MAX_PENDING_LABELS) {
    pendingLabels.set(label, Date.now());
    ensureRetryLoopRunning();
  }
}

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
      pendingLabels.delete(label);
    }
  }
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

// Some ads' accessibility labels are *ephemeral*: Facebook inserts the portal
// <span id="_r_…_">Sponsored</span>, the browser computes the post's accessible
// name from it, and the span is removed again — sometimes within the same
// frame. By the time anything looks, aria-labelledby points at an id that no
// longer resolves, and the only evidence the post was an ad is gone.
//
// Scanning is deferred to requestAnimationFrame (see scheduleScan), and that
// callback skips roots that are no longer connected, so a span with that
// lifetime is never examined at all. Recording the text synchronously in the
// observer callback — the one moment the node is guaranteed to still exist —
// is what makes those ads detectable.
//
// Bounded, oldest-first, because Facebook mints these continuously.
const MAX_LABEL_CACHE = 200;
const labelTextById = new Map();

function rememberLabelTarget(el) {
  if (!el.id) return;
  const text = el.textContent.replace(INVISIBLE_CHARS_RE, "").trim();
  if (!text || text.length > 40) return;
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
    const resolved = resolveViaReferrer(el);
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

// `use` is here because sprite-rendered labels carry no text of their own —
// see the reference-following branch in classifyLabel.
const LABEL_SELECTOR = "span, a, use, [aria-label], [aria-labelledby]";

// Self-instrumentation. Whether this extension is what's stalling the feed is
// answerable with numbers rather than argument, and a synthetic page doesn't
// reproduce a real feed well enough to answer it — so measure in place and
// report a rolling summary. If total time here is a few ms per second we are
// not the bottleneck no matter what else is wrong; if it is hundreds, we are.
const stats = {
  ms: 0, scans: 0, elements: 0, reportedAt: 0, matched: {}, hidden: 0,
  observerMs: 0, observerCalls: 0,
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
  const finishedAt = performance.now();
  stats.ms += finishedAt - startedAt;
  stats.scans += 1;
  reportStats(finishedAt);
}

// A single MutationObserver callback invocation already batches every
// mutation from one render pass, but Facebook can still fire many
// *separate* callback invocations in quick succession (e.g. several small
// bursts while a post streams in) — scanning synchronously on every one of
// those, with no batching across them, means redundant re-scanning of
// overlapping subtrees. requestAnimationFrame coalesces everything that
// happened since the last paint into one scan pass, timed to run right
// before the *next* paint — the latest possible moment that still hides
// content before the browser would otherwise render it, rather than
// scanning after an arbitrary fixed delay.
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

// Facebook aggressively recycles DOM nodes for unrelated content, so a
// container we hid earlier can be repurposed to hold something innocent.
// But a hidden post also keeps mutating internally for entirely benign
// reasons (React re-renders, lazy-loaded media, sidebar modules that
// refresh themselves), so "children were added" on its own says nothing.
// Re-check the evidence instead: if the label that earned the hide is
// still there and still classifies, the node wasn't recycled and must
// stay hidden. Only when that evidence is gone is a full re-scan of the
// container worth paying for, and only if that also comes up empty do we
// restore. Treating every mutation as recycling meant ads were hidden and
// then immediately un-hidden, permanently — nothing rescans a container
// once restored, because scanRoot only ever sees newly-added nodes.
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
  const observerStartedAt = DEBUG ? performance.now() : 0;
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0 && mutation.target.nodeType === Node.ELEMENT_NODE) {
      const staleContainer = mutation.target.closest("[data-fbsb-hidden]");
      const info = staleContainer && hiddenPosts.get(staleContainer);
      if (info && !stillQualifies(staleContainer, info)) {
        if (DEBUG) console.log("[fbsb] recycled node detected, clearing stale hide:", staleContainer);
        restorePost(staleContainer);
      }
    }
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
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
  if (DEBUG) {
    stats.observerMs += performance.now() - observerStartedAt;
    stats.observerCalls += 1;
  }
});

// Start watching and hiding immediately, before settings are read. main() has
// to await storage, and Facebook renders the first posts during exactly that
// gap — the moment when the most ads are on screen. Waiting for storage meant
// every ad in the first screenful was painted and left visible until the read
// resolved, and any label created and destroyed in those milliseconds was
// never seen at all.
//
// Hiding under defaults is safe because it is reversible: main() restores any
// reason the user has actually turned off as soon as it knows. The worst case
// is a post the user wanted to keep flickering out and back within a few
// milliseconds; the alternative was every ad staying visible for that same
// window, every page load. Defaults hide all three, so for anyone who hasn't
// changed them there is nothing to undo.
observer.observe(document.body, { childList: true, subtree: true });
cacheLabelTargets(document.body);
scanRoot(document.body);

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
  if (changes.placeholderMode) {
    settings.placeholderMode = changes.placeholderMode.newValue;
  }

  if (shouldRescan) scanRoot(document.body);
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
    scanRoot(document.body);
  }
})();
