#!/usr/bin/env bash
# Builds the Firefox and Chromium packages from this one source tree.
# Bash port of build.ps1 — same payload, same two zips, same -Diagnostic
# behaviour. Kept as a sibling rather than a replacement so the Windows
# machine that produced the published builds keeps working unchanged; the two
# must be edited together when the payload changes.
#
# The folder itself stays a working Firefox extension - load manifest.json as a
# temporary add-on and your edits apply on Reload, no build step. This script
# only produces the two distributable zips.
#
# The Chromium package is the same source with a transformed manifest:
#   - background.scripts (Firefox event page) -> background.service_worker
#   - browser_specific_settings dropped (Firefox-only; fails CWS validation)
#   - SVG icons swapped for PNGs (Chromium does not support SVG icons)
#
# The scripts themselves need no per-browser variants: they alias the API
# namespace (`globalThis.browser ?? globalThis.chrome`) and use the
# sendResponse form of onMessage, which both browsers accept.
#
# Usage:  ./build.sh
#         ./build.sh --diagnostic
#
# --diagnostic flips DEBUG to true in the *packaged* copy only, leaving the
# source at false. Diagnostic builds get a "-debug" suffix so they can't be
# mistaken for a release, and are not for daily use: the logs hold live DOM
# references and with devtools open the browser retains and renders every one.

set -euo pipefail

diagnostic=0
case "${1-}" in
    --diagnostic|-Diagnostic|-d) diagnostic=1 ;;
    "") ;;
    *) echo "usage: $0 [--diagnostic]" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$root/dist"

shared=(background.js content.js content.css README.md CHANGELOG.md LICENSE)
png_icons=(16 32 48 128)

copy_payload() {
    local dest="$1"
    mkdir -p "$dest/icons" "$dest/popup" "$dest/onboarding"
    local f
    for f in "${shared[@]}"; do cp "$root/$f" "$dest/$f"; done
    cp "$root"/popup/* "$dest/popup/"
    cp "$root"/onboarding/* "$dest/onboarding/"

    if [[ $diagnostic -eq 1 ]]; then
        local target="$dest/content.js"
        # Guard against a silent no-op: if the source line ever changes shape,
        # the substitution below would quietly produce a release build wearing
        # a -debug name, which is worse than failing.
        if ! grep -q 'const DEBUG = false;' "$target"; then
            echo "expected 'const DEBUG = false;' in content.js - diagnostic build would be a no-op" >&2
            exit 1
        fi
        sed -i 's/const DEBUG = false;/const DEBUG = true;/' "$target"
    fi
}

# -X drops extra file attributes (uid/gid, extended timestamps) so the archive
# depends only on the payload. Paths are relative to the build directory and
# zip writes forward slashes, which is what the Chrome Web Store requires --
# the separator problem that made build.ps1 assemble entries by hand does not
# arise here.
make_zip() {
    local dir="$1" zipfile="$2"
    rm -f "$zipfile"
    (cd "$dir" && find . -type f | sort | sed 's|^\./||' | zip -qX9 "$zipfile" -@)
}

rm -rf "$out"

version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$root/manifest.json")"
suffix=""
[[ $diagnostic -eq 1 ]] && suffix="-debug"

# --- Firefox -----------------------------------------------------------------
# Shipped as-is: event-page background, SVG icon, gecko settings intact.
ff="$out/firefox"
copy_payload "$ff"
cp "$root/manifest.json" "$ff/manifest.json"
cp "$root/icons/icon.svg" "$ff/icons/icon.svg"
make_zip "$ff" "$root/fb-sponsored-ad-post-blocker$suffix.zip"

# --- Chromium ----------------------------------------------------------------
cr="$out/chrome"
copy_payload "$cr"
for size in "${png_icons[@]}"; do
    cp "$root/icons/icon-$size.png" "$cr/icons/icon-$size.png"
done

# json.load preserves key order, so the transformed manifest keeps the source
# ordering rather than being alphabetised.
python3 - "$root/manifest.json" "$cr/manifest.json" <<'PY'
import json, sys

src, dest = sys.argv[1], sys.argv[2]
with open(src, encoding="utf-8") as fh:
    manifest = json.load(fh)

manifest.pop("browser_specific_settings", None)
manifest["background"] = {"service_worker": "background.js"}
icons = {str(s): f"icons/icon-{s}.png" for s in (16, 32, 48, 128)}
manifest["icons"] = icons
manifest["action"]["default_icon"] = icons

# No BOM: a BOM in manifest.json is a parse error for some tooling.
with open(dest, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(manifest, fh, indent=2)
    fh.write("\n")
PY

make_zip "$cr" "$root/fb-sponsored-ad-post-blocker-chrome$suffix.zip"

echo "built $version$([[ $diagnostic -eq 1 ]] && echo ' (DEBUG enabled)')"
echo "  firefox -> fb-sponsored-ad-post-blocker$suffix.zip   (dist/firefox)"
echo "  chrome  -> fb-sponsored-ad-post-blocker-chrome$suffix.zip   (dist/chrome)"
