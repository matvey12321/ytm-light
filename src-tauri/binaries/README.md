# Downloader sidecars

The release build bundles three Windows x64 command-line tools:

| Tool | Version | File |
| --- | --- | --- |
| yt-dlp | 2026.10.26 | `yt-dlp-x86_64-pc-windows-msvc.exe` |
| FFmpeg | 9.0.2 (Gyan.dev essentials) | `ffmpeg-x86_64-pc-windows-msvc.exe` |
| ffprobe | 9.0.2 (Gyan.dev essentials) | `ffprobe-x86_64-pc-windows-msvc.exe` |

The executables are **not committed** because they are large and because GitHub
rejects individual files over 100 MB. Fetch the pinned, checksum-verified copies
before building:

```powershell
npm run fetch:sidecars
```

The script downloads:

- <https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe>
- <https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip>

It verifies SHA-256 for the yt-dlp executable, the FFmpeg archive, and both
extracted FFmpeg executables. Re-run with `-Force` to replace existing files:

```powershell
powershell -NoProfile -File scripts/fetch-sidecars.ps1 -Force
```

For offline builds, pass a local FFmpeg archive:

```powershell
powershell -NoProfile -File scripts/fetch-sidecars.ps1 `
  -FfmpegArchive C:\path\to\ffmpeg-9.0.2-essentials_build.zip
```

`ffmpeg-LICENSE.txt` is committed because the installer ships it next to the
application. See `THIRD_PARTY_NOTICES.md` for license details.
