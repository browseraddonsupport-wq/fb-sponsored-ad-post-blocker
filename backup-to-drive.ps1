# Publishes a complete, restorable snapshot of this project to Google Drive.
#
# The working tree stays on C:. Drive receives artifacts only - never the live
# repository. That distinction is the whole point of this script.
#
# Why not just put the project in Drive: .git is ~190 small files under constant
# concurrent write, which is the one workload a streaming sync volume handles
# badly. This project has already lost its .git once that way; the remains are
# still sitting in a .Trash-1000 folder. A bundle sidesteps it entirely - the
# entire history, every commit and tag, in a single file written once per run.
#
# What lands in Drive:
#   history.bundle   every commit, branch and tag (git clone restores from it)
#   *.zip            the built packages for the current version
#   SNAPSHOT.txt     what this snapshot contains and how to restore it
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File backup-to-drive.ps1
#         powershell -NoProfile -ExecutionPolicy Bypass -File backup-to-drive.ps1 -Destination "X:\somewhere"
#
# Restoring, from anywhere:  git clone history.bundle <folder>

param(
    # Left empty to be discovered. Pass a path to override.
    [string]$Destination,
    # Snapshots a dirty tree instead of refusing. The bundle still only contains
    # committed history, so uncommitted edits are NOT backed up either way -
    # the refusal exists to stop that going unnoticed.
    [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# Google Drive's mount letter is not stable. It was I: for this project's first
# snapshots and came back as H: after a restart of the Drive client, which made
# a hardcoded path fail with "destination not found" - a backup that stops
# running because a drive letter moved is worse than useless, because nothing
# announces it. Find the folder instead of assuming where it lives.
$driveRelative = "My Drive\Extensions\F.B. Sponsored Ad Post Blocker"

if (-not $Destination) {
    foreach ($letter in (Get-PSDrive -PSProvider FileSystem).Name) {
        $candidate = Join-Path "${letter}:\" $driveRelative
        if (Test-Path $candidate) { $Destination = $candidate; break }
    }
}

if (-not $Destination) {
    throw "could not find '$driveRelative' on any drive - is Google Drive running?"
}
if (-not (Test-Path $Destination)) {
    throw "destination not found: $Destination"
}

Push-Location $root
try {
    $dirty = git status --porcelain
    if ($dirty -and -not $AllowDirty) {
        Write-Output "Working tree is dirty. A bundle contains committed history only, so"
        Write-Output "these changes would NOT be in the snapshot:"
        $dirty | ForEach-Object { Write-Output "  $_" }
        throw "commit first, or re-run with -AllowDirty to snapshot anyway"
    }

    $version = (Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json).version
    $head = git rev-parse --short HEAD
    $branch = git rev-parse --abbrev-ref HEAD

    # Write locally first, then move into place. Drive syncs whatever appears in
    # the folder; a bundle caught mid-write would upload as a corrupt backup that
    # still looks present, which is worse than an obviously missing one.
    $staged = Join-Path $env:TEMP "history.bundle"

    # git writes progress and even success messages to stderr, which under
    # $ErrorActionPreference = "Stop" PowerShell escalates to a terminating
    # error - a passing `bundle verify` would otherwise fail the script. Judge
    # these by exit code, which is what actually carries the result.
    $out = & { $ErrorActionPreference = "Continue"; git bundle create $staged --all 2>&1 }
    if ($LASTEXITCODE -ne 0) { throw "bundle creation failed: $out" }

    # Prove it restores before it is allowed to count as a backup.
    $verify = & { $ErrorActionPreference = "Continue"; git bundle verify $staged 2>&1 }
    if ($LASTEXITCODE -ne 0) { throw "bundle failed verification: $verify" }

    Copy-Item $staged (Join-Path $Destination "history.bundle") -Force
    Remove-Item $staged -Force

    $zips = Get-ChildItem $root -Filter "fb-sponsored-ad-post-blocker*.zip" -File
    foreach ($z in $zips) { Copy-Item $z.FullName (Join-Path $Destination $z.Name) -Force }

    # Count the branch, not --all. This repo carries refs/original/* left behind
    # by an old filter-branch, and --all counts those orphaned pre-rewrite
    # commits too - reporting 23 for a 17-commit history. The bundle still
    # captures everything either way; only the number was wrong, which is worth
    # fixing in a tool whose whole job is telling you what it saved.
    $commits = git rev-list $branch --count
    $tags = (git tag) -join ", "
    $notes = @"
F.B. Sponsored/Ad Post Blocker - Drive snapshot
================================================

Taken:    $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Version:  $version
Commit:   $head on $branch$(if ($dirty) { "  (WORKING TREE WAS DIRTY - uncommitted edits are not in this snapshot)" })
History:  $commits commits
Tags:     $tags

This folder holds artifacts, not a working copy. The live repository stays on
C: deliberately: .git is many small files under concurrent write, which is what
corrupts on a streaming sync volume.

history.bundle contains the complete history - every commit, branch and tag.
To restore the whole project anywhere:

    git clone history.bundle "F.B. Sponsored Ad Post Blocker"

The zips are the built packages at the version above. They are reproducible
from source with build.ps1, so they are convenience rather than the backup.

Canonical remote: $(git remote get-url origin 2>$null)
"@
    Set-Content (Join-Path $Destination "SNAPSHOT.txt") $notes -Encoding UTF8

    Write-Output "snapshot -> $Destination"
    Write-Output "  history.bundle   $commits commits, $((git tag | Measure-Object).Count) tags, verified restorable"
    Write-Output "  $($zips.Count) package zip(s) at $version"
    Write-Output "  SNAPSHOT.txt     $head on $branch$(if ($dirty) { ' (dirty)' })"
}
finally { Pop-Location }
