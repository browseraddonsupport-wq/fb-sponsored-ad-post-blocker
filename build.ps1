# Builds the Firefox and Chromium packages from this one source tree.
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
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1
#         powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1 -Diagnostic
#
# -Diagnostic flips DEBUG to true in the *packaged* copy only, leaving the
# source at false. Diagnostic builds get a "-debug" suffix so they can't be
# mistaken for a release, and are not for daily use: the logs hold live DOM
# references and with devtools open the browser retains and renders every one.

param([switch]$Diagnostic)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$out = Join-Path $root "dist"

$shared = @(
    "background.js", "content.js", "content.css",
    "README.md", "CHANGELOG.md", "LICENSE"
)
$pngIcons = [ordered]@{
    "16"  = "icons/icon-16.png"
    "32"  = "icons/icon-32.png"
    "48"  = "icons/icon-48.png"
    "128" = "icons/icon-128.png"
}

function Copy-Payload($dest) {
    New-Item -ItemType Directory -Force $dest, "$dest\icons", "$dest\popup", "$dest\onboarding" | Out-Null
    foreach ($f in $shared) { Copy-Item (Join-Path $root $f) (Join-Path $dest $f) }
    Copy-Item "$root\popup\*" "$dest\popup\"
    Copy-Item "$root\onboarding\*" "$dest\onboarding\"

    if ($Diagnostic) {
        $target = Join-Path $dest "content.js"
        $text = [System.IO.File]::ReadAllText($target)
        if ($text -notmatch 'const DEBUG = false;') {
            throw "expected 'const DEBUG = false;' in content.js - diagnostic build would be a no-op"
        }
        Write-Utf8NoBom $target ($text -replace 'const DEBUG = false;', 'const DEBUG = true;')
    }
}

# Entries are written explicitly rather than via ZipFile.CreateFromDirectory:
# under Windows PowerShell 5.1 (.NET Framework) that helper writes backslash
# separators, which violates the ZIP spec. Firefox tolerates it; Chrome Web
# Store validation does not, and the failure is opaque when it happens.
function New-Zip($dir, $zip) {
    if (Test-Path $zip) { Remove-Item -Force $zip }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
    try {
        $base = (Resolve-Path $dir).Path.TrimEnd('\') + '\'
        foreach ($file in Get-ChildItem $dir -Recurse -File | Sort-Object FullName) {
            $entry = $file.FullName.Substring($base.Length).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $file.FullName, $entry, 'Optimal') | Out-Null
        }
    }
    finally { $archive.Dispose() }
}

# Set-Content -Encoding utf8 emits a BOM on Windows PowerShell 5.1. A BOM in
# manifest.json is a parse error for some tooling, so write bytes directly.
function Write-Utf8NoBom($path, $text) {
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
}

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
$manifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version
$suffix = if ($Diagnostic) { "-debug" } else { "" }

# --- Firefox -----------------------------------------------------------------
# Shipped as-is: event-page background, SVG icon, gecko settings intact.
$ff = Join-Path $out "firefox"
Copy-Payload $ff
Copy-Item "$root\manifest.json" "$ff\manifest.json"
Copy-Item "$root\icons\icon.svg" "$ff\icons\icon.svg"
New-Zip $ff (Join-Path $root "fb-sponsored-ad-post-blocker$suffix.zip")

# --- Chromium ----------------------------------------------------------------
$cr = Join-Path $out "chrome"
Copy-Payload $cr
foreach ($p in $pngIcons.Values) { Copy-Item (Join-Path $root $p) (Join-Path $cr $p) }

$chromeManifest = Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json
$chromeManifest.PSObject.Properties.Remove("browser_specific_settings")
$chromeManifest.background = [PSCustomObject]@{ service_worker = "background.js" }
$chromeManifest.icons = [PSCustomObject]$pngIcons
$chromeManifest.action.default_icon = [PSCustomObject]$pngIcons
Write-Utf8NoBom (Join-Path $cr "manifest.json") ($chromeManifest | ConvertTo-Json -Depth 10)

New-Zip $cr (Join-Path $root "fb-sponsored-ad-post-blocker-chrome$suffix.zip")

Write-Output "built $version$(if ($Diagnostic) { ' (DEBUG enabled)' })"
Write-Output "  firefox -> fb-sponsored-ad-post-blocker$suffix.zip   (dist/firefox)"
Write-Output "  chrome  -> fb-sponsored-ad-post-blocker-chrome$suffix.zip   (dist/chrome)"
