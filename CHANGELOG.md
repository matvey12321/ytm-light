# Changelog

## Unreleased

### UI / UX

- Removed the inherited Spotify **Transfer** button and stopped injecting the
  Spotify transfer probe. The transfer source files remain dormant for a
  possible future phase.
- Translated the settings modal and downloader UI to Russian, including status
  labels, errors, and technical hints.
- Added a quick **Video / Audio** switch to the player bar
  (`video_quick_toggle`, enabled by default). It uses YouTube Music's native AV
  controls when available and otherwise switches to a square album-art audio
  view, so the control still works for accounts without native AV switching.
- Renamed remaining mixed labels (`DSP-эквалайзер`, `Ambient-свечение`,
  `HiDPI`) to Russian descriptions.

### Downloader (Phase 1.5)

- Fixed `[Errno 22] Invalid argument` during downloads. yt-dlp could print
  metadata in the Windows code page; the old line reader stopped at the first
  invalid UTF-8 byte, closed the stdout pipe, and yt-dlp failed while flushing
  its output. The reader now decodes lossily, and yt-dlp is forced to UTF-8 with
  `--encoding utf-8`.
- Bundled `ffprobe` alongside `ffmpeg`. Some postprocessing paths (duration
  detection for SponsorBlock and metadata) need it; without it downloads failed
  with `ffprobe not found`.
- Passed the sidecar directory to `--ffmpeg-location` so yt-dlp finds both
  `ffmpeg` and `ffprobe`.
- Hardened downloads with active-job deduplication by URL, `--trim-filenames
  120`, per-field metadata prints, a valid working directory, and automatic
  creation of the download folder.
- Verified live against YouTube Music: M4A 320 kbps with metadata, cover art,
  SponsorBlock removal, Cyrillic titles, and filenames.
- Added a regression test that invalid UTF-8 output does not stop the reader.

### Packaging

- Extended the unsigned NSIS build verification to require the downloader
  sidecars (`yt-dlp`, `ffmpeg`, `ffprobe`) next to the release executable.
- Added yt-dlp and FFmpeg notices and license links. The FFmpeg license text is
  installed next to the application.
- Built and smoke-tested the unsigned NSIS installer (85.1 MB, SHA-256
  `3A22002E77A5377E196C46474CA4867E61B8DC7AF4ACF09D49B424EC7DFBA598`).

### Repository / GitHub

- Added `npm run fetch:sidecars`, which downloads pinned yt-dlp 2026.10.26 and
  FFmpeg 9.0.2, verifies SHA-256 for every file, and extracts `ffmpeg`,
  `ffprobe`, and the FFmpeg license.
- Excluded the large sidecar executables from Git. GitHub rejects individual
  files over 100 MB, and `ffmpeg.exe`/`ffprobe.exe` are both larger.
- Updated both GitHub Actions workflows to fetch the sidecars before testing or
  building. Tagged `v*` builds now publish the unsigned installer to GitHub
  Releases.
- Fixed the sidecar fetch step on GitHub Actions. The runner launched Windows
  PowerShell without `Microsoft.PowerShell.Utility`, so `Get-FileHash` was
  missing. Both build scripts now hash files through .NET
  (`scripts/hash-utils.ps1`), and a test guards against reintroducing the
  cmdlet.
- Updated the workflow actions to their current major versions (`checkout` v7,
  `setup-node` v7, `upload-artifact` v7, `setup-rust-toolchain` v2) to drop the
  Node 20 deprecation warning.
- Published the repository and added a CI status badge plus a no-support
  disclaimer to the README.
- Removed stale English screenshots of the old Spotify transfer UI.
- Added `.gitignore` rules for local secrets, editor state, crash dumps, and
  build artifacts.

## 0.1.0 - 2026-10-26

### YTM Light fork

- Rebranded the base project as **YTM Light** (`app.ytmlight.desktop`,
  `ytm-light.exe`).
- Removed the bundled updater endpoint, signing configuration, and in-app update
  UI. Local builds are unsigned and updated manually.
- Disabled Discord Rich Presence by default and removed the bundled third-party
  Discord application ID.
- Removed third-party repository links from the settings UI.
- Simplified the Windows build scripts to produce an unsigned NSIS installer
  without external secrets.
- Added AMOLED and Midnight theme presets plus a custom CSS editor (up to
  64 KB).
- Added auto-confirm for "Continue watching?" and "Still listening?" playback
  prompts.
- Kept the existing adblock, tray, media controls, lyrics, SponsorBlock,
  equalizer, output device, and playback modules.

## 0.2.5 - 2026-09-13

### Features

- Added **Playlist Manager** directly to playlist pages: search every song, select across pages, review duplicates and unavailable entries, and copy, move, remove, or reorder songs in bulk.
- Added built-in Spotify sign-in for private playlists and Liked Songs, with encrypted session persistence across app launches and connected-profile lookup.
- Added ListenBrainz token setup alongside Last.fm scrobbling.
- Added a keyboard shortcut reference with **Ctrl+H**.

### UI/UX Improvements

- Added album thumbnails, private destination search, Shift-click range selection, and exact counts for songs already in the destination.
- Added configurable transfer auto-skip thresholds, clearer recording-version warnings, and review controls that preserve the current position.
- Fixed unreadable transfer dropdown options in the dark interface.
- Added in-app updater download progress, verification status, and retry feedback in **Settings → System**.
- Added cinematic, studio, and luminescent synced-lyrics styles.

### Fixes & Reliability

- Batched playlist copying, moving, and removal in groups of up to 25; source entries are removed only after their destination copy is confirmed.
- Preserved unfinished selections after failed playlist operations and rebuilt their review plans for retry.
- Improved Spotify pagination, matching fallback searches, and matching concurrency; authenticated imports no longer silently fall back to truncated previews.
- Corrected playlist creation fields and surfaced actionable transfer errors without automatically replaying uncertain writes.
- Hardened lyric timing, media-element rebinding, duration matching, and LRCLib fallback behavior.
- Fixed scrobbling setup and serialized encrypted credential updates for independent providers.
- Improved playback-speed, autoplay, disliked-song, and SponsorBlock behavior after player changes.
- Avoided repeated startup update prompts for versions already offered, while keeping manual checks available.

### Credits

- xzelleiv
- Henix (original creator)
- Pear Desktop

> Windows may show an "Unknown publisher" notice because this community release is not code-signed. In-app updater packages are separately signature-verified.

## 0.1.8 - 2026-07-26

### Fixes

- Fixed Google sign-in looping and opening Chrome when the regional `accounts.google.com.sg` handoff was rejected; the login flow now stays inside the WebView.

## 0.1.7 - 2026-07-24

### Fixes

- Restored ad blocking with host-scoped WebView2 filters that do not intercept media streams.
- Preserved Share, inactivity, and other YouTube Music dialogs while skipping detected player ads.
- Reapplied ad blocking after sign-out navigation without changing Google account pages.
- Kept Google sign-in completion inside the desktop app instead of opening Chrome.
- Embedded the WebView2 bootstrapper for more reliable first-time Windows installs.
- Added MSI license/bootstrapper verification and blocked accidental unsigned release builds.

## 0.1.6 - 2026-07-20

### Fixes

- Fixed Google sign-in navigation being opened in an external browser instead of WebView.
- Fixed HTML5 audio/video media playback stalling at 0:00 when ad-block is enabled.
- Fixed WebView2 media autoplay policy requiring manual user gesture.

## 0.1.5 - 2026-07-12

### QoL

- Added persistent Discord RPC, ad-block, close-to-tray, startup, start-minimized, and zoom settings.
- Added a system tray with show/hide, previous, play/pause, next, Discord RPC, and quit controls.
- Added reload, zoom, cache clear, session reset, RPC status, and ad-block status actions.
- Added automatic and manual GitHub release checks.
- Open external HTTPS links in the default browser.
- Added left-hand global playback shortcuts: `Ctrl+Alt+A` previous, `Ctrl+Alt+S` play/pause, and `Ctrl+Alt+D` next.
- Avoided GitHub API rate limits in update checks.

## 0.1.4 - 2026-07-04

### Fixes

- Clear Discord Rich Presence when YouTube Music has no valid track, shows an ad, leaves the music host, or the app closes.

### Documentation

- Refined README positioning for the desktop app.
