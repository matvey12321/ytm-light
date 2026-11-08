# YTM Light

[![checks](https://github.com/matvey12321/ytm-light/actions/workflows/checks.yml/badge.svg)](https://github.com/matvey12321/ytm-light/actions/workflows/checks.yml)

A lightweight, personal YouTube Music desktop client for Windows, built with
Tauri 2 and WebView2.

YTM Light is a fork of [`xzelleiv/ytm-tauri`](https://github.com/xzelleiv/ytm-tauri)
(MIT), rebranded and trimmed for personal use. It is not affiliated with
YouTube, Google, Discord, Microsoft, or Tauri.

> **Personal project.** YTM Light is provided as-is, without support or
> warranty. Issues may go unanswered, and features can break whenever YouTube
> Music changes its web player. Use it at your own risk.

## Status

Version 0.1.0, feature-complete for the personal MVP. Windows 10/11 x64 only.
The unsigned NSIS installer has been built and smoke-tested, including real M4A
320 kbps downloads with metadata, cover art, and SponsorBlock edits. Google
sign-in has been confirmed working. The application is intentionally unsigned,
so Windows SmartScreen may show an "Unknown publisher" warning.

Included:

- Core playback, tray, media keys, ad blocking, themes, and auto-confirm.
- Russian settings UI, including the downloader.
- Quick **Video / Audio** switch in the player bar.
- Downloader with format/bitrate selection, SponsorBlock, queue, and history.

Local release artifact (not committed; built with `npm run build:unsigned`):

```text
src-tauri/target/release/bundle/nsis/YTM Light_0.1.0_x64-setup.exe
85.1 MB, SHA-256 3A22002E77A5377E196C46474CA4867E61B8DC7AF4ACF09D49B424EC7DFBA598
```

Tagged `v*` builds publish the unsigned installer to GitHub Releases. The hash
above is from the local smoke-tested build; CI builds are not bit-for-bit
reproducible and may have a different hash.

Planned:

- Discord Rich Presence and Last.fm scrobbling with personal credentials
  (Phase 2).
- Plugin API (Phase 3).

## Features

- Dedicated WebView2 window with a persistent YouTube Music session.
- Native WebView2 request filtering and page-side cleanup for common ads and
  tracking requests.
- System tray controls, close-to-tray, single instance, and launch at startup.
- Windows media controls, media keys, and configurable global shortcuts.
- Synced lyrics, SponsorBlock, equalizer, custom output device, precise volume,
  playback speed, crossfade, and other playback tweaks.
- Auto-confirm for "Continue watching?" and "Still listening?" prompts.
- In-page settings UI written in vanilla JavaScript and fully translated to
  Russian.
- Theme presets (AMOLED, Midnight) and a custom CSS field (up to 64 KB).
- Quick **Video / Audio** switch in the player bar. It uses YouTube Music's
  native AV toggle when available and falls back to a square album-art audio
  view for accounts where YouTube Music disables native switching.
- Downloader in the player bar and Settings → Downloads:
  - current track or current playlist;
  - `best` (original stream), M4A, MP3, Opus, and FLAC;
  - 128/192/256/320 kbps for lossy conversions;
  - SponsorBlock mark/remove with selectable categories;
  - metadata and thumbnail embedding;
  - parallel downloads (1–3), progress, cancel, retry, and history;
  - optional browser-cookie import for private or age-restricted content;
  - correct handling of Cyrillic and other Unicode titles.
- The inherited Spotify transfer UI is no longer injected. The playlist manager
  remains available as an optional inherited tool.

## Requirements

- Windows 10 or Windows 11, x64.
- Microsoft Edge WebView2 Runtime. The NSIS installer embeds the WebView2
  bootstrapper, so a separate download is normally not needed.
- A YouTube Music account for signed-in features. Playback without an account
  is limited by YouTube Music itself.

The installer bundles `yt-dlp`, `ffmpeg`, and `ffprobe`; no separate
installation is required. The app refuses to run a download if the sidecars are
missing or truncated.

## Build

Prerequisites:

- Node.js 22 or newer.
- Rust stable with the `x86_64-pc-windows-msvc` target.
- Visual Studio 2022 Build Tools with the **Desktop development with C++**
  workload (MSVC, Windows SDK).

Install dependencies, fetch the pinned downloader sidecars, and start a
development build:

```powershell
npm install
npm run fetch:sidecars
npm run dev
```

The sidecars (`yt-dlp`, `ffmpeg`, `ffprobe`) are not stored in Git because
GitHub rejects individual files over 100 MB. `fetch:sidecars` downloads pinned
versions from their official release pages and verifies SHA-256. Re-run it with
`-Force` after changing versions:

```powershell
powershell -NoProfile -File scripts/fetch-sidecars.ps1 -Force
```

Build the unsigned NSIS installer:

```powershell
npm run build:unsigned
```

Artifacts are written to:

```text
src-tauri/target/release/ytm-light.exe
src-tauri/target/release/bundle/nsis/
```

`npm run build` is an alias for the same unsigned local build. No code-signing
certificate or updater key is required.

## Tests and checks

```powershell
npm test
npm run check:rust
npm run verify:windows
```

GitHub Actions runs the Rust and JavaScript checks on Windows and fetches the
sidecars before testing or building.

## Configuration and data

Settings and WebView2 profile data are stored under:

```text
%APPDATA%\app.ytmlight.desktop\
```

The download queue and history are stored in
`%APPDATA%\app.ytmlight.desktop\downloads.json`. The default download folder is
`%USERPROFILE%\Music\YTM Light`; you can set an absolute custom path in
Settings → Downloads. Relative paths are rejected.

The remote YouTube Music page receives no Tauri IPC permissions. Communication
with the Rust core is limited to validated feature messages carried through the
page title. External links open in the default browser.

Discord Rich Presence is disabled in the MVP. `src-tauri/discord-client-id.txt`
is intentionally empty and no third-party Discord application ID is bundled.

## Downloader notes

Use the download button in the player bar for the current track, or open
Settings → Downloads to download the current playlist and manage the queue.
Format conversion, metadata, thumbnails, and SponsorBlock edits require the
bundled FFmpeg; `ffprobe` is used to determine media duration. Browser cookies
can be imported for private or age-restricted content, but this is optional.

yt-dlp output is forced to UTF-8, and the app reads it without stopping on
invalid bytes. This keeps Cyrillic titles intact and prevents the old
`[Errno 22] Invalid argument` failure caused by a closed output pipe.

Download only content you have the right to save. YTM Light does not host or
distribute media, and you are responsible for how you use the downloader.

## Google sign-in

Google may reject sign-in inside embedded browsers. If the normal sign-in flow
fails in this WebView2 build, use the application only for signed-out playback
until an external-browser OAuth fallback is implemented.

## Credits

- [`xzelleiv/ytm-tauri`](https://github.com/xzelleiv/ytm-tauri) — base project.
- Henix — original creator of the base project.
- Pear Desktop — inspiration for several built-in modules.

## License

MIT. See [`LICENSE`](LICENSE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
