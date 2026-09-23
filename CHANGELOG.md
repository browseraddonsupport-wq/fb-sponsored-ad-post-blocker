# Changelog

## 1.1.86

Two reports on 2026-09-23, from the same kind of ad.

### Fixed

- **"This is an ad" hid the picture and left the post.** Picture gone, page
  name, text, sign-up bar and reactions still standing, and nothing recorded in
  the advertiser list. It is the fourth time a half-hide has reached the
  screen, and each earlier fix patched the climb with another measurement that
  a different layout then got past.

  So the climb is anchored on something every post has instead: **the line
  saying who posted it.** A hide is not finished until it contains that. The
  climb keeps every guard that keeps it inside one post — it never crosses
  into the page column, a viewer, above a hidden neighbour, or into a container
  that holds another post — and if it cannot find a byline inside those
  bounds it leaves the hide exactly as it was. It can widen a hide within a
  post; it cannot widen one into the feed.

  The page name is now read from the whole post as well, which is why the list
  stayed empty: a picture's only links are `/photo/` and the advertiser's own
  site, neither of which is a page.

- **Lead-form ads got through entirely.** "FORM — Enter for a chance to win
  — Sign up". That button opens a form on Facebook itself,
  so the ad never links off it; its "Ad" label is the unreadable kind; and it
  carries no dangling byline reference. Every route in missed it.

  What every ad does carry is a call to action, so that is now a third way in:
  "Sign up", "Apply now", "Get quote", "Shop now" and the rest of the words
  Facebook puts on those buttons. It only makes a card a candidate — every veto
  that protects a real post still applies afterwards. "Message", "Send
  message", "Join", "Follow" and "Interested" are deliberately not on the list:
  every marketplace listing and group post carries one of those.

### Changed — test harness

- **"Hidden" now means the whole post is gone.** The runner counted a post as
  hidden if a hide marker existed *anywhere* inside it — so a post with only
  its picture hidden passed. That is precisely the bug that reached the screen
  four times, and not one fixture could see it. There are now three outcomes:
  hidden, visible, and **partial**, which is never right.

- **A fixture can press "This is an ad"**, the way a person does — point at the
  picture, click the button — and can check which page name was recorded.

### Added

- The Diagnostics panel reports `half-hidden posts`, and keeps the *latest*
  eight hides as samples rather than the first eight. The reported half-hide
  was the seventeenth of its page, so the old panel could never have shown it.

### Verified

49 fixtures, twenty-three of them false-positive guards. Both new bug fixtures
were confirmed to fail on 1.1.85 first — and the first draft of the
half-hide one did not: it gave the ad an off-Facebook link, so a second pass
of the shape rule rescued the post and hid the lot. That is exactly what never
happened on the real page, where nothing links off Facebook. Redrawn as a
lead-form ad, with the click as the only thing that can hide it, it reproduces
the report: `partial` on 1.1.85, hidden — and the page name recorded — on
1.1.86.

## 1.1.85

### Fixed

- **A post you opened on purpose is never hidden now.** Reported 2026-09-23: a
  friend shared a post from a buy-and-sell group in Messenger, and opening it
  showed nothing. The post carries a "Join" button, so the unfollowed rule hid
  it inside the very viewer that had just been clicked into — and the only way
  to read it was to switch that rule off for everything.

  Every rule here exists to curate a feed nobody chose. None of them should get
  a say over a post somebody did. So there is now one check that every rule
  passes through before anything is hidden, and it spares:

  - anything inside a viewer — a post clicked into, a photo, a reel, a link
    followed from chat;
  - the post on a page that *is* that post — a permalink, loaded directly or
    from a link outside Facebook.

  The right-hand column is still filtered on a post's own page; it is page
  furniture, not what you came to see.

  Checked in one place because the dialog checks that already existed lived in
  individual rules, and only some of them. The route this post took had none.

- The "This is an ad" button no longer appears inside viewers either.

### Added

- The Diagnostics panel reports `opened posts spared` beside `viewers
  released`.

### Verified

44 fixtures, twenty of them false-positive guards. The two new ones are the
shared post, in a viewer and on its own page, and both were confirmed to fail on
1.1.84 first. A third is a guard on the guard: on a post's own page, an ad in
the right-hand column must still be hidden.

## 1.1.84

### Changed

- **"This is an ad" appears over the picture and nowhere else.** It attached to
  whichever card-shaped block the pointer was in, so it turned up over the page
  name and over the post text as well. It now shows only while the pointer is
  inside the post's main picture or video, sits at that picture's corner, and
  clicking it hides the **whole** post.

  Measured by position rather than by what the pointer is resting on, because
  Facebook lays transparent layers over its images and the element under the
  pointer is rarely the image itself. A post with no picture has no button.

### Fixed

- **The button recorded "photo" as an advertiser.** Clicked on a picture, it
  took the first link it found — and the first link inside a picture is
  `/photo/`. Nearly every photo post links there, so that one entry treated
  every photo post on Facebook as a marked advertiser and set aside the
  "this is a real post" check for all of them. Facebook's own routes (`photo`,
  `watch`, `reel`, `stories` and the rest) are never recorded now, and are
  ignored if a list already contains one — so an existing `photo` entry is
  harmless, though still worth deleting.

- **It could also record an advertiser's website as a page.** A shop link like
  `<shop>.com/<product>` has the path `/<product>`, which reads exactly like a
  page name. Links that leave Facebook are no longer considered.

- **Pages without a vanity address could not be marked at all.** Their address
  is `profile.php?id=<number>`, and every one of them reduced to the same
  reserved route. They are recorded and matched by id now.

- **An address pasted from the browser bar matched nothing** when it carried
  `?ref=...` or similar, which is usually. The query is ignored now.

### Verified

41 fixtures, nineteen of them false-positive guards. The three new ones were
each run against 1.1.83 first and confirmed to fail there — one did not on its
first draft, because the ordinary shape rule hid that card regardless of the
marking, so it was given a real permalink until only the fix could hide it.

The button itself was checked directly: hovering the page name, the avatar,
the post text and the shop link shows nothing; hovering the picture shows the
button at its corner; clicking it records the page's name and hides the
post, header included.

## 1.1.83

A screenshot on 2026-09-23 showed every hide option unticked, `0 posts hidden`,
an ad sitting in the feed with its "Ad" label in plain view, and the "This
is an ad" button ticked on but never appearing. Three bugs, all mine.

### Fixed

- **The popup could wipe every setting.** It saved by writing *every* option
  from the form at once, and the checkboxes start unticked until the real
  values have loaded. Anything that triggered a save in that window wrote
  `false` over every hide option. The window had always existed, but 1.1.80 and
  1.1.82 added text boxes — exactly where you click and type the moment the
  popup opens.

  Reproduced before fixing: on 1.1.82, typing a page name into the box straight
  after opening the popup turned every option off. Each control now writes only
  its own setting, and the controls are disabled until they hold real values,
  so there is nothing to click in the window where they do not.

  **If your options were switched off without you doing it, this is why** —
  re-tick them once and they will stay.

- **The "This is an ad" button depended on a setting it had no business
  depending on.** It required "Hide ads Facebook doesn't label" to be on, so
  with that unticked the popup said the button was enabled and it never
  appeared. Marking is most useful precisely when ads are getting through.

- **So did pages you had marked.** A page you named yourself is a decision,
  not an inference, and the "Hide ads Facebook doesn't label" switch exists
  because inference can be wrong. Marked pages now answer only to "Hide
  Sponsored posts".

- **Unticking the shape rule brought back every ad on the page.** It restored
  everything filed as "sponsored" — label-detected ads and marked pages
  included, since all three share the reason — and never rescanned to put the
  others back. It now rescans straight after.

### Verified

38 fixtures, eighteen of them false-positive guards. The popup smoke page now
reproduces the race rather than hoping around it: stored settings seeded ON, and
a deliberately slow `storage.get`. With a fast stub that window never opens and
the bug cannot be seen — which is how it passed every check before.

## 1.1.82

### Added

- **Teach it, from the feed.** Hovering a post shows a faint **"This is an ad"**
  button; clicking it records that Page as an advertiser and hides the post.
  Where a hidden post leaves a placeholder, that placeholder now offers **"Not
  an ad"**, which records the Page as one to keep and brings the post back.

  Both write to lists you can see and edit in the popup, so nothing is learned
  that cannot be unlearned.

- **Marking a Page is a strong hint, not a block list.** A marked Page's post
  still has to look like an ad — it must link off Facebook — before it is
  hidden. That keeps a Page that posts both ads and real content usable, which
  is exactly the case a blanket block gets wrong. What marking *does* set aside
  are the two vetoes that normally protect a real post: that it links to itself,
  and that its byline says how old it is.

  The unit is the Page rather than the post because Facebook's post ids are
  obfuscated and do not survive a reload, while a Page name does — so a decision
  made once applies to everything that Page posts next.

- The button is switchable from the popup, and hidden on mobile, where writing
  anything near a feed card stalls Facebook's pager (`MOBILE-VIRTUALISATION.md`).

### Notes on how it is built

The button is a single element parented to `<body>` and positioned over
whichever card the pointer is on. It is deliberately **not** injected into the
card: every piece of UI added to a Facebook subtree is a hostage to the next
markup change, and on mobile writing into feed children is what stalls the
pager. A fixed-position element that only reads geometry can do neither.

### Verified

37 fixtures, eighteen of them false-positive guards, plus a direct test of the
control itself: hover a card, the button appears, clicking it writes the page
name through `storage.local` and hides the post. The runner's storage stub is
now backed by a real object rather than a no-op, so a write that silently
failed would show up as a failure instead of passing.

## 1.1.81

### Changed

- **Diagnostics is hidden in the release build.** It used to appear for anyone
  who opened the popup on a Facebook tab, which is not something an ordinary
  user should be shown.

  It is not removed. Android has no devtools and the AMO release is what runs
  there, so that panel is the only way to see what the extension is doing on a
  phone — it has found nearly every bug in the last fortnight. It is now
  revealed by **tapping the popup title three times**, which works with a mouse
  and with a thumb, and the choice is remembered, so on a phone it is enabled
  once and stays.

### Added — test harness

- **A popup smoke page**, generated by `tests/build.py` alongside the fixture
  runner. The fixture harness covers detection and never touches the popup, so
  a broken selector or a listener wired to a missing element would not show up
  until someone opened it on a phone. It renders the real popup against stubbed
  extension APIs; `storage` is backed by a real object so the reveal toggle can
  be seen to persist rather than merely to fire.

### Verified

35 fixtures, seventeen of them false-positive guards. The popup page confirms
the panel is hidden on load, revealed on three taps, persisted, and hidden
again on three more.

## 1.1.80

Confirmed false positive: the shape rule hid a post from a Page the user
follows. On a page load serving neither a byline timestamp nor a
permalink it recognises, a followed Page sharing a link is indistinguishable
from an advertiser sharing one — there is no signal left to tell them apart.

### Added

- **A keep list.** "Never hide posts from these pages", in the popup: one page
  name per line, as it appears in the page's address. Nothing named there is
  ever hidden by the shape rule. The audit list already names whatever the rule
  took, so recovering a lost page is a copy and a paste.

  This is a real fix rather than a workaround only because the rule cannot be
  tightened into correctness here: every guard that would have saved that
  post also lets advertisers through, and the whole point of the extension is
  that they do not.

- **The audit list explains itself.** Each entry now carries the three things
  the rule actually consults — `ts=` whether the byline resolves to a time,
  `subj=` how many subjects the card links to, `perma=` whether it links to
  itself — plus the card's links. Asked why one such post matched, the honest
  answer was that I had never seen the card, only its name.

### Changed — test harness

- **The build refuses to run if an escape sequence has been eaten.** Three
  times now one has been: a word boundary arriving as a literal backspace,
  twice, so the boundary matched nothing; and a newline escape arriving as a
  real line break, which split a regex across two lines and stopped content.js
  parsing entirely. All three read correctly in an editor, so the check reads
  the bytes.

- **A parse failure now says so.** The runner sat on "running…" forever, which
  looks exactly like an infinite loop and twice cost far longer to diagnose
  than the typo behind it.

### Verified

35 fixtures, seventeen of them false-positive guards. Two are new: the followed
Page's post, checked to confirm it is hidden *without* the keep list and visible with
it, and a guard proving a keep list does not switch the rule off for everyone
else.

## 1.1.79

Both of 1.1.78's fixes missed on a live feed. The stories tray was hidden five
times in one reading, and the timestamp veto never fired at all — Facebook
served that page with no byline references anywhere, so the survey read
`0 dangling, 0 resolve cleanly` across every visible card. A veto that depends
on a signal Facebook may simply omit cannot be the only safeguard.

### Fixed

- **The stories tray, counted properly.** Its tiles link three segments deep
  (`/stories/<id>/<token>`), and the subject count only recognised
  single-segment profile links — so a tray whose tiles pointed at two pages
  came to two, under the limit. A story tile is a subject like any
  other.

- **A container of several posts could be hidden whole.** The "is this more
  than one post?" test was asked about the candidate's parent and never about
  the candidate itself, so a block of three posts that happened to fit under
  the height ceiling was eligible — three real posts gone on one judgement
  meant for one.

- **Nothing is hidden near an open viewer now.** 1.1.77 checked the element the
  rule settled on; after releasing a card the sweep came straight back and hid
  an inner block of it, because the element it chose that time did not itself
  contain the viewer.

### Changed — test harness

- **The sandbox is explicitly 1000px wide.** Left to shrink-wrap, it came out
  at feed-post width and was indistinguishable from a card, so a document-wide
  sweep could select and hide the sandbox itself — after which every remaining
  fixture failed for a reason that had nothing to do with the fixture.

- **The fixture card is captured before the scan.** Setting `style.display`
  re-serialises the whole attribute, so `width:680px` comes back as
  `width: 680px` and the runner's own selector stopped matching the element it
  was written for. The assertion silently fell back to the outer wrapper, and a
  working fix reported as a failure for most of an afternoon.

### Verified

33 fixtures, fifteen of them false-positive guards.

## 1.1.78

The audit list caught what it was built to catch. On 2026-09-23 it named
three Pages posting normally, hidden as ads.

### Fixed

- **A byline that still says how old the post is now vetoes the shape rule.**
  Every post left showing in that panel carried a byline reference resolving to
  a time — "27 minutes ago", "7 hours ago", "about an hour ago" — and every ad's
  was dangling or absent. Facebook puts "Sponsored" where a post puts its age,
  and the ad's version has no text at all.

  This replaces enumerating permalink shapes as the main safeguard, which was
  never going to hold: `/stories/<id>/` is used by ads *and* by real posts, so
  it can sit in neither list, and Pages whose self-link took that form were
  being hidden. A timestamp is not a shape Facebook can quietly rename.

- **The stories tray, a third time.** "Online status indicatorActive ->
  /<page>". Counting story links only caught it when several tiles happened to
  be linked at once; it is now caught by counting subjects. A post has one, the
  tray has one per tile.

- **Five word boundaries in the new timestamp pattern were literal backspace
  characters**, so `ago` matched nothing and the veto would have failed
  open — every Page post above would still have been hidden. Caught by checking
  the bytes rather than reading the line, which renders identically either way.
  This is the second time this exact trap has bitten in this project.

### Verified

33 fixtures, fifteen of them false-positive guards. Both new guards were
checked against the rule they guard — the Page post is stopped only by the
timestamp, the tray only by the subject count, and a real ad still qualifies on
both counts — rather than only checked for passing.

## 1.1.77

Reported 2026-09-23: clicking into comments on a post or a picture sometimes
showed nothing at all.

I could not reproduce the exact path from outside the browser, so this is two
changes — one that removes the most likely cause, and one that makes the
symptom self-correcting whatever the cause turns out to be.

### Fixed

- **A viewer opening inside a hidden card now frees it.** Facebook builds the
  photo and comment viewers out of nodes already on the page, so one can open
  inside a card that is hidden — it then renders perfectly into `display:none`
  and you click through to a blank screen. Whatever earned that hide, a viewer
  being inside it means the hide is now doing harm, so it lets go immediately
  rather than waiting to establish why.

- **Nothing may be hidden that contains a viewer.** The dialog check ran on the
  element the rule started from, not on the card it settled on — so a card
  could be hidden while holding a viewer that sat below the starting point. It
  is now checked in both directions, and the walk that expands a hide to the
  whole card stops at anything containing one.

### Added

- The panel reports `viewers released`. If that number is climbing, this is
  happening and the cause is still worth finding; if it stays at zero while the
  problem persists, the cause is somewhere else entirely.

### Verified

31 fixtures, thirteen of them false-positive guards. The new one was checked
against the failure mode it guards — the card is hidden, the viewer opens, the
hide releases — rather than only checked for passing, since a guard that never
exercises its rule has slipped through twice in this series.

## 1.1.76

Ads still losing their picture and keeping everything else — one by
screenshot, and one straight from the panel, which listed the
same card under `HIDDEN BY SHAPE` *and* under `NOT HIDDEN`. 1.1.75 fixed the
wrong half of this.

### Fixed

- **The climb ran out of steps.** It was capped at fourteen levels, and
  Facebook nests a call-to-action block twenty-odd elements below the card, so
  a climb starting at an outbound link never reached the card and kept whatever
  fitted on the way up — the media block. Raised to thirty.

  No fixture caught this because every fixture card was four levels deep. There
  is one thirty levels deep now, and it failed before this change.

- **Nothing enforced "hide whole cards".** Whatever route picks an element, if
  it is feed-post width the thing to hide is the card, so the hide now walks up
  until the next step would leave it.

- **That walk could have taken the entire feed.** It stops when a parent holds
  more than one card-shaped child — but a post that is already hidden has no
  box, so a feed column with everything else hidden looks exactly like a single
  card. On a short feed it would have hidden the lot. It now asks whether the
  siblings *are* posts rather than whether they are visible. Found by the
  harness, before it ever ran on a page.

### Changed — test harness

- **Fixtures now sit beside a neighbouring post.** The sixteen nesting wrappers
  were indistinguishable from a card's own — each holding one child of the same
  width — so the expand-to-card walk climbed out of the fixture and into the
  harness itself. On a real page those wrappers belong to the card; here they
  do not, and nothing said so.

- The panel reports which rule made each hide (`via label` / `via shape`).
  Both report "sponsored", so a partial hide looked identical whichever
  produced it, and telling them apart took a screenshot and a guess.

### Verified

30 fixtures, twelve of them false-positive guards.

## 1.1.75

### Fixed

- **Some ads lost their picture and kept everything else.** Screenshot
  2026-09-11: an ad with the image gone and the byline, the body
  text and the reaction counts still sitting there. The climb from an outbound
  link to the card it belongs to was stopping at the media block, because a
  card is often much taller than the block its link sits in and the rule read
  that difference as having left the card.

  Height was the wrong thing to stop on. The upper height bound already keeps
  the climb out of the feed column; what it does not cover is a feed short
  enough to fit inside it, so the climb now stops at the first ancestor holding
  more than one card-shaped child. A card has one subject; a container of cards
  has several.

### Changed — test harness

- **A throw in a fixture no longer stops the run.** It used to leave the page
  sitting on "running…" with no output and nothing in the console, which is
  indistinguishable from an infinite loop and far worse to debug than a failing
  test. An editing mistake that deleted a function definition cost several
  minutes exactly that way while preparing this release. Throws are now
  reported as `ERROR` against the fixture that hit them.

### Verified

29 fixtures, twelve of them false-positive guards. The new one is the Goose
Creek card, and it failed before the fix and passed after it.

## 1.1.74

The audit list added in 1.1.73 did its job on the first reading. Of 36 posts
hidden by shape, 32 were unmistakably advertisers. The rest were not posts at
all.

### Fixed

- **The stories tray was being hidden.** It sits at the top of the feed at
  exactly feed width, so it passed the shape rule's size test, and the audit
  list caught it twice as `Online status indicatorActive -> /stories/…`. A post
  links to at most one story; the tray links to every one of them, and that is
  now the test.

- **So were Facebook's empty spacers.** The boxes left behind holding a scroll
  position are feed-width and several hundred pixels tall — `els=12 a=0 img=0
  text=0` in the panel. A candidate must now have something to say (40
  characters) before a rule that infers rather than reads gets a say on it.
  This also accounts for both `(no byline link)` entries in that list.

- **"Still showing" was counting those spacers too.** It read 25 when several
  of them were empty boxes, which made the feed look far less filtered than it
  was. Empty boxes are no longer counted as posts.

### Verified

28 fixtures, twelve of them false-positive guards. Two are new — the stories
tray and an empty spacer — and every fixture now carries a realistic amount of
body text, because the new "looks like a post" test would otherwise have been
satisfied by nothing and the suite would have passed without exercising it.

## 1.1.73

A screenshot of a "Sponsored" card that was still visible caught a change that was about to make
things worse, and showed why the outbound test was too narrow.

### Fixed

- **`/stories/<id>/` is no longer treated as a self-link, and must never be.**
  It was about to be added to the permalink veto as an organic post shape. The
  screenshot showed it on an ad — so adding it would have permanently immunised
  that ad and every one shaped like it. `DESKTOP-AD-LABELS.md` now records this
  as a trap: only add a self-link shape on evidence that ads do not use it.

- **An ad does not have to use Facebook's link redirector.** The test looked
  for `/l.php`, and that card linked straight out to the advertiser's own site, so
  nothing saw it. What an ad cannot avoid is leaving Facebook — the click has
  to reach the advertiser — so any link to a non-Facebook host now makes a card
  a candidate. The permalink veto is unchanged and still does the safety work.

- **The panel was hiding the evidence.** Each unhidden card reports at most ten
  facts, and aria-labels were crowding links out: that card had seven
  links and showed five, with the cut falling exactly where the answer was.
  Links are reported first now.

### Added

- **The shape rule now shows its work.** `HIDDEN BY SHAPE` lists a name and a
  link for each post it took, because a count cannot distinguish a feed that is
  mostly ads from a rule that has started eating posts — and 1.1.72 reported 40
  of them. A real name in that list means the rule is wrong, and unticking
  **"Hide ads Facebook doesn't label"** is the fix.

### Verified

26 fixtures, ten of them false-positive guards. Two are new: the National
Geographic card, and a friend posting the same link directly — the one the
widened outbound test could most easily have swept up.

## 1.1.72

The panel from 1.1.71 reported `0 have a DANGLING byline ref, 0 resolve
cleanly` across all sixteen visible cards. Facebook had stopped shipping the
byline reference altogether, so the signal 1.1.70 was built on no longer
existed on the page and the rule could not fire — `by-shape` fell from 14 to 2
while an obvious ad sat visible.

### Added

- **A second way to recognise an unlabelled ad: the outbound link.** Facebook
  routes off-site links through `/l.php`, and an ad always has one, because
  sending you off-site is the entire point. An organic post only has one when
  it happens to be sharing a link — and it still links back to itself.

  The permalink veto is unchanged and still does the safety work: either signal
  gets a card as far as "does this post link to itself?", and a real post
  always does.

### Fixed

- **The permalink veto knew one shape of permalink out of a dozen.** It looked
  for `/posts/`, which is how a profile post links to itself and how nothing
  else does. A group post links to `/groups/<id>/`, a local listing to
  `/commerce/listing/`, a reel to `/reel/`. Every one of those was a real post
  the ad rule could have matched — the earlier panel showed one, a buy-and-sell
  post whose only self-link was `/commerce/listing/<id>`. Now covers
  groups, listings, marketplace items, reels, videos, watch, photos, events,
  notes and shares.

- **Link paths were parsed against the page origin, with no fallback.** Where
  that origin is unusable the parse threw and the raw href was compared
  instead — query string and all — so every path test quietly failed. Live this
  never happened; in the fixture harness it happened on every link, which meant
  the guards proving a real post survives were passing without exercising the
  rule they guard. Two of them were vacuous when written.

### Added — diagnostics

- Each unhidden card now reports `els= a= img= text=`. Three of the four cards
  in the 1.1.71 panel reported no text, no links, no aria and no labels at all,
  which is not what a feed post looks like — so either the report was blind or
  they were not posts, and there was no way to tell which. These counts settle
  it: an empty box holding a scroll position reads `a=0 img=0 text=0`.

### Verified

24 fixtures, nine of them false-positive guards. Three are new: an ad with no
byline reference at all, a friend sharing a news link, and a group post whose
self-link is a listing rather than a profile post.

## 1.1.71

Three reasons ads and unfollowed posts stayed visible in 1.1.70, all three
found by reading the diagnostics panel from a live feed rather than by
guessing. The panel reported 16 posts hidden and 15 still showing.

### Fixed

- **Cards were judged once, at the only moment they could not qualify.** The
  shape rule ran only over the subtree a mutation had just touched. A card is
  inserted while its byline label is still live, so the rule correctly declines
  to hide it — and Facebook deletes that label a beat later, in a mutation
  whose target is no longer inside the card. Nothing looked at it again. The
  panel showed this exactly: `by-shape 14`, and an ad reporting a missing
  byline reference with no permalink sitting visible.

  The sweep now re-checks the whole document twice a second, starting from the
  label references rather than from every `<div>` — a feed holds a handful of
  the former and thousands of the latter, which is what makes repeating it
  affordable.

- **"Follow" was never examined on desktop.** It is a `<div>`, and the scan
  looked at spans, links and labelled elements only. The panel had been
  printing `div:"Follow"` inside cards that stayed visible. Elements with
  `role="button"` are now scanned too.

- **Posts with no landmark could not be hidden as unfollowed.** Where a card
  carries no `role="article"`, no pagelet and no `aria-posinset` ancestor,
  every route to the post returned nothing, and the one remaining route
  refused to run for this reason — a stray Follow button inside a quoted post
  could have taken out the whole card. It now runs, with the check that was
  missing: the button must sit at the card's own author level, not inside
  something the post quotes.

### Verified

21 fixtures, seven of them false-positive guards. Two are new: a friend's post
quoting a Page you don't follow, which must survive that page's Follow button,
and a card that is only identifiable after the scan that first saw it. The
first of those caught a genuine regression in this change before it shipped —
an earlier version of the author-level test hid the quoted post.

## 1.1.70

### Added

- **Ads Facebook does not label are now hidden.** Some feed ads carry no
  readable label at all: the byline is an anchor wrapping an empty span whose
  accessible name comes from a node deleted immediately after use, so "Ad"
  renders on screen while existing nowhere in the document. Eleven text and
  attribute routes were measured against it and all failed — see
  `DESKTOP-AD-LABELS.md`.

  Such a card is identified by shape instead, and it takes **two** signals
  together:

  1. **A dangling `aria-labelledby`** — a byline reference to a label that is
     neither live nor cached. An organic post's resolves, to a timestamp.
  2. **No permalink.** A real post links to itself
     (`/name/posts/pfbid…`); these link only to the advertiser and out through
     `/l.php`.

  Either alone is too weak. Both together matched every ad observed and no
  organic post observed.

- **On by default**, with a checkbox to switch it off. This is the only rule
  that infers rather than reads, so it is the only one that can hide a real
  post — but an extension whose purpose is hiding ads should do it out of the
  box. If a real post ever disappears, unchecking **"Hide ads Facebook doesn't
  label"** is the first thing to try, and a fixture guarantees that switch
  actually works.

- The panel reports `by-shape`, counting posts hidden this way. If it climbs
  while posts seem to be going missing, that rule is the cause.

### Verified

19 fixtures, six of them false-positive guards — including a post that has a
dangling byline reference *and* a permalink, which must stay visible, and one
asserting the rule is genuinely disabled when unchecked.

Two bugs were caught building it: a `` that became a literal backspace in the
permalink pattern, and settings leaking between fixtures so the guard was
running with the rule left on by the previous test.

## 1.1.69

### Added

- **The panel now measures whether a dangling byline reference identifies an
  ad.** Every ad observed on 2026-09-11 carried one: an `aria-labelledby` in its
  byline pointing at a label Facebook deletes once the accessible name has been
  computed. An organic post's byline reference resolves — to a timestamp, e.g.
  `by#_r_2dg_->"about an hour ago"`.

  If that split holds across a whole feed, it is a structural signal tied to
  the exact mechanism that hides the word "Ad" — and a far better one than the
  domain-plus-CTA shape heuristic, which would also match a friend sharing a
  news article.

  ```
  feed posts hidden: 14   still showing: 11
    of those showing: 7 have a DANGLING byline ref, 4 resolve cleanly
  ```

- **It is counted, not acted on.** Nothing is hidden on the strength of it yet.
  Detection that hides a friend's post is worse than detection that misses an
  ad, so the split gets measured on a real feed before any code depends on it.

### What to look for

A clean split — dangling on the ads, resolving on the friends' posts — means
this can be implemented behind the existing `expect: visible` fixture guards. A
muddy one means organic posts drop their byline labels too, and the idea should
be abandoned rather than tuned.

## 1.1.68

### Fixed

- **The survey's two numbers both meant something other than they said.**

  `hidden by us: 1` appeared directly beneath a hidden count of 7. A hidden post
  is `display: none`, so it has no box, fails every size filter and cannot be
  counted by looking at the page. The count now comes from `hiddenPosts`, which
  is authoritative.

  `not hidden: 21` counted the left nav (360px), the stories tray and the
  Messenger window alongside actual posts, so it read like 21 unblocked ads
  when most of it was page furniture. Candidates are now restricted to
  feed-post width — 600 to 760 on this layout — and at least 300 tall.

  The line now reads:

  ```
  feed posts hidden: 7   feed-width posts still showing: 5
  ```

  Verified against a page containing three real posts, one marked hidden, a
  360px nav, a 338px chat window and a short stories tray: reports 3 showing.

### Note

Fourth instrument correction in a row. The panel is now the only thing standing
between a real answer and a plausible one, so each of its numbers gets a test
before it is quoted — the same rule the extension itself has had since the
fixture harness went in.

## 1.1.67

### Fixed

- **The whole-feed survey added in 1.1.66 reported one card.** It keeps only the
  outermost of each nested run, and with the viewport restriction removed the
  outermost qualifying element is the **entire feed column** — full page width,
  thousands of pixels tall — which contains every card, so all of them were
  discarded as nested inside it. Since it contained hidden posts, the one
  "card" counted as hidden, and the panel read:

  ```
  feed cards on page: 1   hidden by us: 1   not hidden: 0
  ```

  on a page full of ads.

  Candidates are now bounded above as well as below: a feed card is about 680
  wide and a few hundred tall, so anything wider than 900 or taller than 1800 is
  a container rather than a card.

  Verified against a simulated feed column holding six cards, two of them
  marked hidden: reports 6 / 2 / 4.

### Note

Three instrument bugs in a row now — viewport-only scope, then this, after the
leaf-only blind spot earlier. Each produced a confidently wrong reading. The
lesson is the same one the fixtures taught: a diagnostic needs its own test
before its output is trusted, and the survey now has one.

## 1.1.66

### Fixed

- **The diagnostics panel was reporting a keyhole and reading like a summary.**
  `sampleUnhiddenPosts` only examined cards **in the viewport**, capped at
  three. So "no unhidden ads" meant "none among three cards currently on
  screen", while a page full of them scrolled past above and below.

  Several readings across this investigation looked clean for exactly that
  reason. The user was looking at the page; the panel was looking at a window
  roughly one post tall.

  It now surveys every post-sized card in the feed and reports the totals:

  ```
  feed cards on page: 31   hidden by us: 16   not hidden: 15
  ```

  Detailed samples still prefer on-screen cards, since those are the ones being
  complained about, but fall back to the rest of the page rather than reporting
  nothing. The sample header says how many of the total it is showing.

### Why this matters beyond the numbers

Every "it looks clean" conclusion drawn from this panel needs re-reading in
that light. A diagnostic whose scope is narrower than its wording is worse than
no diagnostic, because it produces confident wrong answers — which is precisely
what it was built to stop.

## 1.1.65

### Added

- **`DESKTOP-AD-LABELS.md`** — a record of every mechanism tried against ads
  whose label cannot be read from the DOM, and how each was ruled out. Eleven of
  them: leaf text, non-leaf own text, SVG `<text>`, `<use>` sprites, live
  `aria-labelledby`, rescue-from-removal, a `documentElement`-rooted observer,
  the `/ads/about/` path, CSS `::before`/`::after` content, `background-image`
  and `mask-image`.

  Written because the answer to "have we tried X?" was becoming expensive. The
  next attempt should start from what is already eliminated.

### Re-verified, not changed

`data-ad-rendering-role` is still **not** an ad marker, despite being all over
these cards and looking ideal when nothing else was left. Measured on a live
feed: an ordinary local buy-and-sell group post reported

```
ad-roles=profile_name,story_message,meta,title   ad-preview=yes   ads/about=no
```

Not an ad. `data-ad-preview` and `data-ad-comet-preview` are no better; the
same post carried those too. The long-standing warning in `classifyLabel` now
carries a 2026 date and this counter-example, in the code and in the doc.

### What this release does not do

It does not hide ads whose label is absent from the page text. Reading
`textContent` on such a card gives `<advertiser> Verified account⁠  · Shared
with Public…`: the icon titles are present and the word "Ad" simply is not. That is not obfuscation to see through; there
is nothing there.

The remaining option is a shape heuristic — advertiser domain, call-to-action,
and a byline anchor with no path — left unimplemented because it would also
match a friend sharing a news article. The fixture corpus and its
`expect: visible` guards exist to make that decision measurable if it is ever
taken.

## 1.1.64

### Added

- **The unhidden-card report now lists where the card's links point.** 1.1.63
  detects ads by their `/ads/about/` explainer link, so when a card survives the
  first question is simply whether it has one — and the panel could not say.

  A card got through reporting two author links joined by `span*:"and"`, and an
  `aria:"…, view story"`. That is
  branded content — a creator's post promoting a brand — rather than a
  standard sponsored ad, and it may carry a different explainer or none at all.
  Rather than guess a seventh time, the report now shows the link paths.

  Paths only. The query strings Facebook appends to these hrefs run to several
  hundred characters and say nothing.

## 1.1.63

### Fixed

- **Ads are now detected by their "Why am I seeing this ad?" link.** Inspecting
  a live ad settled a question five releases had failed to
  answer. Its byline label is:

  ```html
  <a href="/ads/about/?__cft__[0]=…">
    <span><span aria-labelledby="_r_7g_"><span></span></span></span>
  </a>
  ```

  The innermost span is **empty**. The word "Ad" is plainly on screen — it is
  simply not text: it exists only as an accessible name computed from a span
  Facebook deletes immediately afterwards. That is why leaf text, non-leaf own
  text, `<use>` sprites, live `aria-labelledby`, and rescue-from-removal all
  came back with nothing, and why the panel kept reporting
  `by#<id>->MISSING`.

  The anchor's `href` is the signal, and it is structural rather than textual:
  `/ads/about/` is Facebook's ad explainer, linked from advertisements and
  nowhere else. An organic byline links to the post's own permalink. `a` was
  already in `LABEL_SELECTOR`, so this costs one attribute read on elements the
  scan visits anyway.

  Verified both directions — the fixture fails on 1.1.62 and passes here — and
  the pattern was checked against four hrefs, matching both the relative and
  absolute ad forms while rejecting `/groups/adsandmarketing/posts/9`.

### What this deliberately does not use

`data-ad-rendering-role` is all over these cards and looks perfect. The warning
already in `classifyLabel` stands: it appears on ordinary posts too, because
Facebook renders both through the same story template, and keying off it hides
the entire feed.

16 fixtures pass, five of them false-positive guards.

## 1.1.62

### Fixed

- **Labels deleted before the observer could read them are now rescued from the
  removal record.** This is why four advertisers in a row reported
  `by#<id>->MISSING`.

  MutationObserver callbacks are asynchronous. Facebook creates the label span,
  sets its text, lets the browser compute the card's accessible name from it,
  then empties and removes it — all in one synchronous task. By the time the
  callback runs and reads the added node, `textContent` is already `""`, so
  `rememberLabelTarget` bails and nothing is cached. The card is left pointing
  at an id that no longer resolves.

  The data is still there, in the records we were ignoring: a removed text node
  keeps its content, and a removed element keeps its `id`. The observer now
  reads `removedNodes` as well as `addedNodes` and caches from either.

  Bounded to property reads — an element matters only if it carries an `id`, a
  text node only if its parent is an id-bearing leaf.

  Verified both directions: the fixture fails on 1.1.61 and passes here.

- The panel reports `rescued-from-removal`. Non-zero means Facebook is deleting
  labels faster than an async callback can read them.

### Why 1.1.61 did not fix it

Widening the observer to `documentElement` was the right thing to rule out, and
it ruled it out: the spans are not being inserted somewhere unwatched. They are
inserted where we are watching and destroyed before we look. Two different
problems with identical symptoms.

13 fixtures pass, three of them false-positive guards.

## 1.1.61

### Fixed

- **Label spans inserted outside `<body>` were never seen.** The observer was
  rooted at `document.body`, so anything Facebook parks directly under `<html>`
  was invisible to it however briefly it lived — and these portal spans are
  page-level scratch nodes of exactly that kind.

  1.1.60's `MISSING` marker is what exposed it. An ad reported:

  ```
  matched 10  anchored 10
  by#_r_18n_->MISSING
  ```

  The card pointed at a label that was neither live nor cached, while the
  counts showed nothing had been recognised at all. Not a detection bug and not
  an anchoring bug — a third category: the span existed, was used to compute
  the card's accessible name, and was gone before the extension ever saw it.

  The observer now watches `document.documentElement`. `cacheLabelTargets`
  already runs synchronously on every added element, so a span reaching the
  document at all is now recorded before it can be removed, and
  `rememberLabelTarget` resolves forward from it.

  The added coverage is `<head>` and stray top-level nodes. Facebook mutates
  head when injecting styles, so this is not free — but observer cost was
  measuring 0.0% of wall-clock across 89 calls, and the panel reports that
  figure, so a regression shows up as a number rather than an argument.

### Three failure modes, now distinguishable

This investigation ran through all three, and the panel separates them:

| symptom | reading |
| --- | --- |
| label not recognised | `matched` low, no `by#` evidence |
| recognised, nowhere to put it | `matched` > `anchored` |
| label never observed | `by#…->MISSING` |

Each needed a different fix — 1.1.57/1.1.58, 1.1.59, and this one.

## 1.1.60

### Added

- **Dangling `aria-labelledby` references are now reported.** The evidence line
  silently skipped any reference whose target resolved to nothing, so a card
  pointing at a label we never saw looked identical to a card with no label at
  all. Those are very different problems.

  One ad (2026-09-11) reported `matched 9, anchored 9` — no
  anchoring gap, so its label was never matched — and an evidence line with no
  `by#…` entry at all, while another ad minutes earlier showed
  `by#_r_29u_->"Ad"`. The difference is almost certainly that Facebook had
  already deleted the first one's span, and it was never cached.

  Such references now print `by#<id>->MISSING`, which distinguishes "this card
  has no label" from "this card points at a label that no longer exists".

### Why this matters more than it looks

A recorder on a live feed measured **125 of 128 label nodes deleted within 40
seconds**. `labelTextById` exists precisely so an ephemeral label survives long
enough to be useful, and `rememberLabelTarget` resolves forward the moment it
sees one. If a card is pointing at an id that is neither live nor cached, the
extension never observed that span at all — and no amount of work on detection
or anchoring addresses that.

Note the constraint on any fix: `processLabel` must **not** queue elements
merely for carrying an unresolvable `aria-labelledby`. That was tried in 1.1.30
and froze the feed — a 300-post feed carries roughly 1,800 such elements.

## 1.1.59

### Fixed

- **Ads with no landmark above their label could be detected but not hidden.**
  The panel caught it exactly, for the first time this whole investigation:

  ```
  matched 47  anchored 46
  #2 680x760  article=- posinset=descendant pagelet=-
     by#_r_29u_->"Ad"  by#_r_2a7_->"Shop now"
  ```

  Detection was fine — the label resolves through `aria-labelledby` to `"Ad"`.
  But the card carried no `role="article"`, no `data-pagelet`, and its
  `aria-posinset` sat *inside* it rather than above the label, so
  `label.closest('[aria-posinset]')` returned null and every strategy in
  `findPostContainer` gave up. One label recognised and never anchored — which
  is what `matched` exceeding `anchored` means, and why that pair is in the
  panel.

  A last-resort climb now walks to the outermost ancestor that is still
  card-shaped, stopping at the width jump into the feed column. A card and its
  wrappers share one width (680 on this layout) while the column is far wider,
  so that jump is a reliable boundary.

  **Not applied to `unfollowed`.** A stray Follow button anywhere inside a card
  would otherwise take the whole card out, and with no landmark there is nothing
  left to confirm the label belongs to the post's own author. Same reasoning as
  the `role="complementary"` rail. A fixture guards it.

### Two of my own bugs, caught before shipping

The fixture for this failed twice before it passed, both times because of the
harness rather than the page:

1. The climb applied its width-jump rule from the very first step. A label is a
   narrow inline span and its parent is the whole card, so it fired instantly
   and the climb ended having found nothing.
2. Before that, the panel that produced the evidence had the same leaf-only
   blind spot the detector had (fixed in 1.1.58), which is why three earlier
   cards looked label-less when they were not.

12 fixtures pass, including three false-positive guards.

## 1.1.58

### Fixed

- **The unhidden-card report had the same blind spot the detector just lost.**
  It collected only leaf elements, so an "Ad" sharing an element with an icon
  was invisible to it — which is precisely how several ad cards
  managed to look label-less while plainly showing "Ad · 🌐" on screen.

  Non-leaves are now reported by their **own** text, the same way
  `classifyLabel` reads them since 1.1.57, and marked with `*`:

  ```
  span:"<advertiser>" span*:"Ad" span:"·" span:"<ADVERTISER>.COM"
  ```

  A diagnostic that cannot see what the detector can see is worse than none: it
  produced a fixture guessing at `<span>Ad<svg/></span>`, which passes while the
  real card still gets through.

### Note

1.1.57's fix is correct and stays — that form exists and is now handled. It is
simply not what those cards are doing, and this release is about being
able to tell the difference.

## 1.1.57

### Fixed

- **Ads whose label shares an element with an icon were never read.** Several
  feed ads render the byline as `<span>Ad<svg>…</svg></span>` — text and a
  globe icon in one element. `classifyLabel` only read text from leaves, and
  such an element is not a leaf; it is not character-split either, so it fell
  through unexamined and the ad stayed visible.

  Observed live on an ad (2026-09-11): the panel showed a `span:"·"` for
  the byline separator, **no `"Ad"` leaf anywhere**, and no `<use>` or
  `aria-labelledby` route to one. All three known indirections ruled out at
  once, which is what pointed here.

  `classifyLabel` now also reads an element's **own** text nodes, ignoring
  anything its children hold. That preserves the reason leaves were the rule in
  the first place: it never descends, so the quadratic re-walk of the same
  subtree at every nesting level — which once stalled Facebook's rendering —
  cannot happen. One pass over direct children, capped at 300 characters.

### Not caused by the diagnostic releases

The same fixtures were run against v1.1.50, v1.1.52 and current:

| fixture | v1.1.50 | v1.1.52 | current |
| --- | --- | --- | --- |
| `label-beside-icon` | FAIL | FAIL | FAIL (fixed here) |
| `svg-text-inline` | FAIL | FAIL | PASS since 1.1.53 |
| all others | pass | pass | pass |

So this gap predates every release from yesterday, and 1.1.53-1.1.56 detect
strictly more than 1.1.50 did while breaking nothing. Ads returning is most
likely Facebook shifting more of them into a form that was never handled.

All 10 fixtures pass.

## 1.1.56

### Added

- **The unhidden-card report now shows how a label could be reached, not just
  what text is present.** Two ad cards in a row reported this shape:

  ```
  #2 680x837 cls=x1lliihq
     span:"<advertiser>" span:"·" a:"#<brand>partner" span:"<ADVERTISER>.COM"
  ```

  Note the `span:"·"` — the separator that sits *after* "Ad" in Facebook's
  byline — with no "Ad" text anywhere on the card. Different advertisers, same
  absence, so on these cards the label is not rendered text and the panel had
  no way to say what it actually is.

  Each card now also reports the three remaining mechanisms by which "Ad" could
  be carried: `<use>` sprite references and what they resolve to,
  `aria-labelledby` targets (falling back to the label cache when Facebook has
  already deleted the span), and plain `aria-label` values. Example from a
  harness card with no "Ad" text at all:

  ```
  evidence: by#lbl1->"Ad" aria:"Sponsored content"
  ```

  Whichever line carries "Ad" is what detection has to read.

### Status as of 2026-09-11

Desktop is reported working. No panel reading was captured while it was
failing, so **which** of 1.1.51-1.1.56 fixed it is unknown, and it may simply be
that Facebook's markup moved back. Treat the desktop cause as unexplained.

That is different from mobile, where 1.1.50 rests on five one-variable
experiments and a control test. Nothing here has that standing.

If ads return: open the panel first, before changing anything. `matched` vs
`anchored` separates detection from anchoring, and the `evidence:` line on an
unhidden card says how its label is reachable. That reading is the thing this
session never got, and it is what would let the next fix be chosen rather than
guessed.

### Why a sixth release without a fix

Because every fix since 1.1.51 was chosen from a console probe, and probes race
a DOM that deleted 125 of 128 label nodes in 40 seconds. Three of them looked
right and none landed. This reports from inside the content script, against the
same document the scan sees, and it costs nothing until the panel is opened.

## 1.1.55

### Fixed

- **The `VISIBLE, NOT HIDDEN` report was unreadable.** Its first live run came
  back as ten identical `span:"Facebook"` entries per card. Those are icon
  `<title>` elements — leaves with text, no box, dozens per card — and taking
  the first ten in DOM order crowded out every label that mattered.

  It now reports only leaves that actually render, each text once. The same
  card in a harness goes from ten `span:"Facebook"` to
  `span:"<advertiser>" span:"Ad" span:"See more"`.

- **Landmarks were read off the wrong element.** The report used
  `getAttribute` on the card's outermost `div`, so every card looked
  landmark-less — including ones the extension anchors without trouble. It now
  uses `closest()` and `querySelector()`, and says whether the landmark is on
  the card or one of its descendants.

  This matters for the open question: the live report showed 680x781 ad cards
  with no landmarks, while posts of the same width were being hidden
  successfully. That contradiction was an artefact of where the attribute was
  read, not a fact about the page.

## 1.1.54

### Added

- **The diagnostics panel now reports what it is *missing*.** A `VISIBLE, NOT
  HIDDEN` section lists the post-sized cards on screen that were not hidden,
  with each card's dimensions, landmark attributes, and the short texts found
  inside it:

  ```
  VISIBLE, NOT HIDDEN:
    #1 680x783 role=- posinset=- pagelet=-
       span:"<advertiser>" span:"Ad" span:"See more" span:"Like"
  ```

  Three releases in a row were aimed at ads that stayed visible, each built on
  a plausible reading of a console probe, and none of them landed. The reason
  is in the numbers from an earlier run: of 128 label nodes recorded over 40
  seconds, **125 were deleted by Facebook** before they could be examined
  again. Every `querySelectorAll` probe sampled an instant of that, and five
  consecutive probes gave five different answers.

  Reporting from inside the content script is not subject to that race. It sees
  the same document the scan sees, and it says what the label element actually
  is — whatever Facebook wraps it in this week — instead of requiring a guess.

  Computed only when the panel is opened, so it costs nothing during browsing.

### Why this instead of another fix

`matched 10, anchored 10` on 1.1.53 means everything recognised is being
hidden, so the ads getting through are not being recognised at all. Nothing in
the panel could say why, because it only described what the extension *did*.
This closes that gap before any further attempt at the cause.

## 1.1.53

### Fixed

- **Ads whose label is drawn as SVG text were never examined.** Facebook renders
  some feed-ad labels as vector text rather than a `<span>` — an inline `<svg>`
  holding `<text>Ad</text>`. Inspecting one on a live feed said it exactly:

  ```
  classifies as Ad: true    selectable: false
  ```

  `classifyLabel` recognises it fine; its leaf branch reads `textContent` like
  any other element. But `LABEL_SELECTOR` listed `span, a, use, [aria-label],
  [aria-labelledby]` and not `text`, so the scan never handed it over. Those ads
  were never looked at, whoever the advertiser was.

  `text` is now in the selector. SVG text nodes are rare next to spans, and the
  selector runs once per scanned subtree rather than per element, so the cost is
  negligible.

  Verified before and after against a harness with an ad card labelled by
  `<text>Ad</text>` at realistic depth: 1.1.52 leaves it visible, 1.1.53 hides
  it.

### What this does not settle

Whether those ads can then be **anchored**. A viewport sweep found the visible
ad card carried no `role="article"`, no `aria-posinset` and no `data-pagelet`,
so `findPostContainer` may still have nothing to grab even now that the label is
seen.

The diagnostics panel answers that without further probing: if `matched` now
climbs above `anchored`, detection is fixed and anchoring is the remaining
problem, and the fix is a card-sized-ancestor climb of the kind
`climbToChildOf` already does for the sidebar rail.

## 1.1.52

### Fixed

- **Ads whose label arrives in two steps were never hidden.** Facebook inserts
  the label span empty and fills it a moment later:

  ```html
  <span id="_r_7bt_"></span>          <!-- inserted -->
  <span id="_r_7bt_">Ad</span>        <!-- text arrives separately -->
  ```

  `rememberLabelTarget` reads `""` on insertion and bails, and the text that
  follows is a **text node** — which the observer's `addedNodes` loop skipped
  outright. The label was therefore never cached and the post never
  re-examined, leaving the ad on screen with everything needed to hide it
  present in the DOM.

  Confirmed on a live desktop feed: a visible 781px sponsored post, its label
  span present reading `"Ad"`, its referrer inside an `aria-posinset` and not
  in a dialog — every condition for resolution satisfied, and not hidden.

  Text nodes now complete their parent label instead of being dropped. Kept to
  O(1): only a parent carrying an `id` and holding no element children can be
  one of these spans, so it is a `textContent` read on a leaf plus a `Map` set,
  not a subtree walk. `rememberLabelTarget` resolves forward from there, so no
  extra scan is scheduled.

  Verified before and after against a harness reproducing the two-step
  insertion at realistic depth: 1.1.51 leaves the post visible, 1.1.52 hides it.

- The diagnostics panel reports `late-text labels` — how many labels completed
  this way. Non-zero confirms the path is live; zero on a feed with ads means
  they are being built some other way.

### Not yet observed in the wild

The first live run after shipping this reported `late-text labels: 0` while the
extension was otherwise healthy (`matched 26, anchored 26`, 11 hidden). So the
two-step insertion did **not** occur on that page load, and this fix cannot be
credited with restoring filtering — 1.1.51's startup fix is the likelier cause,
with the recurrence being that race landing badly once.

The gap is real and proven in a harness. Whether it happens on Facebook is
open. If ads reappear while this counter stays at zero, the mechanism is
something else and the diagnosis behind this release was wrong.

### Note

This is why the DOM probes disagreed with each other all session. Of 128 labels
recorded over 40 seconds on a live feed, **125 were removed by Facebook** before
they could be examined again. Sampling with `querySelectorAll` catches an
instant of that; only the observer sees the transitions.

## 1.1.51

### Fixed

- **The extension silently did nothing on desktop.** `document.body` was null
  when the content script ran, so this line threw:

  ```
  TypeError: MutationObserver.observe: Argument 1 is not an object
      content.js:1368
  ```

  Module evaluation stopped there. The observer never attached, the initial
  scan never ran, and `main()` never executed — but the message listener
  registers earlier in the file, so the popup kept answering and the extension
  looked completely healthy. Settings on, permission granted, no visible error,
  four sponsored posts sitting in the feed untouched.

  `run_at: "document_idle"` is supposed to guarantee a body exists. On
  facebook.com in Firefox it does not, at least sometimes. The startup now
  waits for `<body>` to appear instead of assuming it, watching
  `document.documentElement` until it does.

  Verified before and after against a harness with `document.body` forced to
  null: the previous build throws, this one starts clean and completes once a
  body appears.

- The diagnostics panel reports a `BOOT:` line whenever startup has not
  completed. This failure was invisible from the page and from the Browser
  Console — it only surfaced in the *page* console — and the panel showing
  "0 scans, 0 observer calls" after 147 seconds on a live feed is what led to
  it. Now it says so directly.

### Note

Nothing was wrong with detection. Facebook had not changed anything: the
labels, `aria-labelledby` portal spans and `aria-posinset` anchors were all
present and would have resolved normally.

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

### Verified on a device

Stock Firefox for Android, live feed: posts are hidden and the feed keeps
paging as you scroll. This is the first release for which that is true — 1.1.39
through 1.1.49 all claimed mobile support and none of them delivered it,
because every one was validated against a spoofed desktop viewport that does
not virtualise.

Blank space remains where each hidden post was. That is the deliberate trade,
and it is now the only known outstanding problem on mobile rather than one of
several.

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
