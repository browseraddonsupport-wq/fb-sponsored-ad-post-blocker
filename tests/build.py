"""Builds tests/runner.html: content.js plus every fixture, run in one page.

Why a generated HTML file rather than a node test runner: content.js is a
content script that talks to a live DOM and the WebExtension API, and there is
no JS runtime on this machine anyway. A browser page is the only place it can
actually execute, and file:// cannot fetch the fixtures, so they are inlined.

Usage:  python tests/build.py   then open tests/runner.html in any browser.
"""
import io, json, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read(p):
    return io.open(os.path.join(ROOT, p), encoding="utf-8").read()

fixtures = []
for path in sorted(glob.glob(os.path.join(ROOT, "tests", "fixtures", "*.json"))):
    data = json.loads(io.open(path, encoding="utf-8").read())
    data["name"] = os.path.splitext(os.path.basename(path))[0]
    fixtures.append(data)

src = read("content.js")

html = """<!doctype html><meta charset="utf-8"><title>fbsb fixture tests</title>
<style>
 body{font:13px ui-monospace,Menlo,Consolas,monospace;margin:16px;background:#111;color:#ddd}
 .pass{color:#4ade80} .fail{color:#f87171} .why{color:#888;margin-left:2em}
 h1{font-size:15px} #sandbox{position:absolute;left:-99999px;top:0}
</style>
<h1>F.B. Sponsored/Ad Post Blocker — fixture tests</h1>
<pre id="out">running...</pre>
<div id="sandbox"></div>
<script>
// Minimal WebExtension stubs. The extension only needs storage + runtime here.
window.browser = {
  runtime: { getManifest: function(){ return { version: "fixture" }; },
             sendMessage: function(){ return Promise.resolve(); },
             onMessage: { addListener: function(){} } },
  storage: { local: { get: function(d){ return Promise.resolve(Object.assign({}, d)); } },
             onChanged: { addListener: function(){} } }
};
window.__FIXTURES__ = FIXTURES_JSON;
</script>
<script>
CONTENT_JS
</script>
<script>
(function () {
  var out = document.getElementById("out");
  var sandbox = document.getElementById("sandbox");
  var NL = String.fromCharCode(10);
  var lines = [], pass = 0, fail = 0;

  // The marker goes on whatever findPostContainer returned - usually an
  // ANCESTOR of the card div, not the card itself. And getComputedStyle on a
  // descendant of a display:none element reports that descendant's own
  // display, never "none", so checking the card directly misses every real
  // hide. The first run of this harness failed all six hiding fixtures for
  // this reason while the extension was working correctly.
  //
  // Ask the question the user asks instead: is it still on screen?
  function isHidden(host, card) {
    if (host.querySelector("[data-fbsb-hidden]")) return true;
    var r = card.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return true;
    if (getComputedStyle(card).visibility === "hidden") return true;
    return false;
  }

  var i = 0;
  function next() {
    if (i >= window.__FIXTURES__.length) {
      lines.push("");
      lines.push((fail === 0 ? "ALL PASS" : fail + " FAILED") + "  (" + pass + " passed)");
      out.innerHTML = lines.join(NL);
      window.__RESULT__ = { pass: pass, fail: fail, text: lines.join(NL) };
      return;
    }
    var f = window.__FIXTURES__[i++];
    sandbox.innerHTML = "";

    // Portals live outside the card, as they do on the real page.
    if (f.portal) {
      var p = document.createElement("div");
      p.innerHTML = f.portal;
      document.body.appendChild(p);
    }
    // isImplausiblyShallow discards any label within 10 levels of <body> as a
    // portal decoy, and a real feed post sits far deeper than that. Without
    // this nesting every fixture "fails" for a reason that has nothing to do
    // with the fixture - which is exactly what the first run of this harness
    // reported.
    var chain = sandbox;
    for (var n = 0; n < 16; n++) {
      var w = document.createElement("div");
      chain.appendChild(w);
      chain = w;
    }
    var host = document.createElement("div");
    host.innerHTML = f.card;
    chain.appendChild(host);

    // Drive the same two steps the MutationObserver performs, rather than
    // waiting on it. scheduleScan defers through requestAnimationFrame, which
    // does not fire reliably in a background or hidden tab - the first runs of
    // this harness reported every fixture as "not hidden" for that reason
    // alone. This still exercises the real pipeline: cache, classify, resolve,
    // hide. What it does not cover is the observer's own wiring.
    if (f.portal) cacheLabelTargets(document.body);
    cacheLabelTargets(host);
    scanRoot(host);

    // Let the observer and the rAF-coalesced scan run, as they would live.
    setTimeout(function () {
      var card = host.querySelector("[style*='width:680px']") || host.firstElementChild;
      var hidden = isHidden(host, card);
      var want = f.expect === "hidden";
      var ok = hidden === want;
      if (ok) { pass++; } else { fail++; }
      lines.push((ok ? "<span class='pass'>PASS</span>" : "<span class='fail'>FAIL</span>") +
                 "  " + f.name + "   expected " + f.expect + ", got " + (hidden ? "hidden" : "visible"));
      if (!ok) lines.push("<span class='why'>" + f.why + "</span>");
      out.innerHTML = lines.join(NL);
      next();
    }, 120);
  }
  next();
})();
</script>
"""

html = html.replace("FIXTURES_JSON", json.dumps(fixtures))
html = html.replace("CONTENT_JS", src)
io.open(os.path.join(ROOT, "tests", "runner.html"), "w", encoding="utf-8", newline="\n").write(html)
print("wrote tests/runner.html  (%d fixtures)" % len(fixtures))
