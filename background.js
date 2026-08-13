// Tracks how many posts have been hidden per tab and reflects it on the toolbar badge.
//
// This is an event page, not a persistent background page: Firefox MV3
// suspends it after ~30s idle and restarts it on the next message (that is
// what "stopped" in about:debugging means — it is normal, not a crash). Any
// module-level state is lost across that boundary, so the count cannot live
// in a Map here — doing so made the badge reset to 1 on the first increment
// after every suspend, while the popup simultaneously reported 0.
//
// The badge text itself is retained by the browser per tab and survives
// suspension, so read it back and treat it as the source of truth.

// See the note in content.js — Firefox provides `browser`, Chromium `chrome`.
const browser = globalThis.browser ?? globalThis.chrome;

const BADGE_COLOR = "#1877F2";

function setCount(tabId, count) {
  browser.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" });
  browser.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
}

async function readCount(tabId) {
  const text = await browser.action.getBadgeText({ tabId }).catch(() => "");
  const parsed = parseInt(text, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Reading the badge, adding to it and writing it back is a read-modify-write,
// and the content script can send several increments in flight at once. Chain
// each tab's updates so two of them can't both read the same starting value
// and lose one of the increments.
const pending = new Map(); // tabId -> promise of the last queued update

function enqueue(tabId, work) {
  const previous = pending.get(tabId) || Promise.resolve();
  const next = previous.then(work, work);
  pending.set(
    tabId,
    next.catch(() => {})
  );
  return next;
}

// Firefox lets an onMessage listener return a promise; Chromium does not — it
// requires sendResponse plus a literal `return true` to hold the channel open.
// The sendResponse form works in both, so it is the shared implementation.
// Getting this wrong fails silently rather than loudly: the popup's count
// request simply never resolves.
//
// Returning true also matters for the fire-and-forget messages. Keeping the
// channel open until the badge write settles is what stops the worker being
// torn down mid-update, since Chromium service workers (like Firefox event
// pages) suspend aggressively between messages.
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.type === "GET_COUNT" ? message.tabId : sender.tab && sender.tab.id;
  if (tabId == null) return false;

  const settle = (work) => {
    work.then(
      (value) => sendResponse(value ?? { ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  };

  if (message.type === "RESET_COUNT") {
    return settle(enqueue(tabId, () => setCount(tabId, 0)));
  }

  if (message.type === "INCREMENT_COUNT") {
    return settle(
      enqueue(tabId, async () => {
        const next = Math.max(0, (await readCount(tabId)) + message.amount);
        setCount(tabId, next);
      })
    );
  }

  if (message.type === "GET_COUNT") {
    return settle(readCount(tabId).then((count) => ({ count })));
  }

  return false;
});

browser.tabs.onRemoved.addListener((tabId) => {
  pending.delete(tabId);
});
